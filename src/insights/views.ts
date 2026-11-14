// Port of valioaimo gateway/analytics/views.py: ready-made data for the app — Your year (Wrapped), order history,
// kitchens (CRM).
import * as charts from './charts';
import type { ChartSpec } from './charts';
import { memoryOf, productName, type Buyer } from './data';
import { fmt, MONTHS } from './explain';
import { fixed, grouped } from './math';
import * as query from './query';
import type { QueryResult } from './query';
import type { Cell, Row } from './schema';
import { currentSource, type Sql } from './store';

const PERSONALITY: Record<string, [string, string]> = {
  Maitotuotteet: ['Kermatiimi', 'Maitotuotteet kantoivat keittiötäsi tänä vuonna.'],
  Liha: ['Grillimestari', 'Liha oli ruokalistojesi sydän.'],
  Kala: ['Merenrakastaja', 'Kala johti lautasiasi tänä vuonna.'],
  'Hedelmät ja vihannekset': ['Vihreä kone', 'Tuoretuotteet hallitsivat keittiötäsi.'],
  Leipomotuotteet: ['Aamuvirkku', 'Leipä ja pullat rytmittivät aamujasi.'],
  Kuivatuotteet: ['Ruokakomeron suunnittelija', 'Hyvin varusteltu ruokakomero piti sinut liikkeellä.'],
  Kasvipohjaiset: ['Kasvien edelläkävijä', 'Kasvipohjaiset olivat tavaramerkkisi.'],
};

/** What the views read: the orders connection for the current source, and one buyer's directory entry. */
export interface ViewsHost {
  conn: () => Sql;
  buyer: (buyerId: string) => { id: string; name: string; sites: Array<{ id: string; name: string }> } | undefined;
}

export interface StoryCard {
  kind: string;
  eyebrow: string;
  headline: string;
  sub: string;
  numbers: Array<{ label: string; value: string }>;
  chart?: ChartSpec;
  tone?: 'good' | 'watch';
}

const num = (v: Cell | undefined): number | null => (typeof v === 'number' ? v : null);

function q({ host, buyerId, spec, siteId }: { host: ViewsHost; buyerId: string; spec: Record<string, unknown>; siteId?: string | null }): QueryResult {
  let s = spec;
  if (siteId) {
    const name = host.buyer(buyerId)?.sites.find((x) => x.id === siteId)?.name;
    const filters = Array.isArray(spec.filters) ? spec.filters : [];
    s = { ...spec, filters: [...filters, { field: 'site', op: 'eq', value: name ?? siteId }] };
  }
  return query.run({ conn: host.conn(), spec: s, buyerId });
}

function monthLabel(m: string): string {
  const [y, mm] = m.split('-');
  return `${MONTHS[Number(mm) - 1]} ${y}`;
}

export function wrapped({ host, buyerId, siteId = null }: { host: ViewsHost; buyerId: string; siteId?: string | null }): { title: string; cards: StoryCard[] } {
  const b = host.buyer(buyerId);
  const where = (siteId ? b?.sites.find((s) => s.id === siteId)?.name : b?.name) ?? buyerId;
  const live = currentSource() === 'live';
  const tot = q({ host, buyerId, spec: { measures: ['spend', 'orders', 'kg'] }, siteId });
  if (!tot.rows.length || !num(tot.rows[0].spend)) {
    return { title: `${where}: sinun vuotesi`, cards: [{ kind: 'empty', eyebrow: 'Sinun vuotesi', headline: 'Tarinasi alkaa nyt.',
      sub: live ? 'Tilauksia ei ole vielä tehty. Tee tilaus chatissa ja seuraa, kuinka tämä täyttyy.'
        : 'Tilaa muutaman viikon ajan, niin vuotesi ruoan parissa ilmestyy tähän.', numbers: [] }] };
  }
  const t = tot.rows[0];
  const cards: StoryCard[] = [{ kind: 'intro', eyebrow: 'Vuotesi ruoan parissa', headline: `${where}, mikä vuosi.`,
    sub: live ? 'Kaikki tässä sovelluksessa tehdyt tilaukset, livenä.' : 'Joulu 2025 – marras 2026, kaikki Valio Aimolta tekemäsi tilaukset.',
    numbers: [{ label: 'kulutettu', value: fmt({ v: t.spend, unit: 'EUR' }) }, { label: 'tilausta', value: grouped({ v: num(t.orders) ?? 0, digits: 0 }) },
      ...(num(t.kg) !== null ? [{ label: 'ruokaa', value: `${grouped({ v: (num(t.kg) ?? 0) / 1000, digits: 1 })} t` }] : [])] }];
  const top = q({ host, buyerId, spec: { measures: ['spend', 'orders'], dimensions: ['product'], sort: [{ by: 'spend', dir: 'desc' }], limit: 5 }, siteId });
  const p = top.rows[0];
  cards.push({ kind: 'top_product', eyebrow: 'Ykkösesi', headline: String(p.product), sub: `${String(p.orders)} tilauksella. Mikään muu ei päässyt lähelle.`,
    numbers: [{ label: 'kului siihen', value: fmt({ v: p.spend, unit: 'EUR' }) }], chart: charts.build({ result: top, intent: { type: 'bar' } }) });
  const cats = q({ host, buyerId, spec: { measures: ['spend'], dimensions: ['category'], calc: [{ type: 'share', of: 'spend' }] }, siteId });
  const c0 = cats.rows[0];
  if (c0) {
    const category = String(c0.category);
    const [name, line] = PERSONALITY[category] ?? ['Yleisnero', 'Vähän kaikkea, hyvin tehtynä.'];
    cards.push({ kind: 'personality', eyebrow: 'Keittiösi persoona', headline: name, sub: line,
      numbers: [{ label: `kulutuksesta oli ${category.toLowerCase()}`, value: `${(num(c0.spend_share) ?? 0).toFixed(0)}%` }],
      chart: charts.build({ result: cats, intent: { type: 'donut' } }) });
  }
  const months = q({ host, buyerId, spec: { measures: ['spend'], dimensions: [{ field: 'date', grain: 'month' }] }, siteId });
  const best = months.rows.reduce((a, r) => ((num(r.spend) ?? 0) > (num(a.spend) ?? 0) ? r : a));
  cards.push({ kind: 'busiest_month', eyebrow: 'Vilkkain kuukautesi', headline: monthLabel(String(best.date)), sub: 'Keittiö ei nukkunut hetkeäkään.',
    numbers: [{ label: 'kului sinä kuussa', value: fmt({ v: best.spend, unit: 'EUR' }) }], chart: charts.build({ result: months, intent: { type: 'column' } }) });
  const ev = q({ host, buyerId, spec: { measures: ['guests', 'spend'], dimensions: ['event'], sort: [{ by: 'guests', dir: 'desc' }], limit: 1 }, siteId });
  const evn = q({ host, buyerId, spec: { measures: ['events'] }, siteId }).rows;
  if (ev.rows.length) {
    const e = ev.rows[0];
    cards.push({ kind: 'top_event', eyebrow: 'Suurin iltasi', headline: String(e.event), sub: `Yksi vuoden ${String(evn[0]?.events ?? 0)} tapahtumasta, joissa ruokit vieraita.`,
      numbers: [{ label: 'vierasta', value: grouped({ v: num(e.guests) ?? 0, digits: 0 }) }, { label: 'ruokaan', value: fmt({ v: e.spend, unit: 'EUR' }) }] });
  }
  // Oikeilla tilauksilla ei välttämättä ole hävikki-, CO₂- tai ajallaan-tietoja (null): ne kortit jätetään pois arvaamisen sijaan.
  const waste = q({ host, buyerId, spec: { measures: ['waste_pct'], dimensions: [{ field: 'date', grain: 'month' }] }, siteId });
  const w = waste.rows.map((r) => num(r.waste_pct)).filter((v): v is number => v !== null);
  if (w.length) {
    const first = w.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
    const last = w.slice(-3).reduce((s, v) => s + v, 0) / 3;
    const drop = first ? ((first - last) / first) * 100 : 0;
    cards.push({ kind: 'waste', eyebrow: 'Vähemmän roskiin', headline: `${drop >= 0 ? 'Hävikki' : 'Hävikkiä'} ${drop >= 0 ? `${Math.abs(drop).toFixed(0)} % pienempi` : `${Math.abs(drop).toFixed(0)} % enemmän`}`,
      sub: 'Kolme viimeistä kuukauttasi verrattuna kolmeen ensimmäiseen.', tone: drop >= 0 ? 'good' : 'watch',
      numbers: [{ label: 'hävikki nyt', value: `${fixed({ v: last, digits: 1 })} %` }], chart: charts.build({ result: waste, intent: { type: 'area' } }) });
  }
  const co2 = num(q({ host, buyerId, spec: { measures: ['co2e'] }, siteId }).rows[0]?.co2e);
  if (co2 !== null) {
    const trips = co2 / 31; // car, Helsinki–Tampere one way ≈ 180 km × 0.17 kg/km
    cards.push({ kind: 'co2', eyebrow: 'Jalanjälkesi', headline: `${grouped({ v: co2 / 1000, digits: 0 })} tonnia CO₂e`,
      sub: `Noin ${grouped({ v: trips, digits: 0 })} automatkaa Helsingistä Tampereelle.`,
      numbers: [{ label: 'ruokakiloa kohti', value: `${fixed({ v: co2 / Math.max(1, num(t.kg) ?? 0), digits: 1 })} kg` }] });
  }
  const ot = num(q({ host, buyerId, spec: { measures: ['on_time_pct'] }, siteId }).rows[0]?.on_time_pct);
  if (ot !== null) {
    cards.push({ kind: 'on_time', eyebrow: 'Toimitettu ajallaan', headline: `${ot.toFixed(0)} % kerroista`, sub: 'Valio Aimon autot, säällä kuin säällä.', numbers: [] });
  }
  cards.push({ kind: 'outro', eyebrow: 'Ensi vuosi', headline: 'Jatka kokkaamista. Me jatkamme laskemista.', sub: 'Kysy mitä tahansa vuodestasi Tutki-välilehdellä.', numbers: [] });
  return { title: `${where}: sinun vuotesi`, cards };
}

export interface HistoryOrder {
  id: string; key: string; date: string; siteId: string | null; site: string | null; type: string; event: string | null;
  eventType: string | null; guests: number | null; lines: number; total: number; onTime: boolean; outcome: string; status: 'done';
}

export function orderHistory({ conn, buyerId, page = 1, size = 50, q: text = null, siteId = null, orderType = null, sort = 'date', direction = 'desc' }: {
  conn: Sql; buyerId: string; page?: number; size?: number; q?: string | null; siteId?: string | null;
  orderType?: string | null; sort?: string; direction?: string;
}): { orders: HistoryOrder[]; total: number; page: number; size: number } {
  const where = ['buyer_id = ?'];
  const args: string[] = [buyerId];
  if (siteId) {
    where.push('site_id = ?');
    args.push(siteId);
  }
  if (orderType === 'event' || orderType === 'replenishment') {
    where.push('order_type = ?');
    args.push(orderType);
  }
  if (text) {
    where.push('order_id IN (SELECT order_id FROM line WHERE buyer_id = ? AND (LOWER(event_name) LIKE ? OR LOWER(product) LIKE ? OR LOWER(site_name) LIKE ? OR LOWER(order_id) LIKE ?))');
    const like = `%${text.toLowerCase()}%`;
    args.push(buyerId, like, like, like, like);
  }
  const sortCol: Record<string, string> = { date: 'date', total: 'total', lines: 'lines', site: 'site_name' };
  const sql = `SELECT order_id, MIN(date) AS date, site_id, site_name, order_type, MAX(event_name), MAX(event_type), MAX(guests), `
    + `COUNT(*) AS lines, SUM(value_eur) AS total, MIN(on_time), SUM(label='over_ordered') FROM line WHERE ${where.join(' AND ')} `
    + `GROUP BY order_id ORDER BY ${sortCol[sort] ?? 'date'} ${direction === 'asc' ? 'ASC' : 'DESC'}, order_id DESC`;
  const rows = conn.prepare(sql).raw().all(args).filter(Array.isArray);
  const start = (Math.max(1, page) - 1) * size;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const n = (v: unknown) => (typeof v === 'number' ? v : null);
  const orders = rows.slice(start, start + size).map((r): HistoryOrder => ({
    id: String(r[0]), key: String(r[0]), date: String(r[1]), siteId: str(r[2]), site: str(r[3]), type: String(r[4]), event: str(r[5]),
    eventType: str(r[6]), guests: n(r[7]), lines: n(r[8]) ?? 0, total: Math.round((n(r[9]) ?? 0) * 100) / 100, onTime: Boolean(r[10]),
    outcome: r[11] ? 'Jäi yli' : 'Sopiva määrä', status: 'done',
  }));
  return { orders, total: rows.length, page, size };
}

export function orderDetail({ conn, buyerId, orderId }: { conn: Sql; buyerId: string; orderId: string }) {
  const rows = conn.prepare('SELECT product, category, qty, unit, value_eur, label, on_time, date, site_name, event_name FROM line '
    + 'WHERE buyer_id = ? AND order_id = ? ORDER BY value_eur DESC').all(buyerId, orderId).filter(isRow);
  return {
    id: orderId,
    lines: rows.map((r) => ({ product: r.product, category: r.category, qty: r.qty, unit: r.unit, value: r.value_eur,
      outcome: r.label === 'right_sized' ? 'Sopiva määrä' : 'Jäi yli', onTime: Boolean(r.on_time) })),
    date: rows[0]?.date ?? null, site: rows[0]?.site_name ?? null, event: rows[0]?.event_name ?? null,
  };
}

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface KitchenSite {
  id: string; name: string; type: string; address: string; lead: string; spendMonth: number; ordersMonth: number;
  wastePct: number | null; onTimePct: number | null; trend: number[]; deliveryDays: string[];
}

export interface Kitchens {
  org: { id: string; name: string; segment: string; admin: Buyer['admin']; approvers: Buyer['approvers']; creditLimit: number; openInvoices: number };
  sites: KitchenSite[];
  favourites: Array<{ name: string; pinned: boolean }>;
  limits: Array<{ label: string; value: number | null }>;
  allergens: string[];
  liveApi: boolean;
}

export function kitchens({ host, buyer, liveApi }: { host: ViewsHost; buyer: Buyer; liveApi: boolean }): Kitchens {
  const bid = buyer.id;
  const m = buyer.mandate;
  const mem = memoryOf(bid);
  const sites = buyer.sites.map((s): KitchenSite => {
    const trend = q({ host, buyerId: bid, spec: { measures: ['spend'], dimensions: [{ field: 'date', grain: 'month' }] }, siteId: s.id }).rows;
    const recent = q({ host, buyerId: bid, spec: { measures: ['spend', 'orders', 'waste_pct', 'on_time_pct'], period: 'last_3_months' }, siteId: s.id }).rows;
    const month = q({ host, buyerId: bid, spec: { measures: ['spend', 'orders'], period: 'last_30_days' }, siteId: s.id }).rows;
    const r3 = recent[0] ?? {};
    return {
      id: s.id, name: s.name, type: s.type, address: s.address, lead: s.lead,
      spendMonth: num(month[0]?.spend) ?? 0, ordersMonth: num(month[0]?.orders) ?? 0,
      wastePct: num(r3.waste_pct), onTimePct: num(r3.on_time_pct),
      trend: trend.map((r) => Math.round(num(r.spend) ?? 0)),
      deliveryDays: bid === 'BUY-POHJOLA' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] : ['Mon', 'Wed', 'Fri'],
    };
  });
  return {
    org: { id: bid, name: buyer.name, segment: buyer.segment, admin: buyer.admin, approvers: buyer.approvers,
      creditLimit: buyer.creditLimitEUR, openInvoices: buyer.openInvoicesEUR },
    sites,
    favourites: mem.favourites.map((f) => ({ name: productName(f.key), pinned: Boolean(f.pinned) })),
    limits: [{ label: 'Tilausta kohti', value: m.limits.perOrderEUR }, { label: 'Tapahtumaa kohti', value: m.limits.perEventEUR ?? null },
      { label: 'Kuukaudessa', value: m.limits.perMonthEUR }],
    allergens: m.hardExclusions.allergens,
    liveApi,
  };
}
