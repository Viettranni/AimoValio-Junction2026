import type { AvailabilityInfo, Draft, DraftLine, PriceInfo, Receipt } from '@/contracts';
import { getProduct } from '@/catalog';
import { getDb, type Db } from '@/db/client';
import { appendAudit, getDraftByConversation, getReceipt, insertOrder, listAudit, nextOrderId, now, saveDraft } from '@/db/repo';
import { deliverableOn, effectiveCutoff } from '@/domain/cutoff';
import { getAvailability, getPrices } from '@/valio/client';

export type Problem = { lineId: string; reason: string };
export type ApproveResult = { receipt?: Receipt; problems?: Problem[] };

export class NotFoundError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Older than the price cache TTL: getPrices only returns such a price when the refresh failed. */
const STALE_PRICE_MS = 10 * 60 * 1000;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' });

interface Fresh { avail: Map<string, AvailabilityInfo>; prices: Map<string, PriceInfo>; nowMs: number; realNowMs: number }

export const minutesSaved = (lineCount: number) => Math.min(60, 5 + 3 * lineCount);

/** Rejection reasons for one line against fresh Valio data; empty when it can be ordered. */
function lineProblems(line: DraftLine, fresh: Fresh, deliveryDate: string, confirmedUnknown: ReadonlySet<string>): string[] {
  const reasons: string[] = [];
  const a = fresh.avail.get(line.productId);
  if (line.tags.includes('unavailable')) reasons.push('not deliverable on the delivery date');
  else if (!a || !a.deliverable || a.salesBlock) reasons.push('no longer deliverable on the delivery date');
  else if (!deliverableOn(a, deliveryDate)) reasons.push(`earliest delivery ${a.availableDate}`);
  if (a && deliverableOn(a, deliveryDate)) {
    const cutoff = effectiveCutoff(a, deliveryDate);
    if (cutoff && Date.parse(cutoff) < fresh.nowMs) reasons.push('order cut-off has passed');
    if (a.availableAmount !== null) {
      const product = getProduct(line.productId);
      // KG-sold products report availability in kg, other products in packs.
      if (product?.salesUnit === 'KG') {
        if (a.availableAmount < line.quantity) reasons.push(`only ${a.availableAmount} kg available`);
      } else if (a.availableAmount < line.packs) reasons.push(`only ${a.availableAmount} packs available`);
    }
  }
  const price = fresh.prices.get(line.productId);
  if (line.unitPrice === null || line.unitPriceWithTax === null || (price && !price.ok)) reasons.push('price unavailable');
  else if (price && fresh.realNowMs - Date.parse(price.fetchedAt) > STALE_PRICE_MS) {
    reasons.push(`price from ${clock(price.fetchedAt)} could not be refreshed`);
  }
  if (line.allergen.verdict === 'fail') reasons.push('conflicts with a diet or allergy');
  else if (line.allergen.verdict === 'unknown' && !confirmedUnknown.has(line.id)) {
    reasons.push('allergens unknown: confirm this line before approving');
  }
  return reasons;
}

function buildReceipt(draft: Draft, orderId: string, submittedAt: string): Receipt {
  const lines = draft.lines.map((l) => {
    const unitPrice = l.unitPrice as number;
    const unitPriceWithTax = l.unitPriceWithTax as number;
    return {
      lineId: l.id, productId: l.productId, productName: l.productName, packs: l.packs, quantity: l.quantity,
      unit: l.unit, unitPrice, unitPriceWithTax,
      lineTotal: round2(l.packs * unitPrice), lineTotalWithTax: round2(l.packs * unitPriceWithTax),
    };
  });
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const totalWithTax = round2(lines.reduce((s, l) => s + l.lineTotalWithTax, 0));
  let co2: number | null = null;
  for (const l of draft.lines) {
    const factor = l.unit === 'kg' ? getProduct(l.productId)?.co2PerKg : null;
    if (factor != null) co2 = (co2 ?? 0) + l.quantity * factor;
  }
  return {
    orderId, simulated: true, customerId: draft.customerId,
    eventName: draft.intake.eventName ?? 'Event', eventType: draft.intake.eventType ?? 'other',
    deliveryDate: draft.intake.deliveryDate as string, guests: draft.intake.guests ?? 0,
    lines, total, totalWithTax, vat: round2(totalWithTax - total),
    co2Kg: co2 === null ? null : round2(co2), minutesSaved: minutesSaved(lines.length), submittedAt,
  };
}

function existingReceipt(conversationId: string, db: Db): ApproveResult {
  const orderId = listAudit({ conversationId }, db).find((a) => a.action === 'submitOrder')?.orderId;
  const receipt = orderId ? getReceipt(orderId, db) : null;
  return receipt ? { receipt } : { problems: [{ lineId: '', reason: 'This order has already been submitted' }] };
}

/**
 * The only path that submits an order: re-checks Valio, never silently drops a failing line.
 * Lines with unknown allergens go through only when the buyer confirmed them on the review screen.
 */
export async function approveAndSubmit(
  conversationId: string, db: Db = getDb(), confirmedUnknownLineIds: string[] = [],
): Promise<ApproveResult> {
  const draft = getDraftByConversation(conversationId, db);
  if (!draft) throw new NotFoundError('No draft for this conversation');
  if (draft.status === 'submitted') return existingReceipt(conversationId, db);
  if (!draft.lines.length) return { problems: [{ lineId: '', reason: 'The draft has no lines' }] };
  if (!draft.intake.deliveryDate) return { problems: [{ lineId: '', reason: 'The delivery date is missing' }] };

  const nowDate = now(db);
  const ids = draft.lines.map((l) => l.productId);
  const [avail, prices] = await Promise.all([
    getAvailability(ids, draft.intake.deliveryDate), getPrices(ids, draft.intake.deliveryDate),
  ]);
  const fresh: Fresh = { avail, prices, nowMs: nowDate.getTime(), realNowMs: Date.now() };
  const confirmed = new Set(confirmedUnknownLineIds);
  const problems = draft.lines.flatMap((l) =>
    lineProblems(l, fresh, draft.intake.deliveryDate as string, confirmed).map((reason) => ({ lineId: l.id, reason })));
  if (problems.length) {
    appendAudit({
      conversationId, actor: 'order', action: 'approveRejected',
      summary: `Approval blocked: ${problems.length} line(s) can no longer be ordered`, data: { problems },
    }, db);
    return { problems };
  }

  // The await above lets a double-click or an edit race in: re-read, then write synchronously.
  const latest = getDraftByConversation(conversationId, db);
  if (!latest) throw new NotFoundError('No draft for this conversation');
  if (latest.status === 'submitted') return existingReceipt(conversationId, db);
  if (latest.updatedAt !== draft.updatedAt) {
    return { problems: [{ lineId: '', reason: 'The draft changed while it was being checked; please review it again' }] };
  }

  const confirmedUnknown = latest.lines.filter((l) => l.allergen.verdict === 'unknown').map((l) => l.id);
  const receipt = buildReceipt(latest, nextOrderId(db), nowDate.toISOString());
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    insertOrder(receipt, latest, t);
    saveDraft({ ...latest, status: 'submitted', updatedAt: receipt.submittedAt }, t);
    appendAudit({
      conversationId, orderId: receipt.orderId, actor: 'buyer', action: 'approve',
      summary: confirmedUnknown.length
        ? `Buyer approved the order ${receipt.orderId}, confirming ${confirmedUnknown.length} line(s) with unknown allergens`
        : `Buyer approved the order ${receipt.orderId}`,
      ...(confirmedUnknown.length ? { data: { confirmedUnknownLineIds: confirmedUnknown } } : {}),
    }, t);
    appendAudit({
      conversationId, orderId: receipt.orderId, actor: 'order', action: 'submitOrder',
      summary: `Submitted simulated order ${receipt.orderId}: ${receipt.lines.length} lines, ${receipt.total.toFixed(2)} EUR excl. VAT`,
      data: { total: receipt.total, minutesSaved: receipt.minutesSaved },
    }, t);
  });
  return { receipt };
}
