// Offers: an agent's inquiry turned into a binding quote at fixed Valio catalogue prices.
// There is no negotiation input: prices come only from Valio, quantities only round up to whole packs.
import type { AvailabilityInfo, CatalogProduct, ISODate, PriceInfo } from '@/contracts';
import { checkAllergens, getAlternatives, getProduct } from '@/catalog';
import { getDb } from '@/db/client';
import { appendAudit, now as clockNow } from '@/db/repo';
import { packsFor } from '@/domain/quantities';
import { availabilityFor, fetchValio, pricingFor } from './lookup';
import { policyFor } from './policies';
import { mergeRequirements } from './policy';
import { sameKind } from '@/mastra/pipeline/same-kind';
import { getOffer, newId, saveOffer } from './store';
import type { Alternative, GatewayContext, Offer, OfferLine, OfferRequest, OfferRequestLine } from './types';

export class GatewayError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'invalid' | 'conflict' = 'invalid') {
    super(message);
    this.name = 'GatewayError';
  }
}

export const PRICING_NOTE = 'Fixed Valio catalogue prices, excl. VAT unless stated. No negotiation: change the products or quantities to change the total.';
const MAX_LINES = 100;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Fresh { prices: Map<string, PriceInfo>; avail: Map<string, AvailabilityInfo> }

export const actorFor = (ctx: GatewayContext) => `agent:${ctx.agent.agentId}` as const;

function packsForRequest(line: OfferRequestLine, p: CatalogProduct): { packs: number } | { error: string } {
  const unit = line.unit ?? 'packs';
  if (unit === 'packs') {
    const lot = Math.max(1, p.allowedLotSize);
    return { packs: Math.ceil(line.quantity / lot - 1e-9) * lot };
  }
  if (unit !== p.packUnit || !(p.packSize > 0)) {
    return { error: `sold in ${p.packDescription}: give the quantity in packs${p.packSize > 0 ? ` or ${p.packUnit}` : ''}` };
  }
  return { packs: packsFor(line.quantity, p).packs };
}

function unavailableLine(base: Pick<OfferLine, 'lineId' | 'productId' | 'requested' | 'substituteFor'>, reason: string, p?: CatalogProduct): OfferLine {
  return {
    ...base, productName: p ? p.nameEn || p.nameFi : base.productId, packDescription: p?.packDescription ?? '', packs: 0, quantity: 0,
    unit: p?.packUnit ?? 'pcs', unitPrice: null, unitPriceWithTax: null, priceBasis: 'per_pack', valioPrice: null, lineTotal: 0,
    lineTotalWithTax: 0, status: 'unavailable', available: false, reason, availablePacks: null, availableDate: null, cutoff: null,
  };
}

/** A substitute must serve the same function as the product it replaces (same category or same kind of name). */
export function sameKindAs(original: CatalogProduct, candidate: CatalogProduct): boolean {
  return sameKind({
    id: 'x', label: original.nameEn, searchTerms: { fi: original.nameFi, en: original.nameEn }, category: 'dairy', origin: 'requested',
    guests: 0, requiredAmount: 0, requiredUnit: original.packUnit,
  }, original, candidate);
}

/** Prices and checks every requested line against fresh Valio data. Pure apart from the catalogue lookup. */
export function buildLines(
  request: OfferRequest, fresh: Fresh, nowMs: number, realNowMs = Date.now(), opts: { substitutesSameKindOnly?: boolean } = {},
): OfferLine[] {
  const checks = request.requirements
    ? new Map(checkAllergens(request.lines.map((l) => l.productId), request.requirements).map((c) => [c.productId, c]))
    : null;
  return request.lines.map((req, i): OfferLine => {
    const base = {
      lineId: req.ref ?? `L${i + 1}`, productId: req.productId, requested: { quantity: req.quantity, unit: req.unit ?? 'packs' },
      ...(req.substituteFor ? { substituteFor: req.substituteFor } : {}),
    } as const;
    const p = getProduct(req.productId);
    if (!p) return unavailableLine(base, 'unknown product id');
    if (req.substituteFor && opts.substitutesSameKindOnly) {
      const original = getProduct(req.substituteFor);
      if (!original || !sameKindAs(original, p)) {
        return unavailableLine(base, `the customer only accepts substitutes of the same kind as ${original?.nameEn ?? req.substituteFor}`, p);
      }
    }
    const sized = packsForRequest(req, p);
    if ('error' in sized) return unavailableLine(base, sized.error, p);
    const { packs } = sized;
    const pricing = pricingFor(p, fresh.prices.get(p.id), realNowMs);
    const a = availabilityFor(p, fresh.avail.get(p.id), request.deliveryDate, nowMs);
    const unitPrice = pricing?.pricePerPack ?? null;
    const unitPriceWithTax = pricing?.pricePerPackWithTax ?? null;

    let status: OfferLine['status'] = 'available';
    let reason: string | undefined;
    if (!pricing || unitPrice === null || unitPriceWithTax === null) { status = 'unavailable'; reason = 'no price from Valio'; }
    else if (pricing.stale) { status = 'unavailable'; reason = 'price could not be refreshed from Valio'; }
    else if (!a.deliverableOnDate) { status = 'unavailable'; reason = a.reason ?? 'not deliverable on the date'; }
    else if (a.availablePacks !== null && a.availablePacks < packs) {
      status = 'partial';
      reason = `only ${a.availablePacks} of ${packs} packs available for ${request.deliveryDate}`;
    }
    const allergen = checks?.get(p.id);
    return {
      ...base,
      productName: p.nameEn || p.nameFi,
      packDescription: p.packDescription,
      packs,
      quantity: round6(packs * p.packSize),
      unit: p.packUnit,
      unitPrice,
      unitPriceWithTax,
      priceBasis: pricing?.basis ?? 'per_pack',
      valioPrice: pricing ? (pricing.basis === 'per_kg' ? pricing.pricePerKg : pricing.pricePerPack) : null,
      lineTotal: unitPrice === null ? 0 : round2(packs * unitPrice),
      lineTotalWithTax: unitPriceWithTax === null ? 0 : round2(packs * unitPriceWithTax),
      status,
      available: status === 'available',
      ...(reason ? { reason } : {}),
      availablePacks: a.availablePacks,
      availableDate: a.availableDate,
      cutoff: a.cutoff,
      ...(allergen ? { allergen } : {}),
    };
  });
}

/** Same-kind products that could cover a line in full on the date. Suggestions only; never swapped in. */
async function addAlternatives(lines: OfferLine[], request: OfferRequest, nowMs: number): Promise<void> {
  const short = lines.filter((l) => !l.available && getProduct(l.productId));
  if (!short.length) return;
  const candidates = new Map<string, CatalogProduct[]>();
  for (const l of short) {
    const source = getProduct(l.productId)!;
    let alts = getAlternatives(source.id, 8).map((h) => h.product).filter((p) => p.packUnit === source.packUnit && p.packSize > 0);
    if (request.requirements) {
      const ok = new Set(checkAllergens(alts.map((p) => p.id), request.requirements).filter((c) => c.verdict === 'pass').map((c) => c.productId));
      alts = alts.filter((p) => ok.has(p.id));
    }
    candidates.set(l.lineId, alts);
  }
  const ids = [...new Set([...candidates.values()].flat().map((p) => p.id))];
  if (!ids.length) return;
  const fresh = await fetchValio(ids, request.deliveryDate);
  for (const l of short) {
    const source = getProduct(l.productId)!;
    const amount = l.quantity > 0 ? l.quantity : (l.requested.unit === 'packs' ? l.requested.quantity * source.packSize : l.requested.quantity);
    const out: Alternative[] = [];
    for (const p of candidates.get(l.lineId) ?? []) {
      const pricing = pricingFor(p, fresh.prices.get(p.id));
      const a = availabilityFor(p, fresh.avail.get(p.id), request.deliveryDate, nowMs);
      const needed = packsFor(amount, p).packs;
      if (!pricing || pricing.stale || pricing.pricePerPack === null || pricing.pricePerPackWithTax === null) continue;
      if (!a.deliverableOnDate || (a.availablePacks !== null && a.availablePacks < needed)) continue;
      out.push({
        productId: p.id, name: p.nameEn || p.nameFi, packDescription: p.packDescription,
        unitPrice: pricing.pricePerPack, unitPriceWithTax: pricing.pricePerPackWithTax,
        comparisonPrice: pricing.comparisonPrice, comparisonUnit: pricing.comparisonUnit, availablePacks: a.availablePacks,
        reason: `${p.category === source.category ? 'same category' : 'similar name'}; ${needed} packs deliverable ${request.deliveryDate}`,
      });
    }
    out.sort((x, y) => (x.comparisonPrice ?? x.unitPrice) - (y.comparisonPrice ?? y.unitPrice));
    if (out.length) l.alternatives = out.slice(0, 3);
  }
}

function validate(request: OfferRequest, today: ISODate): void {
  if (!DATE_RE.test(request.deliveryDate) || Number.isNaN(Date.parse(request.deliveryDate))) throw new GatewayError('deliveryDate must be YYYY-MM-DD');
  if (request.deliveryDate <= today) throw new GatewayError(`deliveryDate must be after today (${today})`);
  if (!request.lines.length || request.lines.length > MAX_LINES) throw new GatewayError(`An offer needs 1 to ${MAX_LINES} lines`);
  for (const l of request.lines) {
    if (!(l.quantity > 0) || !Number.isFinite(l.quantity)) throw new GatewayError(`quantity for ${l.productId} must be a positive number`);
  }
}

/** Builds (and does not save) an offer from fresh Valio data. */
export async function quote(request: OfferRequest, ctx: GatewayContext, opts: { draftId?: string } = {}): Promise<Offer> {
  const db = ctx.db ?? getDb();
  const nowDate = clockNow(db);
  validate(request, nowDate.toISOString().slice(0, 10));
  const policy = policyFor(ctx.agent.customerId);
  const requirements = mergeRequirements(policy.defaults.requirements, request.requirements);
  const effective: OfferRequest = { ...request, ...(requirements ? { requirements } : {}) };
  const ids = [...new Set(request.lines.map((l) => l.productId).filter((id) => getProduct(id)))];
  const fresh = ids.length ? await fetchValio(ids, request.deliveryDate) : { prices: new Map(), avail: new Map() };
  const lines = buildLines(effective, fresh, nowDate.getTime(), Date.now(), { substitutesSameKindOnly: policy.defaults.substitutesSameKindOnly });
  await addAlternatives(lines, effective, nowDate.getTime());
  const orderable = lines.filter((l) => l.available);
  const total = round2(orderable.reduce((s, l) => s + l.lineTotal, 0));
  const totalWithTax = round2(orderable.reduce((s, l) => s + l.lineTotalWithTax, 0));
  const cutoffs = orderable.map((l) => l.cutoff).filter((c): c is string => !!c).sort((a, b) => Date.parse(a) - Date.parse(b));
  const cutoff = cutoffs[0] ?? null;
  const holdUntil = nowDate.getTime() + policy.offerValidityMinutes * 60_000;
  const validUntil = new Date(cutoff ? Math.min(holdUntil, Date.parse(cutoff)) : holdUntil).toISOString();
  return {
    offerId: newId('OF'),
    customerId: ctx.agent.customerId,
    agentId: ctx.agent.agentId,
    deliveryDate: request.deliveryDate,
    ...(requirements ? { requirements } : {}),
    ...(opts.draftId ? { draftId: opts.draftId } : {}),
    lines,
    totals: { currency: 'EUR', total, totalWithTax, vat: round2(totalWithTax - total), orderableLines: orderable.length, excludedLines: lines.length - orderable.length },
    cutoff,
    createdAt: nowDate.toISOString(),
    validUntil,
    status: 'open',
    pricing: PRICING_NOTE,
    request,
  };
}

/** requestOffer: quote at fixed catalogue prices, save, audit. The customer comes from the agent's key. */
export async function requestOffer(request: OfferRequest, ctx: GatewayContext): Promise<Offer> {
  const offer = await quote(request, ctx);
  saveOffer(offer, ctx.db);
  appendAudit({
    conversationId: offer.offerId, actor: actorFor(ctx), action: 'requestOffer',
    summary: `${ctx.agent.displayName} requested an offer: ${offer.lines.length} line(s) for ${offer.deliveryDate}, €${offer.totals.total.toFixed(2)} excl. VAT, ${offer.totals.excludedLines} not deliverable in full`,
    data: { customerId: offer.customerId, total: offer.totals.total, validUntil: offer.validUntil },
  }, ctx.db);
  return offer;
}

/** An offer of the caller's own customer, or not found (another customer's offer is never revealed). */
export function getOwnOffer(offerId: string, ctx: GatewayContext): Offer {
  const offer = getOffer(offerId, ctx.db);
  if (!offer || offer.customerId !== ctx.agent.customerId) throw new GatewayError(`No offer ${offerId}`, 'not_found');
  return offer;
}
