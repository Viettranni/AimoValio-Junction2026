// The widget's event-ordering flow for external agents: plan an event → edit the draft → check out → order
// (or human approval) → report leftovers. Same pipeline, domain rules and storage as the widget; deterministic
// edits (the agent says exactly what to change), so no model call except the menu/product planning in planEvent.
import { randomUUID } from 'node:crypto';
import type {
  AllergenCheck, CatalogProduct, DietNeed, Draft, DraftChange, DraftDiff, DraftLine, EventType, Intake, LineTag, PortionCategory,
} from '@/contracts';
import { checkAllergens, getProduct } from '@/catalog';
import { getDb } from '@/db/client';
import {
  appendAudit, getDraftById, getReceipt, listLeftoverRecords, listOrders as listOrderSummaries, now as clockNow, saveDraft,
} from '@/db/repo';
import { deliverableOn } from '@/domain/cutoff';
import { applyDraftChange } from '@/domain/draft';
import { computeTotals } from '@/domain/totals';
import { noEmit } from '@/mastra/events';
import { applyDietRules, buildDraft, earliestCutoff, productName, toComponent, toLine } from '@/mastra/pipeline/build-draft';
import { reasonText } from '@/mastra/pipeline/reasons';
import { availablePacks, repriceLine } from '@/mastra/pipeline/reprice';
import { sameKind } from '@/mastra/pipeline/same-kind';
import { defaultSpecialists, type Specialists } from '@/mastra/specialists';
import { coverage, nextLineId } from '@/mastra/tools/edit-draft';
import { validateIntake } from '@/mastra/tools/understand-request';
import { NotFoundError } from '@/server/orders';
import { submitCheckIn } from '@/server/checkin';
import { fetchValio, STALE_PRICE_MS } from './lookup';
import { actorFor, GatewayError, quote } from './offers';
import { placeOrder } from './orders';
import { listApprovalRows, listOffers, saveOffer } from './store';
import type { Change, GatewayContext, OfferLine, OrderPreferences, PlaceOrderResult, Requirements } from './types';

const MAX_GUESTS = 5000;
const catalog = { getProduct };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Agent drafts live under conversation ids `mcp:<customerId>:…` (planEvent and chatWithAimo). */
const ownsConversation = (customerId: string, conversationId: string) => conversationId.startsWith(`mcp:${customerId}:`);

export function getOwnDraft(draftId: string, ctx: GatewayContext): Draft {
  const draft = getDraftById(draftId);
  if (!draft || draft.customerId !== ctx.agent.customerId || !ownsConversation(ctx.agent.customerId, draft.conversationId)) {
    throw new GatewayError(`No draft ${draftId}`, 'not_found');
  }
  return draft;
}

/** The draft as an agent sees it: lines with prices, tags, substitutions and history notes. */
export function draftView(d: Draft) {
  return {
    draftId: d.id,
    status: d.status,
    event: { name: d.intake.eventName ?? null, type: d.intake.eventType ?? null, deliveryDate: d.intake.deliveryDate ?? null, guests: d.intake.guests ?? null, diets: d.intake.diets ?? null, budget: d.intake.budget ?? null },
    lines: d.lines.map((l) => ({
      lineId: l.id, productId: l.productId, productName: l.productName, packDescription: l.packDescription,
      packs: l.packs, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, unitPriceWithTax: l.unitPriceWithTax,
      lineTotal: l.unitPrice === null ? null : round2(l.packs * l.unitPrice), tags: l.tags.filter((t) => t !== 'updated'),
      allergen: l.allergen.verdict, ...(l.dietGuests ? { dietGuests: l.dietGuests } : {}),
      ...(l.substituteFor ? { substituteFor: l.substituteFor } : {}),
      ...(l.history ? {
        history: {
          suggestedPacks: l.history.suggestedPacks, historyPacks: l.history.historyPacks, choice: l.history.choice,
          basis: l.history.adjustment.basis, ratio: round2(l.history.adjustment.ratio), last: l.history.adjustment.last,
        },
      } : {}),
    })),
    totals: {
      currency: 'EUR', low: round2(d.totals.low), high: round2(d.totals.high), lowWithTax: round2(d.totals.lowWithTax), highWithTax: round2(d.totals.highWithTax),
      budget: d.totals.budget, overBudget: d.totals.overBudget, note: 'excl. VAT; low/high differ while history notes are pending',
    },
    cutoff: d.cutoff,
    updatedAt: d.updatedAt,
  };
}

export interface PlanEventInput {
  deliveryDate: string;
  guests: number;
  menu: string[];
  diets?: DietNeed[];
  budget?: number | 'none';
  addons?: string[];
  eventType?: EventType;
  eventName?: string;
  lang?: string;
}

/** planEvent: the widget's planning pipeline (menu → products → allergens → prices/stock → history) for an agent. */
export async function planEvent(input: PlanEventInput, ctx: GatewayContext, deps: { specialists?: Specialists } = {}) {
  if (!Number.isInteger(input.guests) || input.guests < 1 || input.guests > MAX_GUESTS) throw new GatewayError(`guests must be 1 to ${MAX_GUESTS}`);
  if (!input.menu.length) throw new GatewayError('menu needs at least one dish');
  const today = clockNow();
  const raw: Intake = {
    deliveryDate: input.deliveryDate, guests: input.guests, menu: input.menu, budget: input.budget ?? 'none',
    diets: input.diets?.length ? input.diets : 'none', eventType: input.eventType ?? 'other',
    eventName: input.eventName ?? 'Event', lang: input.lang ?? 'en',
  };
  const { intake, warnings } = validateIntake(raw, today, null);
  if (!intake.deliveryDate) throw new GatewayError(warnings.join(' '));

  const conversationId = `mcp:${ctx.agent.customerId}:draft-${randomUUID()}`;
  const draft: Draft = {
    id: randomUUID(), conversationId, customerId: ctx.agent.customerId, intake, components: [], lines: [],
    totals: computeTotals([], intake.budget), cutoff: null, status: 'building', updatedAt: today.toISOString(),
  };
  saveDraft(draft);
  appendAudit({
    conversationId, actor: actorFor(ctx), action: 'planEvent',
    summary: `${ctx.agent.displayName} asked to plan ${intake.eventName} for ${intake.guests} guests on ${intake.deliveryDate}: ${input.menu.join(', ')}`,
    data: { input },
  });
  const { draft: planned, summary } = await buildDraft(
    { draft, addons: input.addons ?? [], ctx: { conversationId, customerId: ctx.agent.customerId } },
    { specialists: deps.specialists ?? defaultSpecialists, emit: noEmit },
  );
  return { ...draftView(planned), exceptions: summary.exceptions, warnings };
}

export function getDraft(draftId: string, ctx: GatewayContext) {
  return draftView(getOwnDraft(draftId, ctx));
}

export type AgentDraftChange =
  | { kind: 'setPacks'; lineId: string; packs: number }
  | { kind: 'removeLine'; lineId: string }
  | { kind: 'historyChoice'; lineId: string; choice: 'history' | 'suggested' }
  | { kind: 'scaleGuests'; guests: number }
  | { kind: 'swapProduct'; lineId: string; productId: string }
  | { kind: 'addProduct'; productId: string; packs?: number; quantity?: number; componentLabel?: string; category?: PortionCategory };

type Planned = { change: DraftChange; draft: Draft; after?: (d: Draft) => Draft; problems?: string[] };

const lineOf = (draft: Draft, lineId: string) => {
  const line = draft.lines.find((l) => l.id === lineId);
  if (!line) throw new GatewayError(`The draft has no line ${lineId}`);
  return line;
};

async function freshFor(product: CatalogProduct, date: string) {
  const { prices, avail } = await fetchValio([product.id], date);
  const price = prices.get(product.id);
  const availability = avail.get(product.id);
  if (!price?.ok || price.price === undefined) throw new GatewayError(`${product.nameEn}: Valio gives no price for it`);
  if (Date.now() - Date.parse(price.fetchedAt) > STALE_PRICE_MS) throw new GatewayError(`${product.nameEn}: the price could not be refreshed from Valio`);
  if (!availability || !deliverableOn(availability, date)) {
    throw new GatewayError(`${product.nameEn}: not deliverable on ${date}${availability?.availableDate ? ` (earliest ${availability.availableDate})` : ''}`);
  }
  return { prices, availability: avail, price, avail: availability };
}

async function planSwap(c: Extract<AgentDraftChange, { kind: 'swapProduct' }>, draft: Draft, ctx: GatewayContext): Promise<Planned> {
  const line = lineOf(draft, c.lineId);
  const component = draft.components.find((x) => x.id === line.componentId);
  const original = getProduct(line.productId);
  const product = getProduct(c.productId);
  if (!product) throw new GatewayError(`Unknown product ${c.productId}`);
  if (!component || !original) throw new GatewayError(`Line ${line.id} can't be swapped`);
  if (product.id === line.productId) throw new GatewayError(`Line ${line.id} already uses ${product.nameEn}`);
  if (!sameKind(component, original, product)) throw new GatewayError(`${product.nameEn} is not the same kind of product as ${original.nameEn} (${component.label})`);
  const constrained = !!(component.excludeAllergens?.length || component.requiredDiet?.length);
  const allergen = checkAllergens([product.id], { excludeAllergens: component.excludeAllergens, requireDiet: component.requiredDiet })[0];
  if (allergen.verdict === 'fail') throw new GatewayError(`${product.nameEn} conflicts with the diets for ${component.label}: ${allergen.evidence ?? allergen.conflicts.join(', ')}`);
  if (constrained && line.allergen.verdict === 'pass' && allergen.verdict !== 'pass') {
    throw new GatewayError(`${product.nameEn}'s allergens can't be verified for ${component.label}; the current product is verified safe`);
  }
  const date = draft.intake.deliveryDate ?? '';
  const fresh = await freshFor(product, date);
  const lang = draft.intake.lang ?? 'en';
  return {
    change: { kind: 'swapProduct', lineId: line.id, product, price: fresh.price, availability: fresh.avail, allergen, reason: `Chosen by ${ctx.agent.displayName}` },
    draft,
    after: (d) => ({
      ...d,
      lines: d.lines.map((l) => {
        if (l.id !== line.id) return l;
        const tags: LineTag[] = l.tags.filter((t) => t !== 'allergens_unknown');
        if (allergen.verdict === 'unknown') tags.push('allergens_unknown');
        return repriceLine({ ...l, productName: productName(product, lang), alternatives: [], tags }, product, fresh.price, fresh.avail, date);
      }),
    }),
  };
}

async function planAdd(c: Extract<AgentDraftChange, { kind: 'addProduct' }>, draft: Draft): Promise<Planned> {
  const product = getProduct(c.productId);
  if (!product) throw new GatewayError(`Unknown product ${c.productId}`);
  if (c.packs !== undefined && c.quantity !== undefined) throw new GatewayError('Give packs or quantity, not both');
  const date = draft.intake.deliveryDate ?? '';
  const lang = draft.intake.lang ?? 'en';
  const eventType = draft.intake.eventType ?? 'other';
  const fresh = await freshFor(product, date);
  const sourced = { prices: fresh.prices, availability: fresh.availability };

  // Same kind as a dish on the draft that is still short → top-up of that dish, not a new item.
  const existing = draft.components.find((comp) => draft.lines.some((l) => {
    const p = l.componentId === comp.id && getProduct(l.productId);
    return !!p && sameKind(comp, p, product);
  }));
  let line: DraftLine;
  let components = draft.components;
  if (existing && coverage(draft, existing).remaining > 1e-9) {
    const { remaining, lines } = coverage(draft, existing);
    const anchor = lines[0];
    const allergen = checkAllergens([product.id], { excludeAllergens: existing.excludeAllergens, requireDiet: existing.requiredDiet })[0];
    if (allergen.verdict === 'fail') throw new GatewayError(`${product.nameEn} conflicts with the diets for ${existing.label}`);
    const share = { ...existing, requiredAmount: c.quantity ?? (c.packs !== undefined ? c.packs * product.packSize : remaining) };
    line = toLine({
      component: share, product, allergen, reason: 'Added by the purchasing agent', alternatives: [],
      ...(anchor ? { substituteFor: { productId: anchor.productId, productName: anchor.productName, reason: reasonText({ kind: 'coversRest', product: anchor.productName }, lang) } } : {}),
    }, nextLineId(draft), lang, sourced, date);
    line = { ...line, tags: [...line.tags.filter((t) => t !== 'addon' && t !== 'substitute'), 'substitute'] };
  } else {
    if (c.packs === undefined && c.quantity === undefined) throw new GatewayError(`Give packs or quantity for ${product.nameEn}`);
    const amount = c.quantity ?? c.packs! * product.packSize;
    const id = `c-add-${draft.components.length + 1}`;
    const base = toComponent({
      id, label: c.componentLabel ?? productName(product, lang), searchTerms: { fi: product.nameFi, en: product.nameEn }, category: c.category ?? 'salad',
      origin: 'addon', guests: draft.intake.guests ?? 0, dietVariantOf: null, requiredDiet: null, excludeAllergens: null,
    }, id, eventType);
    // A new item is shared by every guest, so it must meet every diet (same rule as planning).
    const [component] = applyDietRules([{ ...base, requiredAmount: amount, requiredUnit: product.packUnit }], draft.intake.diets);
    const allergen = checkAllergens([product.id], { excludeAllergens: component.excludeAllergens, requireDiet: component.requiredDiet })[0];
    if (allergen.verdict === 'fail') throw new GatewayError(`${product.nameEn} conflicts with the event's diets: ${allergen.evidence ?? allergen.conflicts.join(', ')}`);
    line = toLine({ component, product, allergen, reason: 'Added by the purchasing agent', alternatives: [] }, nextLineId(draft), lang, sourced, date);
    components = [...draft.components, component];
  }
  if (c.packs !== undefined && line.packs !== c.packs) {
    const lot = Math.max(1, product.allowedLotSize);
    const packs = Math.ceil(c.packs / lot) * lot;
    line = repriceLine({ ...line, packs, quantity: Math.round(packs * product.packSize * 1e6) / 1e6 }, product, line.price, line.availability, date);
  }
  return { change: { kind: 'addLine', line }, draft: { ...draft, components } };
}

/** updateDraft: deterministic edits, all or nothing. Swaps and adds are validated (same kind, diets, fresh price and stock). */
export async function updateDraft(draftId: string, changes: AgentDraftChange[], ctx: GatewayContext) {
  const start = getOwnDraft(draftId, ctx);
  if (start.status !== 'ready') throw new GatewayError(start.status === 'submitted' ? 'This draft was already ordered' : 'The draft is not planned yet', 'conflict');
  if (!changes.length) throw new GatewayError('No changes given');

  let draft = start;
  const changed = new Set<string>();
  const removed = new Set<string>();
  const added = new Set<string>();
  for (const c of changes) {
    let planned: Planned;
    switch (c.kind) {
      case 'setPacks':
        lineOf(draft, c.lineId);
        if (!Number.isInteger(c.packs) || c.packs < 0) throw new GatewayError('packs must be a whole number ≥ 0');
        planned = { change: c, draft };
        break;
      case 'removeLine':
        lineOf(draft, c.lineId);
        planned = { change: c, draft };
        break;
      case 'historyChoice':
        if (!lineOf(draft, c.lineId).history) throw new GatewayError(`Line ${c.lineId} has no history note`);
        planned = { change: c, draft };
        break;
      case 'scaleGuests':
        if (!Number.isInteger(c.guests) || c.guests < 1 || c.guests > MAX_GUESTS) throw new GatewayError(`guests must be 1 to ${MAX_GUESTS}`);
        planned = { change: c, draft };
        break;
      case 'swapProduct':
        planned = await planSwap(c, draft, ctx);
        break;
      case 'addProduct':
        planned = await planAdd(c, draft);
        break;
    }
    const result = applyDraftChange(planned.draft, planned.change, catalog);
    draft = planned.after ? planned.after(result.draft) : result.draft;
    result.diff.changedLineIds.forEach((id) => changed.add(id));
    result.diff.removedLineIds.forEach((id) => { removed.add(id); changed.delete(id); added.delete(id); });
    result.diff.addedLineIds.forEach((id) => added.add(id));
  }

  // Same finishing as the widget's editDraft: re-derive stock tags of touched lines, totals and cut-off.
  const touched = new Set([...changed, ...added]);
  const date = draft.intake.deliveryDate ?? '';
  const problems: string[] = [];
  const lines: DraftLine[] = draft.lines.map((l) => {
    const tags = l.tags.filter((t) => t !== 'updated');
    if (!touched.has(l.id)) return { ...l, tags };
    const product = getProduct(l.productId);
    const repriced = product ? repriceLine(l, product, l.price, l.availability, date) : l;
    const inStock = product && l.availability?.logisticModel === 'Stock' ? availablePacks(product, l.availability) : null;
    if (inStock !== null && inStock < l.packs) problems.push(`${l.productName}: only ${inStock} packs in stock (line has ${l.packs})`);
    return { ...repriced, tags: [...repriced.tags.filter((t) => t !== 'updated'), 'updated'] };
  });
  draft = { ...draft, lines, totals: computeTotals(lines, draft.intake.budget), cutoff: earliestCutoff(lines, date), updatedAt: clockNow().toISOString() };
  const latest = getDraftById(draftId);
  if (!latest || latest.updatedAt !== start.updatedAt || latest.status !== 'ready') {
    throw new GatewayError('The draft changed while this update was being prepared; nothing was changed. Read it again with getDraft.', 'conflict');
  }
  saveDraft(draft);
  const diff: DraftDiff = { changedLineIds: [...changed].filter((id) => !added.has(id)), removedLineIds: [...removed], addedLineIds: [...added] };
  appendAudit({
    conversationId: draft.conversationId, actor: actorFor(ctx), action: 'updateDraft',
    summary: `${ctx.agent.displayName} changed the draft: ${changes.map((c) => c.kind).join(', ')}`, data: { changes, diff },
  });
  return { ...draftView(draft), diff, problems };
}

const RANK: Record<AllergenCheck['verdict'], number> = { pass: 0, unknown: 1, fail: 2 };

/**
 * checkoutDraft: the draft's lines become a fixed-price offer (fresh Valio prices), then placeOrder applies the policy.
 * A price that differs from the draft is never taken silently: the draft is re-priced and `requote` returned.
 * Unknown-allergen lines always go to a human (the policy's allergen rule); pending history notes keep the draft's packs.
 */
export async function checkoutDraft(
  input: { draftId: string; requirements?: Requirements; preferences?: OrderPreferences }, ctx: GatewayContext,
): Promise<PlaceOrderResult & { draftId: string }> {
  const draft = getOwnDraft(input.draftId, ctx);
  if (draft.status === 'submitted') throw new GatewayError('This draft was already ordered', 'conflict');
  if (draft.status !== 'ready' || !draft.intake.deliveryDate) throw new GatewayError('The draft is not planned yet', 'conflict');
  const pending = listOffers(ctx.agent.customerId).find((o) => o.draftId === draft.id && o.status === 'pending_approval');
  if (pending) return { ...(await placeOrder({ offerId: pending.offerId }, ctx)), draftId: draft.id };
  const lines = draft.lines.filter((l) => l.packs > 0);
  if (!lines.length) throw new GatewayError('The draft has no lines to order');

  const offer = await quote({
    deliveryDate: draft.intake.deliveryDate,
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.packs, unit: 'packs' as const, ref: l.id })),
    ...(input.requirements ? { requirements: input.requirements } : {}),
  }, ctx, { draftId: draft.id });
  // The event's diets were checked per dish at planning time; keep the stricter of that verdict and the offer's.
  const byId = new Map(lines.map((l) => [l.id, l]));
  offer.lines = offer.lines.map((ol): OfferLine => {
    const dl = byId.get(ol.lineId);
    if (!dl) return ol;
    const worse = !ol.allergen || RANK[dl.allergen.verdict] > RANK[ol.allergen.verdict] ? dl.allergen : ol.allergen;
    return { ...ol, allergen: worse };
  });

  const changes: Change[] = offer.lines.flatMap((ol) => {
    const dl = byId.get(ol.lineId)!;
    return ol.unitPrice !== dl.unitPrice ? [{
      lineId: ol.lineId, productId: ol.productId, field: 'price' as const, from: dl.unitPrice, to: ol.unitPrice,
      message: `${dl.productName}: price per pack ${dl.unitPrice ?? 'none'} → ${ol.unitPrice ?? 'none'} EUR excl. VAT since the draft was planned`,
    }] : [];
  });
  saveOffer(offer);
  appendAudit({
    conversationId: draft.conversationId, actor: actorFor(ctx), action: 'checkoutDraft',
    summary: `${ctx.agent.displayName} checked out the draft as offer ${offer.offerId}: €${offer.totals.total.toFixed(2)} excl. VAT`,
    data: { offerId: offer.offerId, changes },
  });
  appendAudit({
    conversationId: offer.offerId, actor: actorFor(ctx), action: 'requestOffer',
    summary: `Offer from draft ${draft.id}: ${offer.lines.length} line(s) for ${offer.deliveryDate}, €${offer.totals.total.toFixed(2)} excl. VAT`,
  });

  if (changes.length) {
    // Re-price the draft so the next checkout matches; the agent decides whether to go ahead.
    const { prices, avail } = await fetchValio(lines.map((l) => l.productId), draft.intake.deliveryDate);
    const date = draft.intake.deliveryDate;
    const repriced = draft.lines.map((l) => {
      const p = getProduct(l.productId);
      return p ? repriceLine(l, p, prices.get(l.productId), avail.get(l.productId), date) : l;
    });
    saveDraft({ ...draft, lines: repriced, totals: computeTotals(repriced, draft.intake.budget), updatedAt: clockNow().toISOString() });
    return {
      status: 'requote', offerId: offer.offerId, newOffer: offer, changes, draftId: draft.id,
      message: 'Valio prices changed since the draft was planned. The draft now has the new prices; nothing was ordered. Review and call checkoutDraft again.',
    };
  }
  return { ...(await placeOrder({ offerId: offer.offerId, preferences: input.preferences }, ctx)), draftId: draft.id };
}

// ── Orders and leftovers ──

export function listAgentOrders(ctx: GatewayContext, limit = 20) {
  const orders = listOrderSummaries(ctx.agent.customerId).slice(0, limit);
  const pending = listApprovalRows({ customerId: ctx.agent.customerId, status: 'pending' }).slice(0, limit).map((a) => ({
    approvalId: a.approvalId, offerId: a.offerId, status: 'pending_approval' as const, approver: a.approver, reasons: a.reasons.map((r) => r.message), requestedAt: a.createdAt,
  }));
  return { orders, pendingApprovals: pending };
}

function ownReceipt(orderId: string, ctx: GatewayContext) {
  const receipt = getReceipt(orderId, getDb());
  if (!receipt || receipt.customerId !== ctx.agent.customerId) throw new GatewayError(`No order ${orderId}`, 'not_found');
  return receipt;
}

export function getOrder(orderId: string, ctx: GatewayContext) {
  const receipt = ownReceipt(orderId, ctx);
  const leftovers = listLeftoverRecords(ctx.agent.customerId).filter((r) => r.orderId === orderId)
    .map((r) => ({ lineId: r.lineId, productId: r.productId, orderedQty: r.orderedQty, leftoverQty: r.leftoverQty, unit: r.unit }));
  return { receipt, leftovers, checkInDone: leftovers.length > 0 };
}

/**
 * reportLeftovers: the widget's check-in for an agent (+ left over, − ran short; unmentioned lines = used up).
 * Only after the delivery date. Feeds the history notes of future planEvent calls.
 */
export function reportLeftovers(input: { orderId: string; entries: Array<{ lineId: string; leftoverQty: number }>; note?: string }, ctx: GatewayContext) {
  const receipt = ownReceipt(input.orderId, ctx);
  const today = clockNow().toISOString().slice(0, 10);
  if (receipt.deliveryDate > today) throw new GatewayError(`Order ${input.orderId} is delivered on ${receipt.deliveryDate}; report leftovers after the event`);
  try {
    submitCheckIn(input.orderId, input.entries);
  } catch (e) {
    if (e instanceof NotFoundError) throw new GatewayError(e.message);
    throw e;
  }
  appendAudit({
    conversationId: `mcp:${ctx.agent.customerId}:leftovers`, orderId: input.orderId, actor: actorFor(ctx), action: 'reportLeftovers',
    summary: `${ctx.agent.displayName} reported leftovers for ${input.orderId}${input.note ? `: ${input.note}` : ''}`, data: { entries: input.entries },
  });
  return getOrder(input.orderId, ctx);
}

