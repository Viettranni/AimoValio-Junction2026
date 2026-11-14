import { randomInt, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type {
  AuditEntry, Draft, EventType, LeftoverRecord, MeasureUnit, OrderSummary, PortionCategory, Receipt,
} from '@/contracts';
import { getDb, type Db } from './client';
import { auditLog, customers, drafts, leftovers, orderLines, orders, settings } from './schema';

const DAY_MS = 86_400_000;

// ── Drafts ──

export function saveDraft(d: Draft, db: Db = getDb()): void {
  const row = { id: d.id, conversationId: d.conversationId, json: JSON.stringify(d), updatedAt: d.updatedAt };
  db.insert(drafts).values(row).onConflictDoUpdate({ target: drafts.id, set: row }).run();
}

export function getDraftByConversation(conversationId: string, db: Db = getDb()): Draft | null {
  const row = db.select().from(drafts).where(eq(drafts.conversationId, conversationId))
    .orderBy(desc(drafts.updatedAt)).limit(1).get();
  return row ? (JSON.parse(row.json) as Draft) : null;
}

export function getDraftById(id: string, db: Db = getDb()): Draft | null {
  const row = db.select().from(drafts).where(eq(drafts.id, id)).get();
  return row ? (JSON.parse(row.json) as Draft) : null;
}

// ── Orders ──

/** Stores an order from a receipt plus a map of line id → portion category. */
export function storeOrder(receipt: Receipt, categoryByLineId: Map<string, PortionCategory>, db: Db = getDb()): void {
  const lineRows = receipt.lines.map((l) => {
    const category = categoryByLineId.get(l.lineId);
    if (!category) throw new Error(`No category for line ${l.lineId} of order ${receipt.orderId}`);
    return {
      id: l.lineId, orderId: receipt.orderId, productId: l.productId, productName: l.productName,
      category, packs: l.packs, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice,
    };
  });
  db.transaction((tx) => {
    tx.insert(orders).values({
      id: receipt.orderId, customerId: receipt.customerId, eventName: receipt.eventName,
      eventType: receipt.eventType, eventDate: receipt.deliveryDate, deliveryDate: receipt.deliveryDate,
      guests: receipt.guests, total: receipt.total, totalWithTax: receipt.totalWithTax,
      receiptJson: JSON.stringify(receipt), submittedAt: receipt.submittedAt, checkInDone: false,
    }).run();
    if (lineRows.length) tx.insert(orderLines).values(lineRows).run();
  });
}

export function insertOrder(receipt: Receipt, draft: Draft, db: Db = getDb()): void {
  storeOrder(receipt, new Map(draft.lines.map((l) => [l.id, l.group])), db);
}

export function listOrders(customerId: string, db: Db = getDb()): OrderSummary[] {
  const rows = db.select().from(orders).where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.eventDate)).all();
  const records = listLeftoverRecords(customerId, db);
  return rows.map((o) => {
    const mine = records.filter((r) => r.orderId === o.id);
    const ordered = mine.reduce((s, r) => s + r.orderedQty, 0);
    const left = mine.reduce((s, r) => s + r.leftoverQty, 0);
    return {
      orderId: o.id, eventName: o.eventName, eventDate: o.eventDate, guests: o.guests, total: o.total,
      submittedAt: o.submittedAt, checkInDone: o.checkInDone,
      leftoverRatio: o.checkInDone && ordered > 0 ? left / ordered : null,
    };
  });
}

export function getReceipt(orderId: string, db: Db = getDb()): Receipt | null {
  const row = db.select({ json: orders.receiptJson }).from(orders).where(eq(orders.id, orderId)).get();
  return row ? (JSON.parse(row.json) as Receipt) : null;
}

export function getOrderLines(orderId: string, db: Db = getDb()) {
  return db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(sql`rowid`).all();
}

// ── Leftovers ──

export function listLeftoverRecords(customerId: string, db: Db = getDb()): LeftoverRecord[] {
  return db.select({ l: leftovers }).from(leftovers)
    .innerJoin(orders, eq(orders.id, leftovers.orderId))
    .where(eq(orders.customerId, customerId))
    .orderBy(asc(leftovers.eventDate), asc(leftovers.lineId)).all()
    .map(({ l }) => ({
      orderId: l.orderId, lineId: l.lineId, productId: l.productId, category: l.category as PortionCategory,
      eventType: l.eventType as EventType, eventName: l.eventName, eventDate: l.eventDate,
      orderedQty: l.orderedQty, leftoverQty: l.leftoverQty, unit: l.unit as MeasureUnit,
    }));
}

/** Records exactly the given entries; callers pass 0 for lines the buyer said were used up. */
export function recordLeftovers(
  orderId: string,
  entries: Array<{ lineId: string; leftoverQty: number }>,
  db: Db = getDb(),
  recordedAt: string = now(db).toISOString(),
): void {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) throw new Error(`Unknown order ${orderId}`);
  const lines = new Map(getOrderLines(orderId, db).map((l) => [l.id, l]));
  const rows = entries.map((e) => {
    const l = lines.get(e.lineId);
    if (!l) throw new Error(`Order ${orderId} has no line ${e.lineId}`);
    return {
      orderId, lineId: l.id, productId: l.productId, category: l.category, eventType: order.eventType,
      eventName: order.eventName, eventDate: order.eventDate, orderedQty: l.quantity,
      leftoverQty: e.leftoverQty, unit: l.unit, recordedAt,
    };
  });
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(leftovers).values(row).onConflictDoUpdate({ target: [leftovers.orderId, leftovers.lineId], set: row }).run();
    }
    tx.update(orders).set({ checkInDone: true }).where(eq(orders.id, orderId)).run();
  });
}

// ── Audit ──

export function appendAudit(
  e: Omit<AuditEntry, 'id' | 'at'> & { at?: string },
  db: Db = getDb(),
): AuditEntry {
  const entry: AuditEntry = { ...e, id: randomUUID(), at: e.at ?? now(db).toISOString() };
  db.insert(auditLog).values({
    id: entry.id, conversationId: entry.conversationId, orderId: entry.orderId ?? null, at: entry.at,
    actor: entry.actor, action: entry.action, summary: entry.summary,
    dataJson: entry.data === undefined ? null : JSON.stringify(entry.data),
  }).run();
  return entry;
}

export function listAudit(filter: { conversationId?: string; orderId?: string }, db: Db = getDb()): AuditEntry[] {
  const conds: SQL[] = [];
  if (filter.conversationId) conds.push(eq(auditLog.conversationId, filter.conversationId));
  if (filter.orderId) conds.push(eq(auditLog.orderId, filter.orderId));
  return db.select().from(auditLog).where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(auditLog.at), sql`rowid`).all()
    .map((r) => ({
      id: r.id, conversationId: r.conversationId, ...(r.orderId ? { orderId: r.orderId } : {}),
      at: r.at, actor: r.actor as AuditEntry['actor'], action: r.action, summary: r.summary,
      ...(r.dataJson ? { data: JSON.parse(r.dataJson) as unknown } : {}),
    }));
}

// ── Demo clock ──

const CLOCK_KEY = 'clockOffsetDays';

export function getClockOffsetDays(db: Db = getDb()): number {
  const row = db.select().from(settings).where(eq(settings.key, CLOCK_KEY)).get();
  return row ? Number(row.value) : 0;
}

export function setClockOffsetDays(n: number, db: Db = getDb()): void {
  db.insert(settings).values({ key: CLOCK_KEY, value: String(n) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(n) } }).run();
}

/** Real time plus the demo offset. */
export function now(db: Db = getDb()): Date {
  return new Date(Date.now() + getClockOffsetDays(db) * DAY_MS);
}

// Ids handed out but not yet stored (a draft is approved after the id is issued).
const issuedOrderIds = new Set<string>();

export function nextOrderId(db: Db = getDb()): string {
  const year = now(db).getFullYear();
  for (;;) {
    const id = `VA-${year}-${String(randomInt(0, 100_000)).padStart(5, '0')}`;
    if (issuedOrderIds.has(id) || db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).get()) continue;
    issuedOrderIds.add(id);
    return id;
  }
}

export function upsertCustomer(c: { id: string; name: string }, db: Db = getDb()): void {
  db.insert(customers).values(c).onConflictDoUpdate({ target: customers.id, set: { name: c.name } }).run();
}
