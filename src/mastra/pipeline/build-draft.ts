import type {
  Allergen, AllergenCheck, AvailabilityInfo, CatalogProduct, Draft, DraftLine, EventType, Intake, Lang, LineTag,
  MenuComponent, PriceInfo, ProgressEvent, ProgressStepId, SearchHit,
} from '@/contracts';
import { checkAllergens, getProduct, searchProducts } from '@/catalog';
import { checkAllergensViaMcp, getProductTools } from '@/mcp/client';
import { listLeftoverRecords, now, saveDraft } from '@/db/repo';
import { deliverableOn, effectiveCutoff } from '@/domain/cutoff';
import { dietCovers, fitDietSplit, isDietFlag } from '@/domain/diets';
import { computeHistoryAdjustment } from '@/domain/history';
import { requiredAmount } from '@/domain/portions';
import { packsFor } from '@/domain/quantities';
import { computeTotals } from '@/domain/totals';
import { getAvailability, getPrices } from '@/valio/client';
import type { MenuComponentPlan } from '../agents/menu';
import type { AimoContext } from '../context';
import { audit, progress, type Emit } from '../events';
import type { Specialists } from '../specialists';
import { reasonText } from './reasons';
import { availablePacks, repriceLine } from './reprice';
import { sameKind } from './same-kind';

const CANDIDATES = 8;
const ALTERNATIVES = 2;
const TICKER = 12;

export function productName(p: CatalogProduct, lang: Lang | undefined): string {
  const base = lang?.slice(0, 2).toLowerCase();
  if (base === 'fi' && p.nameFi) return p.nameFi;
  if (base === 'sv' && p.nameSv) return p.nameSv;
  return p.nameEn;
}

const unique = <T>(xs: T[]) => [...new Set(xs)];
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Components ──

export function toComponent(plan: MenuComponentPlan, id: string, eventType: EventType, dietVariantOf?: string): MenuComponent {
  const guests = Math.max(0, Math.round(plan.guests));
  const { amount, unit } = requiredAmount(plan.category, eventType, guests);
  return {
    id, label: plan.label, searchTerms: plan.searchTerms, category: plan.category, origin: plan.origin, guests,
    ...(dietVariantOf ? { dietVariantOf } : {}),
    ...(plan.requiredDiet?.length ? { requiredDiet: plan.requiredDiet } : {}),
    ...(plan.excludeAllergens?.length ? { excludeAllergens: plan.excludeAllergens } : {}),
    requiredAmount: amount, requiredUnit: unit,
  };
}

/**
 * What the component's guests need by the portion rule. A stock-capped component asks only for what is
 * ordered (see fitToStock), so covering "the rest" must measure against this, never against requiredAmount alone.
 */
export function neededAmount(c: MenuComponent, eventType: EventType): number {
  const rule = requiredAmount(c.category, eventType, c.guests);
  return rule.unit === c.requiredUnit ? Math.max(c.requiredAmount, rule.amount) : c.requiredAmount;
}

/**
 * Menu agent output → components with unique ids and portion amounts from the rules.
 * A diet variant of a component that doesn't exist is dropped: on its own it would be served to nobody.
 */
export function toComponents(
  plans: MenuComponentPlan[], eventType: EventType,
): { components: MenuComponent[]; dropped: MenuComponentPlan[] } {
  const ids = new Set<string>();
  const withIds = plans.filter((p) => p.guests > 0).map((p) => {
    const base = p.id || 'c-item';
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return { p, id };
  });
  const orphan = ({ p }: { p: MenuComponentPlan }) => !!p.dietVariantOf && !ids.has(p.dietVariantOf);
  return {
    components: withIds.filter((x) => !orphan(x)).map(({ p, id }) => toComponent(p, id, eventType, p.dietVariantOf ?? undefined)),
    dropped: withIds.filter(orphan).map(({ p }) => p),
  };
}

const constraintsOf = (c: MenuComponent) => ({ excludeAllergens: c.excludeAllergens, requireDiet: c.requiredDiet });
const isConstrained = (c: MenuComponent) => !!(c.excludeAllergens?.length || c.requiredDiet?.length);

// ── Search ──

/** Top candidates over the Finnish and English search terms, preferring the component's unit. */
export function findCandidates(c: MenuComponent): CatalogProduct[] {
  const best = new Map<string, SearchHit>();
  for (const query of unique([c.searchTerms.fi, c.searchTerms.en].filter(Boolean))) {
    for (const hit of searchProducts({ query, ...constraintsOf(c), limit: CANDIDATES })) {
      const prev = best.get(hit.product.id);
      if (!prev || hit.score > prev.score) best.set(hit.product.id, hit);
    }
  }
  const hits = [...best.values()].sort((a, b) => b.score - a.score).map((h) => h.product);
  const sameUnit = hits.filter((p) => p.packUnit === c.requiredUnit);
  return byGranularity((sameUnit.length ? sameUnit : hits).slice(0, CANDIDATES), c.requiredAmount);
}

/**
 * Stable reorder: packs between 1/20 and 1/5 of the need come first (finer adjustment, fewer leftovers),
 * then larger packs, then tiny ones. Search order is kept within each group.
 */
export function byGranularity(products: CatalogProduct[], required: number): CatalogProduct[] {
  const group = (p: CatalogProduct) => {
    if (p.packSize <= 0 || required <= 0) return 1;
    if (p.packSize >= required / 20 && p.packSize <= required / 5) return 0;
    return p.packSize > required / 5 ? 1 : 2;
  };
  return products.map((p, i) => ({ p, i, g: group(p) })).sort((a, b) => a.g - b.g || a.i - b.i).map((x) => x.p);
}

/**
 * Every guest eats the shared components, so each one must meet every diet need that no
 * diet variant of it covers (cooking items, sauces, and dishes the menu agent made no variant for).
 */
export function applyDietRules(components: MenuComponent[], diets: Intake['diets']): MenuComponent[] {
  if (!Array.isArray(diets) || diets.length === 0) return components;
  return components.map((c) => {
    if (c.dietVariantOf) return c;
    const variants = components.filter((v) => v.dietVariantOf === c.id);
    const open = unique(diets.map((d) => d.diet)).filter((need) => !variants.some((v) => dietCovers(v, need)));
    if (!open.length) return c;
    const requiredDiet = unique([...(c.requiredDiet ?? []), ...open.filter(isDietFlag)]);
    const excludeAllergens = unique([...(c.excludeAllergens ?? []), ...open.filter((d): d is Allergen => !isDietFlag(d))]);
    return {
      ...c,
      ...(requiredDiet.length ? { requiredDiet } : {}),
      ...(excludeAllergens.length ? { excludeAllergens } : {}),
    };
  });
}

/** "Bread 90 + Gluten-free bread 10 (gluten_free)" per dish with diet variants, for the audit trail. */
export function dietSplitNote(components: MenuComponent[]): string {
  return components
    .filter((c) => !c.dietVariantOf && components.some((v) => v.dietVariantOf === c.id))
    .map((c) => {
      const variants = components.filter((v) => v.dietVariantOf === c.id).map((v) => {
        const rules = [...(v.requiredDiet ?? []), ...(v.excludeAllergens ?? []).map((a) => `no ${a}`)];
        return `${v.label} ${v.guests}${rules.length ? ` (${rules.join(', ')})` : ''}`;
      });
      return [`${c.label} ${c.guests}`, ...variants].join(' + ');
    })
    .join('; ');
}

// ── Sourcing: search → pick → allergens → prices/stock ──

export interface Selection {
  component: MenuComponent;
  product: CatalogProduct;
  alternatives: string[];
  reason: string;
  allergen: AllergenCheck;
  substituteFor?: DraftLine['substituteFor'];
}

interface Ranked { component: MenuComponent; ranked: string[]; reason: string }

type Stage = (step: ProgressStepId, status: ProgressEvent['status'], extra?: Pick<ProgressEvent, 'count' | 'ticker'>) => Promise<void>;

export interface Sourced {
  selections: Selection[];
  prices: Map<string, PriceInfo>;
  availability: Map<string, AvailabilityInfo>;
  exceptions: string[];
}

async function rankAll(
  components: MenuComponent[], candidates: Map<string, CatalogProduct[]>, lang: Lang, specialists: Specialists,
  extra: { prices?: Map<string, PriceInfo>; request?: string }, ctx: AimoContext,
): Promise<Ranked[]> {
  const searchable = components.filter((c) => (candidates.get(c.id) ?? []).length > 0);
  if (searchable.length === 0) return [];
  // Without the product agent the search ranking still gives a sound pick.
  const picks = await specialists.pickProducts({ lang, components: searchable, candidates, ...extra }).catch((err: unknown) => {
    audit(ctx.conversationId, 'product', 'pickProducts', 'Product agent unavailable, used best match', { error: (err as Error).message });
    return [];
  });
  return searchable.map((component) => {
    const ids = candidates.get(component.id)!.map((p) => p.id);
    const pick = picks.find((p) => p.componentId === component.id);
    const chosen = pick && ids.includes(pick.productId) ? pick.productId : ids[0];
    const alternatives = (pick?.alternatives ?? []).filter((id) => ids.includes(id));
    return { component, ranked: unique([chosen, ...alternatives, ...ids]), reason: pick?.reason ?? 'Best catalogue match' };
  });
}

/**
 * Takes the first verified-safe candidate; "unknown" only when nothing passes (allergen agent judges among several).
 * Never a conflicting product: when every candidate fails, the component gets no product (null).
 */
async function screenAllergens(
  { component, ranked, reason }: Ranked, specialists: Specialists, ctx: AimoContext,
): Promise<Selection | null> {
  const checks = await checkAllergensViaMcp(ranked, constraintsOf(component));
  let chosen = checks.find((c) => c.verdict === 'pass');
  if (!chosen) {
    const unknowns = checks.filter((c) => c.verdict === 'unknown');
    if (!unknowns.length) return null;
    chosen = unknowns[0];
    if (unknowns.length > 1) {
      const products = unknowns.map((c) => getProduct(c.productId)).filter((p): p is CatalogProduct => !!p);
      const choice = await specialists.chooseUnknownFallback({ component, candidates: products }).catch((err: unknown) => {
        audit(ctx.conversationId, 'allergen', 'chooseUnknownFallback', `Allergen agent unavailable, used best match for ${component.label}`,
          { error: (err as Error).message });
        return null;
      });
      const picked = choice && unknowns.find((c) => c.productId === choice.productId);
      if (picked) chosen = { ...picked, evidence: [picked.evidence, choice.note].filter(Boolean).join('. ') };
    }
  }
  const product = getProduct(chosen.productId)!;
  // Only same-kind products may stand in for the pick (substitution, stock top-up).
  const alternatives = checks
    .filter((c) => c.productId !== chosen.productId && c.verdict !== 'fail')
    .filter((c) => { const p = getProduct(c.productId); return !!p && sameKind(component, product, p); })
    .slice(0, ALTERNATIVES).map((c) => c.productId);
  return { component, product, alternatives, reason, allergen: chosen };
}

/** Swaps an undeliverable / blocked product for the first deliverable alternative that is no less safe. */
function substitute(
  sel: Selection, availability: Map<string, AvailabilityInfo>, date: string, lang: Lang,
): { selection: Selection; problem?: string } {
  const a = availability.get(sel.product.id);
  if (!a || deliverableOn(a, date)) return { selection: sel };
  const late = a.deliverable && !a.salesBlock && !!a.availableDate;
  const reason = reasonText(
    a.salesBlock ? { kind: 'salesBlock' } : late ? { kind: 'late', date: a.availableDate! } : { kind: 'notDeliverable', date },
    lang,
  );
  for (const altId of sel.alternatives) {
    const alt = availability.get(altId);
    const product = getProduct(altId);
    if (!product || !alt || !deliverableOn(alt, date)) continue;
    const check = checkAllergens([altId], constraintsOf(sel.component))[0];
    if (check.verdict === 'fail' || (sel.allergen.verdict === 'pass' && check.verdict !== 'pass')) continue;
    return {
      selection: {
        ...sel, product, allergen: check, alternatives: sel.alternatives.filter((id) => id !== altId),
        substituteFor: { productId: sel.product.id, productName: productName(sel.product, lang), reason },
      },
    };
  }
  return {
    selection: sel,
    problem: `${sel.component.label}: ${productName(sel.product, lang)}: "${reason}". No product of the same kind is deliverable by ${date}; ask the buyer what to use instead`,
  };
}

export async function sourceComponents(
  components: MenuComponent[],
  intake: Intake,
  deps: {
    specialists: Specialists; ctx: AimoContext; stage?: Stage;
    /** The buyer's own words for an edit ("cheaper chicken"), passed to the product agent. */
    request?: string;
    /** Fetch candidate prices before the pick so the product agent can compare them (edits only). */
    priceCandidates?: boolean;
    /** Products that must not be picked (already on the draft, e.g. when covering the rest of a line). */
    excludeProductIds?: ReadonlySet<string>;
  },
): Promise<Sourced> {
  const { specialists, ctx } = deps;
  const stage: Stage = deps.stage ?? (async () => {});
  const lang = intake.lang ?? 'en';
  const date = intake.deliveryDate ?? '';
  const exceptions: string[] = [];

  await stage('search', 'start');
  const excluded = deps.excludeProductIds;
  const candidates = new Map(components.map((c) => [c.id, findCandidates(c).filter((p) => !excluded?.has(p.id))]));
  for (const c of components) if (!candidates.get(c.id)!.length) exceptions.push(`${c.label}: no matching product in the catalogue`);
  const found = [...candidates.values()].flat();
  await stage('search', 'done', {
    count: unique(found.map((p) => p.id)).length,
    ticker: unique(found.map((p) => productName(p, lang))).slice(0, TICKER),
  });

  let candidatePrices: Map<string, PriceInfo> | undefined;
  if (deps.priceCandidates && date && found.length) {
    // On failure the pick runs without prices; the price step below reports the outage.
    candidatePrices = await getPrices(unique(found.map((p) => p.id)), date).catch(() => undefined);
  }
  // Connect to the aimo-products MCP server while the product agent thinks; the allergen step uses it.
  void getProductTools();
  const ranked = await rankAll(components, candidates, lang, specialists, { prices: candidatePrices, request: deps.request }, ctx);
  audit(ctx.conversationId, 'product', 'pickProducts', `Picked products for ${ranked.length} components`,
    ranked.map((r) => ({ componentId: r.component.id, productId: r.ranked[0], reason: r.reason })));

  await stage('allergens', 'start');
  let selections: Selection[] = [];
  for (const r of ranked) {
    const sel = await screenAllergens(r, specialists, ctx);
    if (sel) { selections.push(sel); continue; }
    exceptions.push(`${reasonText({ kind: 'noSafeProduct', label: r.component.label }, lang)}; ask the buyer what to use instead`);
    audit(ctx.conversationId, 'allergen', 'noSafeProduct', `${r.component.label}: every candidate conflicts with the diets; left out`,
      { componentId: r.component.id, candidates: r.ranked });
  }
  const constrained = selections.filter((s) => isConstrained(s.component));
  for (const s of constrained) {
    if (s.allergen.verdict !== 'pass') {
      exceptions.push(`${s.component.label}: ${productName(s.product, lang)} allergens unknown (${s.allergen.evidence ?? 'no evidence'}); the buyer must confirm this line in Review`);
    }
  }
  audit(ctx.conversationId, 'allergen', 'checkAllergens',
    `Checked ${constrained.length} diet lines: ${constrained.filter((s) => s.allergen.verdict === 'pass').length} pass, ${constrained.filter((s) => s.allergen.verdict === 'unknown').length} unknown, ${constrained.filter((s) => s.allergen.verdict === 'fail').length} fail`,
    selections.map((s) => s.allergen));
  await stage('allergens', 'done', { count: selections.length });

  await stage('prices', 'start');
  const ids = unique(selections.flatMap((s) => [s.product.id, ...s.alternatives]));
  let prices = new Map<string, PriceInfo>();
  let availability = new Map<string, AvailabilityInfo>();
  let priced = false;
  if (ids.length && date) {
    try {
      [prices, availability] = await Promise.all([getPrices(ids, date), getAvailability(ids, date)]);
      priced = true;
    } catch (err) {
      exceptions.push('Valio prices and stock are unavailable right now; prices are missing');
      audit(ctx.conversationId, 'pricing', 'getPrices', `Valio API failed: ${(err as Error).message}`);
    }
  }
  selections = selections.map((s) => {
    const { selection, problem } = substitute(s, availability, date, lang);
    if (problem) exceptions.push(problem);
    if (selection.substituteFor) {
      exceptions.push(`${s.component.label}: swapped to a similar product: "${selection.substituteFor.reason}"`);
      audit(ctx.conversationId, 'pricing', 'substitute', `Swapped ${s.product.nameEn} → ${selection.product.nameEn}: ${selection.substituteFor.reason}`,
        { from: s.product.id, to: selection.product.id });
    }
    return selection;
  });
  if (priced) audit(ctx.conversationId, 'pricing', 'getPrices', `Priced ${ids.length} products for ${date}`, { ids });
  await stage('prices', 'done', { count: ids.length });

  return { selections, prices, availability, exceptions };
}

const ORIGIN_TAG: Partial<Record<MenuComponent['origin'], LineTag>> = { needed_for_cooking: 'needed_for_cooking', addon: 'addon' };

export function toLine(
  sel: Selection, id: string, lang: Lang, sourced: Pick<Sourced, 'prices' | 'availability'>, requestedDate: string,
): DraftLine {
  const { component: c, product: p } = sel;
  const plan = packsFor(c.requiredAmount, p);
  const tags: LineTag[] = [];
  const originTag = ORIGIN_TAG[c.origin];
  if (originTag) tags.push(originTag);
  if (c.dietVariantOf) tags.push('diet_variant');
  if (sel.substituteFor) tags.push('substitute');
  if (sel.allergen.verdict === 'unknown') tags.push('allergens_unknown');
  const line: DraftLine = {
    id, componentId: c.id, group: c.category, productId: p.id, productName: productName(p, lang),
    packDescription: p.packDescription, packs: plan.packs, quantity: plan.quantity, unit: plan.unit,
    unitPrice: null, unitPriceWithTax: null, tags,
    ...(c.dietVariantOf ? { dietGuests: c.guests } : {}),
    allergen: sel.allergen,
    ...(sel.substituteFor ? { substituteFor: sel.substituteFor } : {}),
    alternatives: sel.alternatives,
  };
  return repriceLine(line, p, sourced.prices.get(p.id), sourced.availability.get(p.id), requestedDate);
}

// ── Stock ──

interface Fitted { componentId: string; components: MenuComponent[]; lines: DraftLine[]; problem?: string }

/**
 * Keeps a Stock line within the stock Valio reports for it. The guests the stock can't cover move to the
 * first same-kind alternative with enough stock (a separate component and line tagged substitute);
 * without one, the line is capped and the shortfall reported.
 */
export function fitToStock(
  sel: Selection, line: DraftLine, sourced: Pick<Sourced, 'prices' | 'availability'>,
  opts: { date: string; lang: Lang; eventType: EventType },
): Fitted {
  const { component: c, product: p } = sel;
  const keep: Fitted = { componentId: c.id, components: [c], lines: [line] };
  const a = sourced.availability.get(p.id);
  // Undeliverable products are the substitution path's business (they stay tagged unavailable).
  const inStock = a?.logisticModel === 'Stock' && deliverableOn(a, opts.date) ? availablePacks(p, a) : null;
  if (inStock === null || inStock >= line.packs) return keep;

  const lot = Math.max(1, p.allowedLotSize);
  const stockPacks = Math.floor(inStock / lot) * lot;
  const name = productName(p, opts.lang);
  const reason = reasonText({ kind: 'shortStock', packs: stockPacks, label: c.label }, opts.lang);
  const portion = c.requiredAmount / Math.max(1, c.guests);
  const servedGuests = Math.min(c.guests, Math.floor((stockPacks * p.packSize) / portion));
  const resize = (comp: MenuComponent, id: string, guests: number): MenuComponent => ({
    ...comp, id, guests, requiredAmount: requiredAmount(comp.category, opts.eventType, guests).amount,
  });

  const rest = resize(c, `${c.id}-more`, c.guests - servedGuests);
  for (const altId of sel.alternatives) {
    const alt = getProduct(altId);
    const altAvail = sourced.availability.get(altId);
    if (!alt || !altAvail || !deliverableOn(altAvail, opts.date)) continue;
    const check = checkAllergens([altId], constraintsOf(c))[0];
    if (check.verdict === 'fail' || (sel.allergen.verdict === 'pass' && check.verdict !== 'pass')) continue;
    const altStock = altAvail.logisticModel === 'Stock' ? availablePacks(alt, altAvail) : null;
    if (altStock !== null && altStock < packsFor(rest.requiredAmount, alt).packs) continue;

    const topUp: Selection = {
      component: rest, product: alt, allergen: check, reason: sel.reason,
      alternatives: sel.alternatives.filter((id) => id !== altId),
      substituteFor: { productId: p.id, productName: name, reason },
    };
    const topUpLine = toLine(topUp, 'l-0', opts.lang, sourced, opts.date);
    const problem = `${c.label}: "${reason}"`;
    if (servedGuests === 0) return { componentId: c.id, components: [rest], lines: [topUpLine], problem };
    const served = resize(c, c.id, servedGuests);
    return {
      componentId: c.id,
      components: [served, rest],
      lines: [toLine({ ...sel, component: served }, 'l-0', opts.lang, sourced, opts.date), topUpLine],
      problem,
    };
  }

  const problem = `${c.label}: only ${stockPacks} packs in stock (needed ${line.packs}) and no same-kind product has enough; ` +
    (stockPacks > 0 ? 'the line is capped, ask the buyer how to cover the rest' : 'the line is left out, ask the buyer what to use instead');
  if (stockPacks === 0) return { componentId: c.id, components: [], lines: [], problem };
  const quantity = Math.round(stockPacks * p.packSize * 1e6) / 1e6;
  // The component now asks for what is ordered, so history notes are based on the capped amount.
  return {
    componentId: c.id,
    components: [{ ...c, requiredAmount: quantity }],
    lines: [repriceLine({ ...line, packs: stockPacks, quantity }, p, line.price, line.availability, opts.date)],
    problem,
  };
}

// ── History ──

export function attachHistory(
  lines: DraftLine[], components: MenuComponent[], eventType: EventType, customerId: string, requestedDate: string,
): DraftLine[] {
  const records = listLeftoverRecords(customerId);
  const today = now();
  return lines.map((line) => {
    const c = components.find((x) => x.id === line.componentId);
    const product = getProduct(line.productId);
    // No note on a line that can't be delivered: there is nothing to adjust.
    if (!c || !product || (line.availability && !deliverableOn(line.availability, requestedDate))) return line;
    const adjustment = computeHistoryAdjustment({
      productId: line.productId, category: line.group, eventType, suggestedQty: c.requiredAmount, unit: c.requiredUnit, records, now: today,
    });
    if (!adjustment) return line;
    let historyPacks = packsFor(adjustment.adjustedQty, product).packs;
    // History never suggests more than a Stock product has.
    const inStock = line.availability?.logisticModel === 'Stock' ? availablePacks(product, line.availability) : null;
    if (inStock !== null) {
      const lot = Math.max(1, product.allowedLotSize);
      historyPacks = Math.min(historyPacks, Math.floor(inStock / lot) * lot);
    }
    // A note that would not change the order, or would order nothing, is noise.
    if (historyPacks === line.packs || historyPacks === 0) return line;
    return { ...line, history: { adjustment, historyPacks, suggestedPacks: line.packs, choice: 'pending' as const } };
  });
}

// ── The plan ──

export interface PlanSummary {
  lineCount: number;
  total: { low: number; high: number; lowWithTax: number; highWithTax: number };
  budget: number | null;
  overBudget: boolean;
  cutoff: string | null;
  historyNotes: number;
  exceptions: string[];
}

/** The earliest order cut-off for delivery on `requestedDate` among the lines (see effectiveCutoff). */
export function earliestCutoff(lines: DraftLine[], requestedDate: string): string | null {
  const cutoffs = lines.map((l) => (l.availability ? effectiveCutoff(l.availability, requestedDate) : null))
    .filter((t): t is string => !!t);
  return cutoffs.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

/** Runs menu → product → allergen → pricing → history → order for the conversation's intake. */
export async function buildDraft(
  { draft, addons, ctx }: { draft: Draft; addons: string[]; ctx: AimoContext },
  { specialists, emit }: { specialists: Specialists; emit: Emit },
): Promise<{ draft: Draft; summary: PlanSummary }> {
  const { intake } = draft;
  const lang = intake.lang ?? 'en';
  const eventType = intake.eventType ?? 'other';
  const stage: Stage = (step, status, extra) => progress(emit, lang, step, status, extra);

  await stage('understand', 'start');
  const plans = await specialists.planMenu({ intake, addons }).catch((err: unknown) => {
    audit(ctx.conversationId, 'menu', 'planMenu', `Menu agent failed: ${(err as Error).message}`);
    throw new Error('The menu planner is unavailable right now, so no draft was made. Tell the buyer briefly and offer to try again.');
  });
  // Code, not the menu agent, decides how many guests each diet variant and its base serve.
  const split = fitDietSplit(plans, intake.diets, intake.guests);
  const { components: planned, dropped } = toComponents(split.plans, eventType);
  let components = applyDietRules(planned, intake.diets);
  audit(ctx.conversationId, 'menu', 'planMenu', `Planned ${components.length} components: ${components.map((c) => c.label).join(', ')}`, components);
  const splitNote = dietSplitNote(components);
  if (splitNote || split.merged.length) {
    const folded = split.merged.length ? ` Variants serving every guest were folded into their base dish, which must then suit everyone: ${split.merged.join(', ')}.` : '';
    audit(ctx.conversationId, 'menu', 'fitDietSplit',
      `${splitNote ? `Portions sized by the buyer's diet counts: ${splitNote}.` : ''}${folded}`.trim(),
      { diets: intake.diets, merged: split.merged, components: components.map((c) => ({ id: c.id, guests: c.guests, dietVariantOf: c.dietVariantOf })) });
  }
  if (dropped.length) {
    audit(ctx.conversationId, 'menu', 'dropOrphanVariants',
      `Dropped diet variants of unknown components: ${dropped.map((p) => `${p.label} (variant of ${p.dietVariantOf})`).join(', ')}`, dropped);
  }
  const tightened = components.filter((c, i) => c !== planned[i]);
  if (tightened.length) {
    audit(ctx.conversationId, 'menu', 'applyDietRules',
      `Shared items must suit every diet: constrained ${tightened.map((c) => c.label).join(', ')}`,
      tightened.map((c) => ({ id: c.id, requiredDiet: c.requiredDiet, excludeAllergens: c.excludeAllergens })));
  }
  await stage('understand', 'done', { count: components.length });
  await stage('ingredients', 'start');
  await stage('ingredients', 'done', { count: components.length, ticker: components.map((c) => c.label) });

  const sourced = await sourceComponents(components, intake, { specialists, ctx, stage });
  const date = intake.deliveryDate ?? '';
  const fitted = sourced.selections.map((s) => fitToStock(s, toLine(s, 'l-0', lang, sourced, date), sourced, { date, lang, eventType }));
  const stockProblems = fitted.flatMap((f) => (f.problem ? [f.problem] : []));
  components = components.flatMap((c) => fitted.find((f) => f.componentId === c.id)?.components ?? [c]);
  let lines = fitted.flatMap((f) => f.lines).map((l, i) => ({ ...l, id: `l-${i + 1}` }));

  await stage('history', 'start');
  lines = attachHistory(lines, components, eventType, ctx.customerId, date);
  const historyNotes = lines.filter((l) => l.history).length;
  audit(ctx.conversationId, 'history', 'getHistoryAdjustment', `History notes on ${historyNotes} of ${lines.length} lines`,
    lines.filter((l) => l.history).map((l) => ({ lineId: l.id, ...l.history })));
  await stage('history', 'done', { count: historyNotes });

  await stage('draft', 'start');
  const totals = computeTotals(lines, intake.budget);
  const today = now();
  const cutoff = earliestCutoff(lines, intake.deliveryDate ?? '');
  const exceptions = [...sourced.exceptions, ...stockProblems];
  if (cutoff && Date.parse(cutoff) < today.getTime()) {
    const passed = `The order cut-off has passed for ${intake.deliveryDate} (${cutoff}); offer the next possible date`;
    exceptions.push(passed);
    audit(ctx.conversationId, 'pricing', 'cutoffPassed', passed, { cutoff, deliveryDate: intake.deliveryDate });
  }
  const next: Draft = {
    ...draft, components, lines, totals, cutoff, status: 'ready', updatedAt: today.toISOString(),
  };
  saveDraft(next);
  await emit({ type: 'data-draft', data: { draft: next } });
  audit(ctx.conversationId, 'order', 'buildDraft',
    `Built draft with ${lines.length} lines, €${round2(totals.low)}–€${round2(totals.high)} excl. VAT`, { draftId: next.id });
  await stage('draft', 'done', { count: lines.length });

  return {
    draft: next,
    summary: {
      lineCount: lines.length,
      total: { low: round2(totals.low), high: round2(totals.high), lowWithTax: round2(totals.lowWithTax), highWithTax: round2(totals.highWithTax) },
      budget: totals.budget,
      overBudget: totals.overBudget,
      cutoff: next.cutoff,
      historyNotes,
      exceptions,
    },
  };
}
