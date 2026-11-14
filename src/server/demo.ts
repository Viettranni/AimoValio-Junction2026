import type { CheckInEvent, Receipt } from '@/contracts';
import { getDb, type Db } from '@/db/client';
import {
  appendAudit, getClockOffsetDays, getDraftByConversation, getOrderLines, getReceipt, listOrders, now as clockNow, setClockOffsetDays,
} from '@/db/repo';
import { resetAndSeed, DEMO_CUSTOMER } from '@/db/seed';
import { deliveryOrder, shortDeliveries, syncDelivery } from '@/gateway/deliveries';
import { nextStepAt, type DeliveryStatus } from '@/gateway/delivery';
import { NotFoundError } from './errors';

const DAY_MS = 86_400_000;

function latestReceipt(conversationId: string, db: Db): Receipt {
  const customerId = getDraftByConversation(conversationId, db)?.customerId ?? DEMO_CUSTOMER.id;
  const latest = listOrders(customerId, db).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  const receipt = latest ? getReceipt(latest.orderId, db) : null;
  if (!latest || !receipt) throw new NotFoundError('No submitted order to fast-forward to');
  return receipt;
}

/**
 * Moves the demo clock to the day after the latest order's delivery and returns its check-in prompt.
 * Lines Valio delivered short (simulated delivery) come prefilled as shortfalls, so history learns from them.
 */
export function fastForward(conversationId: string, db: Db = getDb()): CheckInEvent {
  const receipt = latestReceipt(conversationId, db);
  const target = Date.parse(receipt.deliveryDate) + DAY_MS;
  const offset = Math.max(0, Math.ceil((target - Date.now()) / DAY_MS));
  setClockOffsetDays(offset, db);
  appendAudit({
    conversationId, orderId: receipt.orderId, actor: 'system', action: 'fastForward',
    summary: `Demo clock moved ${offset} days forward to the day after delivery of ${receipt.orderId}`,
  }, db);
  syncDelivery(receipt, db);
  const shorts = new Map(shortDeliveries(receipt.orderId, db).map((s) => [s.lineId, s]));
  const byId = new Map(getOrderLines(receipt.orderId, db).map((l) => [l.id, l]));
  return {
    orderId: receipt.orderId, eventName: receipt.eventName,
    lines: receipt.lines.map((l) => {
      const short = shorts.get(l.lineId);
      return {
        lineId: l.lineId, productName: l.productName, quantity: byId.get(l.lineId)?.quantity ?? l.quantity, unit: l.unit,
        ...(shorts.size ? { leftoverQty: short ? -short.missingQty : 0 } : {}),
        ...(short ? { deliveredShort: { qty: short.missingQty, reason: short.reason } } : {}),
      };
    }),
  };
}

/** Moves the demo clock to the next delivery state of the latest order (never backwards). */
export function nextDeliveryStep(conversationId: string, db: Db = getDb()): { orderId: string; delivery: DeliveryStatus } {
  const receipt = latestReceipt(conversationId, db);
  const next = nextStepAt(deliveryOrder(receipt), clockNow(db));
  if (next) {
    const offset = Math.max(getClockOffsetDays(db), (Date.parse(next) + 1000 - Date.now()) / DAY_MS);
    setClockOffsetDays(offset, db);
  }
  const delivery = syncDelivery(receipt, db);
  appendAudit({
    conversationId, orderId: receipt.orderId, actor: 'system', action: 'nextDeliveryStep',
    summary: `Demo clock moved to the next delivery step of ${receipt.orderId}: ${delivery.state.replace(/_/g, ' ')}`,
  }, db);
  return { orderId: receipt.orderId, delivery };
}

export function resetDemo(db: Db = getDb()): void {
  resetAndSeed(db);
  setClockOffsetDays(0, db);
}
