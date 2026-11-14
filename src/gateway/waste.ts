// Food waste (hävikki): what the kitchen threw away, logged by the customer's agent (Claude over MCP), the chat
// widget, or a script. Each entry is matched to a product (this customer's own past orders first, then the
// catalogue), valued at the price this customer last paid, and given a CO₂ estimate from the product group average.
// getWasteReport sums it up with the leftovers from event check-ins, so the kitchen sees where money goes in the bin.
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { getProduct, searchProducts } from '@/catalog';
import type { CatalogProduct, MeasureUnit } from '@/contracts';
import { appendAudit, now as clockNow } from '@/db/repo';
import { getDb, type Db } from '@/db/client';
import { leftovers, orderLines, orders, wasteLog } from '@/db/schema';
import { GatewayError } from './offers';
import { gatewayDb, newId } from './store';
import type { GatewayContext } from './types';

export const WASTE_REASONS = ['expired', 'spoiled', 'overproduction', 'plate_waste', 'damaged', 'other'] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];
export type WasteUnit = 'kg' | 'l' | 'pcs' | 'packs';

export interface WasteEntryInput {
  /** A catalogue product id, when known. */
  productId?: string;
  /** What was thrown away, in any language ("riisi", "lactose-free milk"); matched to a product. */
  name?: string;
  quantity: number;
  unit: WasteUnit;
  reason: WasteReason;
  note?: string;
}

export interface LogWasteInput {
  entries: WasteEntryInput[];
  /** YYYY-MM-DD; defaults to today. */
  date?: string;
  /** The order the food came from, when known. */
  orderId?: string;
}

export interface WasteEntry {
  id: string;
  date: string;
  productId: string | null;
  productName: string;
  /** Where the product match came from. */
  matchedBy: 'productId' | 'past_orders' | 'catalog' | 'none';
  quantity: number;
  unit: MeasureUnit | 'packs';
  reason: WasteReason;
  orderId: string | null;
  /** At the price this customer last paid, excl. VAT; null when never bought or not convertible. */
  valueEur: number | null;
  co2Kg: number | null;
  note: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The last price per kg / l / pcs this customer paid for a product (from its orders), or null. */
function lastUnitPrice(customerId: string, productId: string, db: Db): number | null {
  const row = db.select({ unitPrice: orderLines.unitPrice, packs: orderLines.packs, quantity: orderLines.quantity })
    .from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orders.customerId, customerId), eq(orderLines.productId, productId)))
    .orderBy(desc(orders.submittedAt)).get();
  if (!row || !row.quantity) return null;
  return (row.unitPrice * row.packs) / row.quantity;
}

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);

/** A product this customer has ordered whose name shares a word stem with `name` ("riisi" → "basmatiriisi"). */
function fromPastOrders(customerId: string, name: string, db: Db): CatalogProduct | null {
  const wanted = words(name);
  if (!wanted.length) return null;
  const lines = db.selectDistinct({ productId: orderLines.productId, productName: orderLines.productName })
    .from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).where(eq(orders.customerId, customerId)).all();
  for (const l of lines) {
    const p = getProduct(l.productId);
    if (!p) continue;
    const names = [p.nameFi, p.nameEn, l.productName].join(' ').toLowerCase();
    if (wanted.every((w) => names.includes(w.slice(0, Math.max(4, w.length - 2))))) return p;
  }
  return null;
}

function matchProduct(customerId: string, e: WasteEntryInput, db: Db): { product: CatalogProduct | null; matchedBy: WasteEntry['matchedBy'] } {
  if (e.productId) {
    const p = getProduct(e.productId);
    if (!p) throw new GatewayError(`Unknown product ${e.productId}`, 'invalid');
    return { product: p, matchedBy: 'productId' };
  }
  if (!e.name?.trim()) throw new GatewayError('Each entry needs a productId or a name', 'invalid');
  const past = fromPastOrders(customerId, e.name, db);
  if (past) return { product: past, matchedBy: 'past_orders' };
  const hit = searchProducts({ query: e.name, limit: 1 })[0];
  return hit ? { product: hit.product, matchedBy: 'catalog' } : { product: null, matchedBy: 'none' };
}

/** Quantity in the product's own unit (kg / l / pcs); packs are converted with the pack size. */
function inProductUnit(e: WasteEntryInput, p: CatalogProduct | null): { quantity: number; unit: MeasureUnit | 'packs' } {
  if (e.unit === 'packs') return p ? { quantity: e.quantity * p.packSize, unit: p.packUnit } : { quantity: e.quantity, unit: 'packs' };
  return { quantity: e.quantity, unit: e.unit };
}

export function logWaste(input: LogWasteInput, ctx: GatewayContext): { logged: WasteEntry[]; totals: { valueEur: number; co2Kg: number }; unmatched: string[] } {
  const db = gatewayDb(ctx.db ?? getDb());
  const customerId = ctx.agent.customerId;
  if (!input.entries.length) throw new GatewayError('Give at least one entry', 'invalid');
  const today = clockNow(db).toISOString().slice(0, 10);
  const date = input.date ?? today;
  if (!ISO.test(date)) throw new GatewayError('date must be YYYY-MM-DD', 'invalid');
  if (date > today) throw new GatewayError('Waste can only be logged for today or earlier', 'invalid');
  if (input.orderId) {
    const order = db.select({ customerId: orders.customerId }).from(orders).where(eq(orders.id, input.orderId)).get();
    if (!order || order.customerId !== customerId) throw new GatewayError(`No order ${input.orderId}`, 'not_found');
  }

  const recordedAt = clockNow(db).toISOString();
  const logged: WasteEntry[] = [];
  const unmatched: string[] = [];
  for (const e of input.entries) {
    if (!(e.quantity > 0)) throw new GatewayError('quantity must be more than 0', 'invalid');
    const { product, matchedBy } = matchProduct(customerId, e, db);
    if (!product) unmatched.push(e.name ?? e.productId ?? '');
    const { quantity, unit } = inProductUnit(e, product);
    const price = product && unit === product.packUnit ? lastUnitPrice(customerId, product.id, db) : null;
    const co2 = product?.co2PerKg != null && (unit === 'kg' || unit === 'l') ? round2(quantity * product.co2PerKg) : null;
    const entry: WasteEntry = {
      id: newId('WS'), date, productId: product?.id ?? null, productName: product?.nameFi ?? e.name ?? '', matchedBy,
      quantity: round2(quantity), unit, reason: e.reason, orderId: input.orderId ?? null,
      valueEur: price === null ? null : round2(price * quantity), co2Kg: co2, note: e.note?.slice(0, 300) ?? null,
    };
    db.insert(wasteLog).values({
      id: entry.id, customerId, date, productId: entry.productId, productName: entry.productName, quantity: entry.quantity,
      unit: entry.unit, reason: entry.reason, orderId: entry.orderId, valueEur: entry.valueEur, co2Kg: entry.co2Kg,
      note: entry.note, source: ctx.agent.agentId, recordedAt,
    }).run();
    logged.push(entry);
  }
  const totals = {
    valueEur: round2(logged.reduce((s, x) => s + (x.valueEur ?? 0), 0)),
    co2Kg: round2(logged.reduce((s, x) => s + (x.co2Kg ?? 0), 0)),
  };
  appendAudit({
    conversationId: `waste:${customerId}`, orderId: input.orderId, actor: `agent:${ctx.agent.agentId}`, action: 'logWaste',
    summary: `${ctx.agent.displayName} logged ${logged.length} waste ${logged.length === 1 ? 'entry' : 'entries'} for ${date} (≈ €${totals.valueEur})`,
    data: { entries: logged.map((x) => ({ id: x.id, product: x.productName, quantity: x.quantity, unit: x.unit, reason: x.reason })) },
  }, db);
  return { logged, totals, unmatched };
}

// ── Report ──

export interface WasteReport {
  from: string;
  to: string;
  logged: { entries: number; valueEur: number; co2Kg: number; unpriced: number };
  byReason: Array<{ reason: WasteReason; entries: number; valueEur: number }>;
  topProducts: Array<{ productName: string; quantity: number; unit: string; valueEur: number; times: number }>;
  /** Food left over after events (from the check-ins), in the same period. */
  eventLeftovers: { events: number; valueEur: number; topProducts: Array<{ productName: string; quantity: number; unit: string; valueEur: number }> };
  /** Plain-language observations a buyer can act on; deterministic, from the numbers above. */
  insights: string[];
}

const DAY_MS = 86_400_000;

export function getWasteReport(input: { from?: string; to?: string }, ctx: GatewayContext): WasteReport {
  const db = gatewayDb(ctx.db ?? getDb());
  const customerId = ctx.agent.customerId;
  const to = input.to ?? clockNow(db).toISOString().slice(0, 10);
  const from = input.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 89 * DAY_MS).toISOString().slice(0, 10);
  if (!ISO.test(from) || !ISO.test(to) || from > to) throw new GatewayError('from and to must be YYYY-MM-DD, from ≤ to', 'invalid');

  const rows = db.select().from(wasteLog)
    .where(and(eq(wasteLog.customerId, customerId), gte(wasteLog.date, from), lte(wasteLog.date, to))).all();

  const byReason = new Map<WasteReason, { entries: number; valueEur: number }>();
  const byProduct = new Map<string, { productName: string; quantity: number; unit: string; valueEur: number; times: number }>();
  for (const r of rows) {
    const reason = r.reason as WasteReason;
    const br = byReason.get(reason) ?? { entries: 0, valueEur: 0 };
    br.entries++; br.valueEur += r.valueEur ?? 0;
    byReason.set(reason, br);
    const key = `${r.productId ?? r.productName}|${r.unit}`;
    const bp = byProduct.get(key) ?? { productName: r.productName, quantity: 0, unit: r.unit, valueEur: 0, times: 0 };
    bp.quantity += r.quantity; bp.valueEur += r.valueEur ?? 0; bp.times++;
    byProduct.set(key, bp);
  }

  // Leftovers from event check-ins: positive amounts are food that was ordered and not eaten.
  const left = db.select({
    orderId: leftovers.orderId, productId: leftovers.productId, qty: leftovers.leftoverQty, unit: leftovers.unit,
    name: orderLines.productName, unitPrice: orderLines.unitPrice, packs: orderLines.packs, ordered: orderLines.quantity,
  }).from(leftovers)
    .innerJoin(orders, eq(orders.id, leftovers.orderId))
    .innerJoin(orderLines, and(eq(orderLines.orderId, leftovers.orderId), eq(orderLines.id, leftovers.lineId)))
    .where(and(eq(orders.customerId, customerId), gte(leftovers.eventDate, from), lte(leftovers.eventDate, to))).all()
    .filter((l) => l.qty > 0);
  const leftByProduct = new Map<string, { productName: string; quantity: number; unit: string; valueEur: number }>();
  for (const l of left) {
    const value = l.ordered ? (l.unitPrice * l.packs * l.qty) / l.ordered : 0;
    const b = leftByProduct.get(l.productId) ?? { productName: l.name, quantity: 0, unit: l.unit, valueEur: 0 };
    b.quantity += l.qty; b.valueEur += value;
    leftByProduct.set(l.productId, b);
  }
  const fix = <T extends { quantity: number; valueEur: number }>(x: T): T => ({ ...x, quantity: round2(x.quantity), valueEur: round2(x.valueEur) });

  const logged = {
    entries: rows.length,
    valueEur: round2(rows.reduce((s, r) => s + (r.valueEur ?? 0), 0)),
    co2Kg: round2(rows.reduce((s, r) => s + (r.co2Kg ?? 0), 0)),
    unpriced: rows.filter((r) => r.valueEur === null).length,
  };
  const topProducts = [...byProduct.values()].sort((a, b) => b.valueEur - a.valueEur || b.quantity - a.quantity).slice(0, 5).map(fix);
  const leftTop = [...leftByProduct.values()].sort((a, b) => b.valueEur - a.valueEur).slice(0, 5).map(fix);
  const eventLeftovers = {
    events: new Set(left.map((l) => l.orderId)).size,
    valueEur: round2(leftTop.reduce((s, x) => s + x.valueEur, 0) + [...leftByProduct.values()].slice(5).reduce((s, x) => s + x.valueEur, 0)),
    topProducts: leftTop,
  };
  const reasons = [...byReason.entries()].map(([reason, v]) => ({ reason, entries: v.entries, valueEur: round2(v.valueEur) }))
    .sort((a, b) => b.valueEur - a.valueEur || b.entries - a.entries);

  const insights: string[] = [];
  const total = logged.valueEur + eventLeftovers.valueEur;
  if (!rows.length && !left.length) insights.push('No waste logged in this period.');
  if (total > 0) insights.push(`About €${Math.round(total)} of food went unused in this period: €${Math.round(logged.valueEur)} logged as waste and €${Math.round(eventLeftovers.valueEur)} left over after events.`);
  const worst = [...byProduct.values()].filter((p) => p.times >= 2).sort((a, b) => b.times - a.times || b.valueEur - a.valueEur).map(fix)[0];
  if (worst) insights.push(`${worst.productName} was thrown away ${worst.times} times (${worst.quantity} ${worst.unit}, about €${Math.round(worst.valueEur)}); consider smaller or less frequent orders.`);
  const over = reasons.find((r) => r.reason === 'overproduction');
  if (over && logged.valueEur > 0 && over.valueEur / logged.valueEur >= 0.3) {
    insights.push(`Overproduction is ${Math.round((over.valueEur / logged.valueEur) * 100)}% of the logged waste value; planEvent already lowers amounts from past leftovers (history notes).`);
  }
  if (leftTop[0]) insights.push(`Most left over after events: ${leftTop[0].productName} (${leftTop[0].quantity} ${leftTop[0].unit}).`);
  if (logged.unpriced) insights.push(`${logged.unpriced} ${logged.unpriced === 1 ? 'entry has' : 'entries have'} no value: never bought here, or logged in a unit the price can't convert.`);

  return { from, to, logged, byReason: reasons, topProducts, eventLeftovers, insights };
}
