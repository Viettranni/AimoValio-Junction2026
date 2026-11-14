import type {
  Allergen, AllergenCheck, AvailabilityInfo, CatalogProduct, DietFlag, Draft, DraftLine, EventType, Intake, Lang, LineTag,
  MenuComponent, PriceInfo, ProgressEvent, ProgressStepId, SearchHit,
} from '@/contracts';
import { checkAllergens, getProduct, searchProducts } from '@/catalog';
import { listLeftoverRecords, now, saveDraft } from '@/db/repo';
import { deliverableOn, effectiveCutoff } from '@/domain/cutoff';
import { computeHistoryAdjustment } from '@/domain/history';
import { requiredAmount } from '@/domain/portions';
import { packsFor } from '@/domain/quantities';
import { computeTotals } from '@/domain/totals';
import { getAvailability, getPrices } from '@/valio/client';
import type { MenuComponentPlan } from '../agents/menu';
import type { AimoContext } from '../context';
import { audit, progress, type Emit } from '../events';
import type { Specialists } from '../specialists';
import { repriceLine } from './reprice';

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

const DIET_FLAGS: ReadonlySet<string> = new Set<DietFlag>(['lactose_free', 'gluten_free', 'vegan', 'vegetarian']);

/** Flags whose own ingredient rules guarantee another diet flag (one-way). */
const FLAG_COVERED_BY: Record<DietFlag, DietFlag[]> = {
  gluten_free: ['gluten_free'],
  lactose_free: ['lactose_free', 'vegan'],
  vegetarian: ['vegetarian', 'vegan'],
  vegan: ['vegan'],
};
/** An excluded allergen that is enough for a diet flag. Never for vegan/vegetarian (other animal ingredients). */
const FLAG_COVERED_BY_EXCLUSION: Partial<Record<DietFlag, Allergen>> = { gluten_free: 'gluten', lactose_free: 'milk' };
/** Allergens a diet flag guarantees absent. Lactose-free dairy still contains milk protein, so lactose_free covers none. */
const FLAG_EXCLUDES: Record<DietFlag, Allergen[]> = {
  gluten_free: ['gluten'],
  lactose_free: [],
  vegan: ['milk', 'egg', 'fish', 'crustaceans', 'molluscs'],
  vegetarian: ['fish', 'crustaceans', 'molluscs'],
};

/** Whether a diet variant safely serves guests with this need (coverage is one-way, never inferred backwards). */
function variantCovers(v: MenuComponent, need: DietFlag | Allergen): boolean {
  const flags = v.requiredDiet ?? [];
  const excluded = v.excludeAllergens ?? [];
  if (DIET_FLAGS.has(need)) {
    const diet = need as DietFlag;
    const byExclusion = FLAG_COVERED_BY_EXCLUSION[diet];
    return FLAG_COVERED_BY[diet].some((f) => flags.includes(f)) || (!!byExclusion && excluded.includes(byExclusion));
  }
  const allergen = need as Allergen;
  return excluded.includes(allergen) || flags.some((f) => FLAG_EXCLUDES[f].includes(allergen));
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
    const open = unique(diets.map((d) => d.diet)).filter((need) => !variants.some((v) => variantCovers(v, need)));
    if (!open.length) return c;
    const requiredDiet = unique([...(c.requiredDiet ?? []), ...open.filter((d): d is DietFlag => DIET_FLAGS.has(d))]);
    const excludeAllergens = unique([...(c.excludeAllergens ?? []), ...open.filter((d): d is Allergen => !DIET_FLAGS.has(d))]);
    return {
      ...c,
      ...(requiredDiet.length ? { requiredDiet } : {}),
      ...(excludeAllergens.length ? { excludeAllergens } : {}),
    };
  });
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
  extra: { prices?: Map<string, PriceInfo>; request?: string },
): Promise<Ranked[]> {
  const searchable = components.filter((c) => (candidates.get(c.id) ?? []).length > 0);
  if (searchable.length === 0) return [];
  const picks = await specialists.pickProducts({ lang, components: searchable, candidates, ...extra });
  return searchable.map((component) => {
    const ids = candidates.get(component.id)!.map((p) => p.id);
    const pick = picks.find((p) => p.componentId === component.id);
    const chosen = pick && ids.includes(pick.productId) ? pick.productId : ids[0];
    const alternatives = (pick?.alternatives ?? []).filter((id) => ids.includes(id));
    return { component, ranked: unique([chosen, ...alternatives, ...ids]), reason: pick?.reason ?? 'Best catalogue match' };
  });
}

/** Takes the first verified-safe candidate; "unknown" only when nothing passes (allergen agent judges among several). */
async function screenAllergens({ component, ranked, reason }: Ranked, specialists: Specialists): Promise<Selection> {
  const checks = checkAllergens(ranked, constraintsOf(component));
  let chosen = checks.find((c) => c.verdict === 'pass');
  if (!chosen) {
    const unknowns = checks.filter((c) => c.verdict === 'unknown');
    chosen = unknowns[0] ?? checks[0];
    if (unknowns.length > 1) {
      const products = unknowns.map((c) => getProduct(c.productId)).filter((p): p is CatalogProduct => !!p);
      const choice = await specialists.chooseUnknownFallback({ component, candidates: products });
      const picked = unknowns.find((c) => c.productId === choice.productId);
      if (picked) chosen = { ...picked, evidence: [picked.evidence, choice.note].filter(Boolean).join('. ') };
    }
  }
  const alternatives = checks
    .filter((c) => c.productId !== chosen.productId && c.verdict !== 'fail')
    .slice(0, ALTERNATIVES).map((c) => c.productId);
  return { component, product: getProduct(chosen.productId)!, alternatives, reason, allergen: chosen };
}

/** Swaps an undeliverable / blocked product for the first deliverable alternative that is no less safe. */
function substitute(
  sel: Selection, availability: Map<string, AvailabilityInfo>, date: string, lang: Lang,
): { selection: Selection; problem?: string } {
  const a = availability.get(sel.product.id);
  if (!a || deliverableOn(a, date)) return { selection: sel };
  const late = a.deliverable && !a.salesBlock;
  const reason = a.salesBlock ? 'Sales block on the product' : late ? `Earliest delivery ${a.availableDate}` : `Not deliverable on ${date}`;
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
  const earliest = !late && a.availableDate && a.availableDate > date ? `; earliest ${a.availableDate}` : '';
  return { selection: sel, problem: `${sel.component.label}: ${sel.product.nameEn} ${reason.toLowerCase()}${earliest}, and no alternative deliverable by ${date}` };
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
  },
): Promise<Sourced> {
  const { specialists, ctx } = deps;
  const stage: Stage = deps.stage ?? (async () => {});
  const lang = intake.lang ?? 'en';
  const date = intake.deliveryDate ?? '';
  const exceptions: string[] = [];

  await stage('search', 'start');
  const candidates = new Map(components.map((c) => [c.id, findCandidates(c)]));
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
  const ranked = await rankAll(components, candidates, lang, specialists, { prices: candidatePrices, request: deps.request });
  audit(ctx.conversationId, 'product', 'pickProducts', `Picked products for ${ranked.length} components`,
    ranked.map((r) => ({ componentId: r.component.id, productId: r.ranked[0], reason: r.reason })));

  await stage('allergens', 'start');
  let selections: Selection[] = [];
  for (const r of ranked) selections.push(await screenAllergens(r, specialists));
  const constrained = selections.filter((s) => isConstrained(s.component));
  for (const s of constrained) {
    if (s.allergen.verdict !== 'pass') {
      exceptions.push(`${s.component.label}: ${s.product.nameEn} allergens ${s.allergen.verdict === 'fail' ? 'conflict' : 'unknown'} (${s.allergen.evidence ?? 'no evidence'})`);
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
      const summary = `Swapped ${s.product.nameEn} → ${selection.product.nameEn}: ${selection.substituteFor.reason}`;
      exceptions.push(`${s.component.label}: ${summary}`);
      audit(ctx.conversationId, 'pricing', 'substitute', summary, { from: s.product.id, to: selection.product.id });
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

// ── History ──

export function attachHistory(lines: DraftLine[], components: MenuComponent[], eventType: EventType, customerId: string): DraftLine[] {
  const records = listLeftoverRecords(customerId);
  const today = now();
  return lines.map((line) => {
    const c = components.find((x) => x.id === line.componentId);
    const product = getProduct(line.productId);
    if (!c || !product) return line;
    const adjustment = computeHistoryAdjustment({
      productId: line.productId, category: line.group, eventType, suggestedQty: c.requiredAmount, unit: c.requiredUnit, records, now: today,
    });
    if (!adjustment) return line;
    const historyPacks = packsFor(adjustment.adjustedQty, product).packs;
    // A note that would not change the order is noise.
    if (historyPacks === line.packs) return line;
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
  const { components: planned, dropped } = toComponents(await specialists.planMenu({ intake, addons }), eventType);
  const components = applyDietRules(planned, intake.diets);
  audit(ctx.conversationId, 'menu', 'planMenu', `Planned ${components.length} components: ${components.map((c) => c.label).join(', ')}`, components);
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
  let lines = sourced.selections.map((s, i) => toLine(s, `l-${i + 1}`, lang, sourced, intake.deliveryDate ?? ''));

  await stage('history', 'start');
  lines = attachHistory(lines, components, eventType, ctx.customerId);
  const historyNotes = lines.filter((l) => l.history).length;
  audit(ctx.conversationId, 'history', 'getHistoryAdjustment', `History notes on ${historyNotes} of ${lines.length} lines`,
    lines.filter((l) => l.history).map((l) => ({ lineId: l.id, ...l.history })));
  await stage('history', 'done', { count: historyNotes });

  await stage('draft', 'start');
  const totals = computeTotals(lines, intake.budget);
  const today = now();
  const cutoff = earliestCutoff(lines, intake.deliveryDate ?? '');
  const exceptions = [...sourced.exceptions];
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
