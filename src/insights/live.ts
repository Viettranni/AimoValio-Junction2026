// Repository for live mode: reads this project's orders (src/db) and maps them to `line` rows (mapper.ts).
import { desc, inArray } from 'drizzle-orm';
import { getProduct } from '@/catalog';
import { getDb, type Db } from '@/db/client';
import { customers, leftovers, orderLines, orders } from '@/db/schema';
import { toLineRows, type ProjectOrderLine } from './mapper';
import type { LineRow } from './schema';

/** Live insights read at most the latest orders; a bigger history belongs in a real warehouse. */
const LIVE_ORDER_LIMIT = 2000;

export function projectLineRows(db: Db = getDb()): LineRow[] {
  const os = db.select({
    id: orders.id, customerId: orders.customerId, eventName: orders.eventName, eventType: orders.eventType,
    deliveryDate: orders.deliveryDate, guests: orders.guests,
  }).from(orders).orderBy(desc(orders.deliveryDate)).limit(LIVE_ORDER_LIMIT).all();
  if (!os.length) return [];
  const ids = os.map((o) => o.id);
  const lines = db.select({
    orderId: orderLines.orderId, id: orderLines.id, productId: orderLines.productId, productName: orderLines.productName,
    category: orderLines.category, packs: orderLines.packs, quantity: orderLines.quantity, unit: orderLines.unit,
    unitPrice: orderLines.unitPrice,
  }).from(orderLines).where(inArray(orderLines.orderId, ids)).all();
  const left = db.select({
    orderId: leftovers.orderId, lineId: leftovers.lineId, orderedQty: leftovers.orderedQty, leftoverQty: leftovers.leftoverQty,
  }).from(leftovers).where(inArray(leftovers.orderId, ids)).all();
  const byOrder = new Map<string, ProjectOrderLine[]>();
  for (const { orderId, ...l } of lines) {
    const list = byOrder.get(orderId);
    if (list) list.push(l);
    else byOrder.set(orderId, [l]);
  }
  return toLineRows({
    orders: os.map((o) => ({ ...o, lines: byOrder.get(o.id) ?? [] })),
    leftovers: left,
    productFacts: (id) => {
      const p = getProduct(id);
      return p ? { vendor: p.vendor, temperature: p.temperature, co2PerKg: p.co2PerKg } : null;
    },
  });
}

/** This project's own customers: the buyers whose orders live mode shows. */
export function projectCustomers(db: Db = getDb()): Array<{ id: string; name: string }> {
  return db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(customers.name).limit(100).all();
}
