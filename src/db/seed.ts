import type { AuditEntry, EventType, MeasureUnit, PortionCategory, Receipt } from '@/contracts';
import { GATEWAY_DDL, getDb, type Db } from './client';
import { appendAudit, nextOrderId, recordLeftovers, storeOrder, upsertCustomer } from './repo';
import { auditLog, customers, deliveries, drafts, gatewayApprovals, gatewayChats, gatewayOffers, leftovers, orderLines, orders, settings, wasteLog } from './schema';

export const DEMO_CUSTOMER = { id: 'helsinki-juhlapalvelu', name: 'Helsinki Juhlapalvelu Oy' };

const VAT_RATE = 0.14;
const DAY_MS = 86_400_000;

interface SeedProduct {
  id: string; name: string; category: PortionCategory; packSize: number; unit: MeasureUnit;
  /** Per pack, excl. VAT. Illustrative, not live Valio prices. */
  price: number;
}

// Real ids and English names from the Valio catalogue (data/raw/products.json).
const P = {
  chickenBreast: { id: '462281', name: 'Kariniemen Chicken breastfillet natural 160-185g/appr 4,4 kg', category: 'poultry_main', packSize: 4.4, unit: 'kg', price: 38.5 },
  chickenThigh: { id: '463553', name: 'Kariniemen Chicken thigh escalope mild salted appr. 2kg', category: 'poultry_main', packSize: 2, unit: 'kg', price: 13.2 },
  jasmine: { id: '474454', name: 'Vivien Paille long-grain Jasmine Rice 5kg', category: 'grain_side', packSize: 5, unit: 'kg', price: 11.9 },
  basmati: { id: '463624', name: 'Habib Basmati rice 5kg', category: 'grain_side', packSize: 5, unit: 'kg', price: 13.4 },
  parboiled: { id: '463511', name: 'AIMO 10KG PARBOILED LONG GRAIN RICE', category: 'grain_side', packSize: 10, unit: 'kg', price: 14.9 },
  potato: { id: '470961', name: 'PP PRE-WASHED POTATO 35-50MM 15KG/BX', category: 'potato_side', packSize: 15, unit: 'kg', price: 13.5 },
  cream: { id: '464249', name: 'Valio cooking cream 15 % 1 l UHT lactose free', category: 'sauce', packSize: 1, unit: 'l', price: 4.6 },
  salad: { id: '470120', name: 'Fresh SalaattiMestari Iceberg-frisée-red lettuce 1,0 kg bag', category: 'salad', packSize: 1, unit: 'kg', price: 7.8 },
  bread: { id: '461404', name: 'Vaasan White bread, sliced 6x500g', category: 'bread', packSize: 3, unit: 'kg', price: 14.2 },
  coffee: { id: '462086', name: 'Paulig Presidentti Dark Roast 12x500g filter ground coffee', category: 'beverage', packSize: 6, unit: 'kg', price: 66 },
  broccoli: { id: '461342', name: 'Apetit Broccoli frozen 5kg', category: 'veg_side', packSize: 5, unit: 'kg', price: 17.5 },
  mousse: { id: '462189', name: "Carte d'Or Chocolate mousse 1,44kg/10L", category: 'dessert', packSize: 1.44, unit: 'kg', price: 11.9 },
} satisfies Record<string, SeedProduct>;

type ProductKey = keyof typeof P;
/** [product, packs, leftover ratio] where ratio = leftover ÷ ordered (negative = short, null = not recorded). */
type SeedLine = [ProductKey, number, number | null];

interface SeedEvent {
  eventName: string; eventType: EventType; daysAgo: number; guests: number; minutesSaved: number; lines: SeedLine[];
}

const EVENTS: SeedEvent[] = [
  { eventName: 'Corporate lunch', eventType: 'corporate_lunch', daysAgo: 34, guests: 90, minutesSaved: 36, lines: [
    ['chickenBreast', 4, 0.11], ['jasmine', 2, 0.1], ['salad', 3, 0.06], ['bread', 2, 0.15], ['coffee', 1, 0], ['mousse', 2, null]] },
  { eventName: 'Wedding', eventType: 'wedding', daysAgo: 75, guests: 300, minutesSaved: 45, lines: [
    ['chickenBreast', 12, 0.114], ['chickenThigh', 3, 0.1], ['basmati', 6, 0.1], ['potato', 4, 0.07],
    ['cream', 6, 0.05], ['salad', 8, 0.08], ['mousse', 4, null]] },
  { eventName: 'Corporate lunch', eventType: 'corporate_lunch', daysAgo: 120, guests: 70, minutesSaved: 35, lines: [
    ['chickenThigh', 4, 0.12], ['parboiled', 1, 0.1], ['broccoli', 2, 0], ['bread', 2, 0.15], ['coffee', 1, 0.05]] },
  { eventName: 'Midsummer party', eventType: 'party', daysAgo: 148, guests: 150, minutesSaved: 42, lines: [
    ['chickenBreast', 6, 0.1], ['potato', 4, 0.09], ['salad', 5, 0.1], ['bread', 3, 0.12], ['cream', 3, 0], ['mousse', 3, null]] },
  { eventName: 'Wedding', eventType: 'wedding', daysAgo: 250, guests: 220, minutesSaved: 44, lines: [
    ['chickenBreast', 9, 0.1], ['jasmine', 4, -0.05], ['potato', 3, 0.06], ['broccoli', 3, 0.04],
    ['coffee', 2, 0.08], ['mousse', 3, null]] },
  { eventName: 'Corporate lunch', eventType: 'corporate_lunch', daysAgo: 330, guests: 120, minutesSaved: 38, lines: [
    ['chickenThigh', 5, 0.11], ['basmati', 3, 0.12], ['salad', 4, 0.05], ['bread', 2, 0.1], ['coffee', 1, 0.02]] },
  { eventName: 'Christmas party', eventType: 'party', daysAgo: 355, guests: 180, minutesSaved: 43, lines: [
    ['chickenThigh', 8, 0.12], ['parboiled', 2, 0.09], ['potato', 5, 0.08], ['cream', 4, 0.06],
    ['broccoli', 3, 0.05], ['coffee', 2, 0.1], ['mousse', 3, null]] },
  { eventName: 'Buffet', eventType: 'buffet', daysAgo: 500, guests: 140, minutesSaved: 40, lines: [
    ['chickenBreast', 5, 0.1], ['jasmine', 3, 0.11], ['salad', 5, 0.07], ['bread', 3, 0.1], ['mousse', 2, null]] },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

function buildReceipt(orderId: string, e: SeedEvent, deliveryDate: string, submittedAt: string): Receipt {
  const lines = e.lines.map(([key, packs], i) => {
    const p = P[key];
    const lineTotal = round2(packs * p.price);
    return {
      lineId: `l-${i + 1}`, productId: p.id, productName: p.name, packs, quantity: round2(packs * p.packSize),
      unit: p.unit, unitPrice: p.price, unitPriceWithTax: round2(p.price * (1 + VAT_RATE)),
      lineTotal, lineTotalWithTax: round2(lineTotal * (1 + VAT_RATE)),
    };
  });
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const totalWithTax = round2(total * (1 + VAT_RATE));
  return {
    orderId, simulated: true, customerId: DEMO_CUSTOMER.id, eventName: e.eventName, eventType: e.eventType,
    deliveryDate, guests: e.guests, lines, total, totalWithTax, vat: round2(totalWithTax - total),
    co2Kg: null, minutesSaved: e.minutesSaved, submittedAt,
  };
}

function seedAudit(db: Db, receipt: Receipt, e: SeedEvent, submittedAt: string, recordedAt: string) {
  const base = { conversationId: `seed-${receipt.orderId}`, orderId: receipt.orderId };
  const entries: Array<Omit<AuditEntry, 'id'>> = [
    { ...base, at: submittedAt, actor: 'buyer', action: 'request',
      summary: `Asked for ${e.eventName.toLowerCase()} for ${e.guests} guests` },
    { ...base, at: submittedAt, actor: 'allergen', action: 'checkAllergens',
      summary: `Checked ${receipt.lines.length} products against the guests' dietary needs` },
    { ...base, at: submittedAt, actor: 'order', action: 'submitOrder',
      summary: `Order ${receipt.orderId} approved by the buyer (simulated), total EUR ${receipt.total.toFixed(2)} excl. VAT` },
  ];
  if (e.lines.some(([, , r]) => r !== null)) {
    entries.push({ ...base, at: recordedAt, actor: 'history', action: 'recordLeftovers',
      summary: 'Recorded leftover and shortfall amounts after the event' });
  }
  for (const { at, ...entry } of entries) appendAudit({ ...entry, at }, db);
}

export function resetAndSeed(db: Db = getDb()): { customers: number; orders: number; lines: number; leftovers: number; audit: number } {
  // A long-running server's connection may predate newer gateway tables.
  (db as unknown as { $client?: { exec: (sql: string) => void } }).$client?.exec(GATEWAY_DDL);
  for (const table of [leftovers, orderLines, orders, drafts, auditLog, settings, customers, gatewayOffers, gatewayApprovals, gatewayChats, deliveries, wasteLog]) db.delete(table).run();
  upsertCustomer(DEMO_CUSTOMER, db);

  const today = Date.now();
  let lineCount = 0;
  let leftoverCount = 0;
  for (const e of EVENTS) {
    const eventTime = today - e.daysAgo * DAY_MS;
    const deliveryDate = isoDate(eventTime);
    const submittedAt = new Date(eventTime - 21 * DAY_MS).toISOString();
    const recordedAt = new Date(eventTime + DAY_MS).toISOString();

    const receipt = buildReceipt(nextOrderId(db), e, deliveryDate, submittedAt);
    storeOrder(receipt, new Map(receipt.lines.map((l, i) => [l.lineId, P[e.lines[i][0]].category])), db);

    const entries = e.lines.flatMap(([, , ratio], i) =>
      ratio === null ? [] : [{ lineId: receipt.lines[i].lineId, leftoverQty: round1(receipt.lines[i].quantity * ratio) }]);
    recordLeftovers(receipt.orderId, entries, db, recordedAt);

    seedAudit(db, receipt, e, submittedAt, recordedAt);
    lineCount += receipt.lines.length;
    leftoverCount += entries.length;
  }
  seedWaste(db, today);
  const auditCount = db.select().from(auditLog).all().length;
  return { customers: 1, orders: EVENTS.length, lines: lineCount, leftovers: leftoverCount, audit: auditCount };
}

// Day-to-day food waste the kitchen logged (hävikki), so getWasteReport has a history to show. Valued like logWaste:
// at the price per kg/l paid (the seed prices above). CO₂ uses rough product-group figures (kg CO₂e per kg).
const WASTE: Array<{ daysAgo: number; product: keyof typeof P; quantity: number; reason: string; co2PerKg: number; note?: string }> = [
  { daysAgo: 62, product: 'basmati', quantity: 4, reason: 'overproduction', co2PerKg: 2.7, note: 'Lunch buffet, cooked too much' },
  { daysAgo: 48, product: 'cream', quantity: 6, reason: 'expired', co2PerKg: 2.9 },
  { daysAgo: 40, product: 'basmati', quantity: 3.5, reason: 'overproduction', co2PerKg: 2.7 },
  { daysAgo: 33, product: 'salad', quantity: 2.5, reason: 'spoiled', co2PerKg: 0.9 },
  { daysAgo: 21, product: 'bread', quantity: 3, reason: 'plate_waste', co2PerKg: 1.3 },
  { daysAgo: 12, product: 'basmati', quantity: 5, reason: 'overproduction', co2PerKg: 2.7, note: 'Wedding buffet' },
  { daysAgo: 5, product: 'cream', quantity: 4, reason: 'expired', co2PerKg: 2.9 },
];

function seedWaste(db: Db, today: number): void {
  WASTE.forEach((w, i) => {
    const p = P[w.product];
    const at = today - w.daysAgo * DAY_MS;
    db.insert(wasteLog).values({
      id: `WS-SEED${String(i + 1).padStart(2, '0')}`, customerId: DEMO_CUSTOMER.id, date: isoDate(at), productId: p.id,
      productName: p.name, quantity: w.quantity, unit: p.unit, reason: w.reason,
      orderId: null, valueEur: Math.round((p.price / p.packSize) * w.quantity * 100) / 100,
      co2Kg: Math.round(w.quantity * w.co2PerKg * 100) / 100, note: w.note ?? null, source: 'kitchen-staff', recordedAt: new Date(at).toISOString(),
    }).run();
  });
}
