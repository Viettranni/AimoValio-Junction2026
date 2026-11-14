// Delivery status served by the gateway: the deterministic timeline (./delivery.ts) on the demo clock, plus the
// one-time record of what was delivered (per-line quantities, audit) once an order reaches "delivered".
import { eq } from 'drizzle-orm';
import type { Receipt } from '@/contracts';
import { getProduct } from '@/catalog';
import { getDb, type Db } from '@/db/client';
import { appendAudit, getReceipt, listAudit, now as clockNow } from '@/db/repo';
import { deliveries } from '@/db/schema';
import { deliveryStatus, summarizeDelivery, type DeliveryOrder, type DeliveryStatus } from './delivery';
import { GatewayError } from './offers';
import { gatewayDb } from './store';
import type { GatewayContext } from './types';

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function deliveryOrder(receipt: Receipt): DeliveryOrder {
  return {
    orderId: receipt.orderId,
    submittedAt: receipt.submittedAt,
    deliveryDate: receipt.deliveryDate,
    cutoff: receipt.cutoff ?? null,
    lines: receipt.lines.map((l) => ({
      lineId: l.lineId, productId: l.productId, productName: l.productName, packs: l.packs, quantity: l.quantity, unit: l.unit,
      logisticModel: l.logisticModel ?? 'Stock', reliability: getProduct(l.productId)?.reliability ?? null,
    })),
  };
}

function storedRows(orderId: string, db: Db) {
  return gatewayDb(db).select().from(deliveries).where(eq(deliveries.orderId, orderId)).all();
}

/**
 * The delivery status of an order now (demo clock). The first time it is seen as delivered, the delivered
 * quantities are stored and audited (actor 'carrier', plus 'gateway' for each short line); afterwards the
 * stored figures are the answer.
 */
export function syncDelivery(receipt: Receipt, db: Db = getDb(), at: Date = clockNow(db)): DeliveryStatus {
  const status = deliveryStatus(deliveryOrder(receipt), at);
  if (status.state !== 'delivered') return status;
  let rows = storedRows(receipt.orderId, db);
  if (!rows.length) {
    rows = db.transaction((tx) => {
      const t = tx as unknown as Db;
      const again = storedRows(receipt.orderId, t);
      if (again.length) return again;
      const deliveredAt = status.eta.to;
      const fresh = status.lines.map((l) => ({
        orderId: receipt.orderId, lineId: l.lineId, orderedQty: l.orderedQty, deliveredQty: l.deliveredQty ?? l.orderedQty,
        unit: l.unit, reason: l.reason ?? null, deliveredAt,
      }));
      if (fresh.length) t.insert(deliveries).values(fresh).run();
      const conversationId = listAudit({ orderId: receipt.orderId }, t)[0]?.conversationId ?? receipt.orderId;
      const short = status.lines.filter((l) => l.short);
      appendAudit({
        conversationId, orderId: receipt.orderId, actor: 'carrier', action: 'delivered', at: deliveredAt,
        summary: `Delivered ${receipt.orderId} (simulated): ${status.lines.length - short.length} of ${status.lines.length} line(s) in full`,
        data: { eta: status.eta },
      }, t);
      for (const l of short) {
        appendAudit({
          conversationId, orderId: receipt.orderId, actor: 'gateway', action: 'deliveredShort', at: deliveredAt,
          summary: `${l.productName}: ${l.reason}, ${fmt(l.deliveredQty ?? 0)} of ${fmt(l.orderedQty)} ${l.unit} delivered; prefilled as a shortfall in the check-in`,
          data: { lineId: l.lineId, orderedQty: l.orderedQty, deliveredQty: l.deliveredQty },
        }, t);
      }
      return fresh;
    });
  }
  const byLine = new Map(rows.map((r) => [r.lineId, r]));
  return {
    ...status,
    lines: status.lines.map((l) => {
      const r = byLine.get(l.lineId);
      if (!r) return l;
      const short = r.deliveredQty < r.orderedQty;
      const unitQty = l.orderedPacks > 0 ? l.orderedQty / l.orderedPacks : 0;
      return {
        ...l, deliveredQty: r.deliveredQty, deliveredPacks: unitQty > 0 ? Math.round(r.deliveredQty / unitQty) : l.orderedPacks, short,
        ...(short && r.reason ? { reason: r.reason } : {}),
      };
    }),
  };
}

/** Delivered-short lines of a delivered order (for the check-in prefill); empty before delivery. */
export function shortDeliveries(orderId: string, db: Db = getDb()) {
  return gatewayDb(db).select().from(deliveries)
    .where(eq(deliveries.orderId, orderId)).all()
    .filter((r) => r.deliveredQty < r.orderedQty)
    .map((r) => ({ lineId: r.lineId, missingQty: Math.round((r.orderedQty - r.deliveredQty) * 1e6) / 1e6, reason: r.reason ?? 'delivered short' }));
}

export const deliverySummaryFor = (receipt: Receipt, db: Db = getDb()) => summarizeDelivery(syncDelivery(receipt, db));

/** getDeliveryStatus (MCP): the simulated delivery of one of the caller's own orders. */
export function getDeliveryStatus(orderId: string, ctx: GatewayContext): DeliveryStatus {
  const db = ctx.db ?? getDb();
  const receipt = getReceipt(orderId, db);
  if (!receipt || receipt.customerId !== ctx.agent.customerId) throw new GatewayError(`No order ${orderId}`, 'not_found');
  return syncDelivery(receipt, db);
}
