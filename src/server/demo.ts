import type { CheckInEvent } from '@/contracts';
import { getDb, type Db } from '@/db/client';
import {
  appendAudit, getDraftByConversation, getOrderLines, getReceipt, listOrders, setClockOffsetDays,
} from '@/db/repo';
import { resetAndSeed, DEMO_CUSTOMER } from '@/db/seed';
import { NotFoundError } from './orders';

const DAY_MS = 86_400_000;

/** Moves the demo clock to the day after the latest order's delivery and returns its check-in prompt. */
export function fastForward(conversationId: string, db: Db = getDb()): CheckInEvent {
  const customerId = getDraftByConversation(conversationId, db)?.customerId ?? DEMO_CUSTOMER.id;
  const latest = listOrders(customerId, db).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  const receipt = latest ? getReceipt(latest.orderId, db) : null;
  if (!latest || !receipt) throw new NotFoundError('No submitted order to fast-forward to');
  const target = Date.parse(receipt.deliveryDate) + DAY_MS;
  const offset = Math.max(0, Math.ceil((target - Date.now()) / DAY_MS));
  setClockOffsetDays(offset, db);
  appendAudit({
    conversationId, orderId: receipt.orderId, actor: 'system', action: 'fastForward',
    summary: `Demo clock moved ${offset} days forward to the day after delivery of ${receipt.orderId}`,
  }, db);
  const byId = new Map(getOrderLines(receipt.orderId, db).map((l) => [l.id, l]));
  return {
    orderId: receipt.orderId, eventName: receipt.eventName,
    lines: receipt.lines.map((l) => ({
      lineId: l.lineId, productName: l.productName, quantity: byId.get(l.lineId)?.quantity ?? l.quantity, unit: l.unit,
    })),
  };
}

export function resetDemo(db: Db = getDb()): void {
  resetAndSeed(db);
  setClockOffsetDays(0, db);
}
