import type { Draft, DraftLine, Receipt } from '@/contracts';
import { getProduct } from '@/catalog';
import { getDb, type Db } from '@/db/client';
import { appendAudit, getDraftByConversation, getReceipt, insertOrder, listAudit, nextOrderId, now, saveDraft } from '@/db/repo';
import { effectiveCutoff } from '@/domain/cutoff';
import { getAvailability } from '@/valio/client';

export type Problem = { lineId: string; reason: string };
export type ApproveResult = { receipt?: Receipt; problems?: Problem[] };

export class NotFoundError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const minutesSaved = (lineCount: number) => Math.min(60, 5 + 3 * lineCount);

/** Rejection reasons for one line against fresh availability; empty when it can be ordered. */
function lineProblems(
  line: DraftLine, avail: Awaited<ReturnType<typeof getAvailability>>, nowMs: number, deliveryDate: string,
): string[] {
  const reasons: string[] = [];
  const a = avail.get(line.productId);
  if (!a || !a.deliverable) reasons.push('no longer deliverable on the delivery date');
  else {
    const cutoff = effectiveCutoff(a, deliveryDate);
    if (cutoff && Date.parse(cutoff) < nowMs) reasons.push('order cut-off has passed');
    if (a.availableAmount !== null) {
      const product = getProduct(line.productId);
      // KG-sold products report availability in kg, other products in packs.
      if (product?.salesUnit === 'KG') {
        if (a.availableAmount < line.quantity) reasons.push(`only ${a.availableAmount} kg available`);
      } else if (a.availableAmount < line.packs) reasons.push(`only ${a.availableAmount} packs available`);
    }
  }
  if (line.unitPrice === null || line.unitPriceWithTax === null) reasons.push('price unavailable');
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

/** The only path that submits an order: re-checks Valio, never silently drops a failing line. */
export async function approveAndSubmit(conversationId: string, db: Db = getDb()): Promise<ApproveResult> {
  const draft = getDraftByConversation(conversationId, db);
  if (!draft) throw new NotFoundError('No draft for this conversation');
  if (draft.status === 'submitted') return existingReceipt(conversationId, db);
  if (!draft.lines.length) return { problems: [{ lineId: '', reason: 'The draft has no lines' }] };
  if (!draft.intake.deliveryDate) return { problems: [{ lineId: '', reason: 'The delivery date is missing' }] };

  const nowDate = now(db);
  const avail = await getAvailability(draft.lines.map((l) => l.productId), draft.intake.deliveryDate);
  const problems = draft.lines.flatMap((l) =>
    lineProblems(l, avail, nowDate.getTime(), draft.intake.deliveryDate as string).map((reason) => ({ lineId: l.id, reason })));
  if (problems.length) {
    appendAudit({
      conversationId, actor: 'order', action: 'approveRejected',
      summary: `Approval blocked: ${problems.length} line(s) can no longer be ordered`, data: { problems },
    }, db);
    return { problems };
  }

  // The await above lets a double-click race in: re-read, then write synchronously.
  const fresh = getDraftByConversation(conversationId, db);
  if (fresh?.status === 'submitted') return existingReceipt(conversationId, db);

  const receipt = buildReceipt(draft, nextOrderId(db), nowDate.toISOString());
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    insertOrder(receipt, draft, t);
    saveDraft({ ...draft, status: 'submitted', updatedAt: receipt.submittedAt }, t);
    appendAudit({
      conversationId, orderId: receipt.orderId, actor: 'buyer', action: 'approve',
      summary: `Buyer approved the order ${receipt.orderId}`,
    }, t);
    appendAudit({
      conversationId, orderId: receipt.orderId, actor: 'order', action: 'submitOrder',
      summary: `Submitted simulated order ${receipt.orderId}: ${receipt.lines.length} lines, ${receipt.total.toFixed(2)} EUR excl. VAT`,
      data: { total: receipt.total, minutesSaved: receipt.minutesSaved },
    }, t);
  });
  return { receipt };
}
