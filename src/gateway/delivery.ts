// Simulated delivery timeline. Deterministic: the same order and clock always give the same answer, seeded by the
// order id, so a demo can be replayed and every exception explained. Pure (no I/O): the server wrapper in
// ./deliveries.ts feeds it orders and the demo clock; the scripted widget uses it directly.
import type { DeliveryState, DeliverySummary, ISODate, MeasureUnit } from '@/contracts';

export const DELIVERY_STATES: readonly DeliveryState[] = ['received', 'confirmed', 'picking', 'out_for_delivery', 'delivered'];

/** Lines below this delivery reliability may arrive short. */
export const SHORT_RELIABILITY = 0.9;
/** Ordered closer than this to the cut-off: flagged as a late risk. */
export const LATE_RISK_MS = 2 * 60 * 60_000;
export const SHORT_REASON = 'supplier delivered short';

const MIN = 60_000;
const ETA_STARTS_H = [7, 8, 9];
const ETA_WINDOW_H = 3;

export interface DeliveryOrderLine {
  lineId: string;
  productId: string;
  productName: string;
  packs: number;
  quantity: number;
  unit: MeasureUnit;
  /** Terminal lines are ordered from the supplier first; missing → Stock. */
  logisticModel?: 'Stock' | 'Terminal' | null;
  /** 0..1 delivery reliability of the product (catalogue); missing → reliable. */
  reliability?: number | null;
}

export interface DeliveryOrder {
  orderId: string;
  submittedAt: string;
  deliveryDate: ISODate;
  /** Effective order cut-off; missing on older orders. */
  cutoff?: string | null;
  lines: DeliveryOrderLine[];
}

export interface DeliveryLine {
  lineId: string;
  productId: string;
  productName: string;
  unit: MeasureUnit;
  logisticModel: 'Stock' | 'Terminal';
  orderedPacks: number;
  orderedQty: number;
  /** Known once delivered; null before. */
  deliveredPacks: number | null;
  deliveredQty: number | null;
  short: boolean;
  reason?: string;
}

export interface DeliveryStatus {
  orderId: string;
  simulated: true;
  state: DeliveryState;
  steps: Array<{ state: DeliveryState; at: string; reached: boolean }>;
  /** ETA window on the delivery day; delivered at its end. */
  eta: { from: string; to: string };
  cutoff: string | null;
  cutoffPassed: boolean;
  lateRisk: { reason: string } | null;
  /** Sub-track for supplier (Terminal) lines, before picking. */
  supplier: { lineIds: string[]; orderedAt: string; arrivedAt: string; state: 'waiting' | 'ordered' | 'arrived' } | null;
  lines: DeliveryLine[];
  /** When the next step happens; null once delivered. */
  nextChangeAt: string | null;
  /** Plain-English reasons for the timeline and any exception. */
  notes: string[];
}

/** FNV-1a → [0, 1). */
export function unitHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

function helsinkiOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Helsinki', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(utcMs / MIN) * MIN) / MIN);
}

/** `date` at `hours` (fractional) Helsinki local time, as epoch ms. */
export function helsinkiAt(date: ISODate, hours: number): number {
  const naive = Date.parse(`${date}T00:00:00Z`) + Math.round(hours * 60) * MIN;
  const guess = naive - helsinkiOffsetMinutes(naive) * MIN;
  return naive - helsinkiOffsetMinutes(guess) * MIN;
}

const dayBefore = (date: ISODate) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString();
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' });

/** Whether, and by how much, a line arrives short. Deterministic per order and line. */
export function shortfall(orderId: string, line: DeliveryOrderLine): { deliveredPacks: number } | null {
  const r = line.reliability;
  if (r == null || r >= SHORT_RELIABILITY || line.packs <= 0) return null;
  // Probability of a short delivery = 1 − reliability.
  if (unitHash(`${orderId}:${line.lineId}:short`) >= 1 - r) return null;
  const fraction = 0.1 + 0.2 * unitHash(`${orderId}:${line.lineId}:qty`);
  const missing = Math.min(line.packs, Math.max(1, Math.round(line.packs * fraction)));
  return { deliveredPacks: line.packs - missing };
}

/** The timeline's fixed moments for an order (independent of the clock). */
export function deliverySchedule(order: DeliveryOrder) {
  const submitted = Date.parse(order.submittedAt);
  const cutoff = order.cutoff ? Date.parse(order.cutoff) : null;
  // Valio confirms about an hour after the order, or at the cut-off when that comes sooner.
  const confirmLag = (45 + Math.floor(unitHash(`${order.orderId}:confirm`) * 31)) * MIN;
  const confirmed = cutoff !== null && cutoff > submitted ? Math.min(submitted + confirmLag, cutoff) : submitted + confirmLag;
  let picking = Math.max(helsinkiAt(dayBefore(order.deliveryDate), 18), confirmed + 30 * MIN);

  const terminal = order.lines.filter((l) => l.logisticModel === 'Terminal');
  let supplier: { orderedAt: number; arrivedAt: number } | null = null;
  if (terminal.length) {
    const target = helsinkiAt(dayBefore(order.deliveryDate), 10 + unitHash(`${order.orderId}:terminal`) * 6);
    const arrivedAt = Math.max(target, confirmed + 30 * MIN);
    picking = Math.max(picking, arrivedAt + 15 * MIN);
    supplier = { orderedAt: confirmed, arrivedAt };
  }

  const out = Math.max(helsinkiAt(order.deliveryDate, 6), picking + 60 * MIN);
  const startH = ETA_STARTS_H[Math.floor(unitHash(`${order.orderId}:eta`) * ETA_STARTS_H.length)];
  const etaFrom = Math.max(helsinkiAt(order.deliveryDate, startH), out + 30 * MIN);
  const etaTo = etaFrom + ETA_WINDOW_H * 60 * MIN;
  return {
    times: { received: submitted, confirmed, picking, out_for_delivery: out, delivered: etaTo } as Record<DeliveryState, number>,
    eta: { from: etaFrom, to: etaTo },
    supplier,
    terminalLineIds: terminal.map((l) => l.lineId),
    cutoff,
  };
}

/** The delivery state of an order at `now` (demo clock). */
export function deliveryStatus(order: DeliveryOrder, now: Date): DeliveryStatus {
  const nowMs = now.getTime();
  const s = deliverySchedule(order);
  const steps = DELIVERY_STATES.map((state) => ({ state, at: iso(s.times[state]), reached: s.times[state] <= nowMs }));
  const reached = steps.filter((st) => st.reached);
  const state = reached.at(-1)?.state ?? 'received';
  const delivered = state === 'delivered';
  const notes: string[] = [];

  const lines: DeliveryLine[] = order.lines.map((l) => {
    const short = shortfall(order.orderId, l);
    const unitQty = l.packs > 0 ? l.quantity / l.packs : 0;
    const deliveredPacks = delivered ? (short ? short.deliveredPacks : l.packs) : null;
    if (delivered && short) {
      notes.push(`${l.productName}: ${SHORT_REASON} (${short.deliveredPacks} of ${l.packs} packs; delivery reliability ${Math.round((l.reliability ?? 1) * 100)}%)`);
    }
    return {
      lineId: l.lineId, productId: l.productId, productName: l.productName, unit: l.unit,
      logisticModel: l.logisticModel === 'Terminal' ? 'Terminal' : 'Stock',
      orderedPacks: l.packs, orderedQty: l.quantity,
      deliveredPacks, deliveredQty: deliveredPacks === null ? null : round6(deliveredPacks * unitQty),
      short: delivered && !!short,
      ...(delivered && short ? { reason: SHORT_REASON } : {}),
    };
  });

  let lateRisk: DeliveryStatus['lateRisk'] = null;
  const submitted = Date.parse(order.submittedAt);
  if (s.cutoff !== null && s.cutoff >= submitted && s.cutoff - submitted < LATE_RISK_MS) {
    lateRisk = { reason: `Ordered ${Math.round((s.cutoff - submitted) / MIN)} min before the order cut-off (${hhmm(s.cutoff)})` };
    notes.push(lateRisk.reason);
  }

  const supplier: DeliveryStatus['supplier'] = s.supplier && {
    lineIds: s.terminalLineIds,
    orderedAt: iso(s.supplier.orderedAt),
    arrivedAt: iso(s.supplier.arrivedAt),
    state: nowMs >= s.supplier.arrivedAt ? 'arrived' : nowMs >= s.supplier.orderedAt ? 'ordered' : 'waiting',
  };
  if (supplier) notes.push(`${supplier.lineIds.length} line(s) come from the supplier via the Valio Aimo terminal before picking`);

  const upcoming = [...Object.values(s.times), ...(s.supplier ? [s.supplier.orderedAt, s.supplier.arrivedAt] : [])]
    .filter((t) => t > nowMs).sort((a, b) => a - b);
  return {
    orderId: order.orderId,
    simulated: true,
    state,
    steps,
    eta: { from: iso(s.eta.from), to: iso(s.eta.to) },
    cutoff: s.cutoff === null ? null : iso(s.cutoff),
    cutoffPassed: s.cutoff !== null && nowMs >= s.cutoff,
    lateRisk,
    supplier,
    lines,
    nextChangeAt: delivered ? null : upcoming.length ? iso(upcoming[0]) : null,
    notes,
  };
}

/** The next main step after `now`, for the demo's "Next delivery step". */
export function nextStepAt(order: DeliveryOrder, now: Date): string | null {
  const { times } = deliverySchedule(order);
  const next = DELIVERY_STATES.map((st) => times[st]).find((t) => t > now.getTime());
  return next === undefined ? null : iso(next);
}

export function summarizeDelivery(status: DeliveryStatus): DeliverySummary {
  return { state: status.state, eta: status.eta, shortLines: status.lines.filter((l) => l.short).length, lateRisk: status.lateRisk !== null };
}
