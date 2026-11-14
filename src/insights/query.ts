// Port of valioaimo gateway/analytics/query.py: query spec -> SQL over the `line` table. Callers never send SQL.
//
// Spec (all keys optional except measures):
//   measures:   ["spend", "waste_pct", ...]                       names from SCHEMA.measures
//   dimensions: ["category", {"field": "date", "grain": "month"}] names from SCHEMA.dimensions
//   filters:    [{"field": "site", "op": "eq|neq|in|not_in|contains|gte|lte|between", "value": ...}]
//   period:     {"from": "2026-01-01", "to": "2026-06-30"} or "last_month" | "last_3_months" |
//               "last_6_months" | "last_30_days" | "this_year"
//   compare:    "previous_period" | "previous_year"   (adds <m>_prev and <m>_change_pct; no date dimension)
//   calc:       [{"type": "share|running_total|rank|change_pct|moving_avg|forecast|anomaly", "of": "spend", "window": 3}]
//   sort:       [{"by": "spend", "dir": "desc"}]
//   limit:      int (1-500);  other: true folds the rest into one "Other" row
//   dataset:    "orders" (default, the order history) | "agent_activity" | "demand"
// Every bad input raises GuardFailed with a `fix` that names what is valid.
// Cross-buyer queries (buyerId null) pass kAnon: groups with fewer than kAnon buyers are dropped (reported as
// `suppressed`), and grouping by a buyer-identifying field is refused.
import { DATASETS } from './datasets';
import { addDays, daysBetween, isoOf, isoWeekMonday, parseIso, weekday, weekLabel, withYear } from './dates';
import { fail } from './errors';
import { round } from './math';
import { END, SCHEMA, START, type Cell, type DatasetSchema, type MeasureDef, type Row } from './schema';
import { currentSource, LIVE_PERIOD, type Sql } from './store';

export const GRAINS: Record<string, string> = {
  day: 'date', week: "strftime('%Y-W%W', date)", month: 'substr(date,1,7)',
  quarter: "substr(date,1,4) || '-Q' || ((CAST(substr(date,6,2) AS INTEGER)+2)/3)",
};
export const OPS: Record<string, string> = {
  eq: '=', neq: '!=', gte: '>=', lte: '<=', contains: 'LIKE', in: 'IN', not_in: 'NOT IN', between: 'BETWEEN',
};
const ADDITIVE = new Set(['spend', 'waste', 'co2e', 'kg', 'quantity', 'lines']);
export const RELATIVE = ['last_month', 'last_3_months', 'last_6_months', 'last_30_days', 'this_year'];
export const CALCS = ['share', 'running_total', 'rank', 'change_pct', 'moving_avg', 'forecast', 'anomaly'];
const TIME_CALCS = new Set(['forecast', 'anomaly']); // need exactly one dimension, the date

export interface Dataset {
  name: string;
  table: string;
  schema: DatasetSchema;
  period: [string, string];
  buyerCol: string;
}

export interface DimSpec { field: string; grain: string | null }
export interface CalcSpec { type: string; of: string; window?: unknown; horizon?: number }
export interface SortSpec { by?: unknown; dir?: unknown }
export interface NormalSpec {
  measures: string[];
  dimensions: DimSpec[];
  filters: unknown[];
  period: unknown;
  compare: 'previous_period' | 'previous_year' | null;
  calc: CalcSpec[];
  sort: SortSpec[];
  limit: number | null;
  other: boolean;
  dataset?: string;
}

export interface Column {
  name: string;
  label: string;
  type?: string;
  unit?: string | null;
  role: 'dimension' | 'measure' | 'derived';
}

export interface QueryResult {
  spec: NormalSpec;
  columns: Column[];
  rows: Row[];
  period: { from: string; to: string };
  dataset: string;
  suppressed?: number;
  kAnonymity?: number;
  shape: { dims: string[]; measures: string[]; timeDim: string | null; n: number; grain: string | null };
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const keys = (o: object) => Object.keys(o).join(', ');
const num = (v: Cell | undefined): number | null => (typeof v === 'number' ? v : null);

export const ORDERS: Dataset = { name: 'orders', table: 'line', schema: SCHEMA, period: [START, END], buyerCol: 'buyer_id' };

/** Live orders: the source's live period, widened to cover every order this project has. */
function livePeriod(conn: Sql | undefined): [string, string] {
  const r = conn?.prepare('SELECT MIN(date) AS a, MAX(date) AS b FROM line').get();
  const a = isRecord(r) && typeof r.a === 'string' ? `${r.a.slice(0, 7)}-01` : LIVE_PERIOD[0];
  const b = isRecord(r) && typeof r.b === 'string' ? r.b : LIVE_PERIOD[1];
  return [a < LIVE_PERIOD[0] ? a : LIVE_PERIOD[0], b > LIVE_PERIOD[1] ? b : LIVE_PERIOD[1]];
}

/** The dataset a spec names; the orders connection gives live mode its period. */
export function dataset({ name, conn }: { name: unknown; conn?: Sql }): Dataset {
  if (name === undefined || name === null || name === 'orders') {
    return currentSource() === 'live' ? { ...ORDERS, period: livePeriod(conn) } : ORDERS;
  }
  if (!has(DATASETS, name)) fail({ message: `Tuntematon aineisto '${String(name)}'.`, fix: `Käytä jotakin näistä: orders, ${keys(DATASETS)}.` });
  return { name, ...DATASETS[name] };
}

function monthStart({ iso, back }: { iso: string; back: number }): string {
  const d = parseIso(iso);
  const m = d.month - back;
  const year = d.year + Math.floor((m - 1) / 12);
  return isoOf({ year, month: (((m - 1) % 12) + 12) % 12 + 1, day: 1 });
}

export function resolvePeriod({ period, ds = ORDERS }: { period: unknown; ds?: Dataset }): [string, string] {
  const [start, end] = ds.period;
  if (period === null || period === undefined) return [start, end];
  if (typeof period === 'string') {
    if (period === 'last_month') return [monthStart({ iso: end, back: 0 }), end];
    if (period === 'last_3_months' || period === 'last_6_months') {
      return [monthStart({ iso: end, back: period === 'last_3_months' ? 2 : 5 }), end];
    }
    if (period === 'last_30_days') return [addDays({ iso: end, days: -29 }), end];
    if (period === 'this_year') return [start, end];
    fail({ message: `Tuntematon ajanjakso '${period}'.`, fix: `Käytä jotakin näistä ${JSON.stringify(RELATIVE)} tai {'from': 'VVVV-KK-PP', 'to': 'VVVV-KK-PP'}.` });
  }
  let a: string;
  let b: string;
  try {
    if (!isRecord(period)) throw new RangeError('period is not an object');
    a = String(period.from ?? start);
    b = String(period.to ?? end);
    parseIso(a);
    parseIso(b);
  } catch {
    fail({ message: 'Ajanjakson päivämäärien muoto on VVVV-KK-PP.', fix: "Esimerkki: {'from': '2026-01-01', 'to': '2026-03-31'}." });
  }
  if (a > b) fail({ message: "Ajanjakson alku on loppua myöhemmin.", fix: 'Vaihda päivämäärät keskenään.' });
  return [a, b];
}

export function normalise({ spec, ds = ORDERS }: { spec: unknown; ds?: Dataset }): NormalSpec {
  const { dimensions: DIMS, measures: MEAS } = ds.schema;
  if (!isRecord(spec)) fail({ message: 'Kyselyn on oltava objekti.', fix: "Lähetä {'measures': ['spend'], 'dimensions': ['category']}." });
  let raw: unknown = spec.measures || [];
  if (typeof raw === 'string') raw = [raw];
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length) fail({ message: 'Tarvitaan vähintään yksi mittari.', fix: `Valitse näistä: ${keys(MEAS)}.` });
  const ms = list.map((m) => (isRecord(m) ? m.field : m));
  const measures: string[] = [];
  for (const m of ms) {
    if (!has(MEAS, m)) fail({ message: `Tuntematon mittari '${String(m)}'.`, fix: `Käytä jotakin näistä: ${keys(MEAS)}.` });
    measures.push(m);
  }
  const dims: DimSpec[] = [];
  for (const d of Array.isArray(spec.dimensions) ? spec.dimensions : []) {
    const f = typeof d === 'string' ? d : isRecord(d) ? d.field : undefined;
    let g = isRecord(d) ? d.grain : null;
    if (!has(DIMS, f)) fail({ message: `Tuntematon ulottuvuus '${String(f)}'.`, fix: `Käytä jotakin näistä: ${keys(DIMS)}.` });
    if (DIMS[f].type === 'time') {
      g = g || 'month';
      if (!has(GRAINS, g)) fail({ message: `Tuntematon aikaväli '${String(g)}'.`, fix: `Käytä jotakin näistä: ${keys(GRAINS)}.` });
    }
    // a grain only means something on the date (Python would build SQL from it and fail)
    dims.push({ field: f, grain: DIMS[f].type === 'time' && typeof g === 'string' ? g : null });
  }
  if (dims.length > 3) fail({ message: 'Liian monta ulottuvuutta.', fix: 'Käytä enintään 3 ulottuvuutta.' });
  const calc: CalcSpec[] = [];
  for (const c of Array.isArray(spec.calc) ? spec.calc : []) {
    const type = isRecord(c) ? c.type : undefined;
    if (!isRecord(c) || typeof type !== 'string' || !CALCS.includes(type)) {
      fail({ message: `Tuntematon laskenta '${String(type ?? null)}'.`, fix: `Käytä jotakin näistä: ${CALCS.join(', ')}.` });
    }
    if (TIME_CALCS.has(type) && !(dims.length === 1 && DIMS[dims[0].field].type === 'time')) {
      fail({ message: `Laskenta '${type}' toimii yhdelle aikasarjalle.`,
        fix: "Käytä täsmälleen yhtä ulottuvuutta: {'field': 'date', 'grain': 'month'} (tai week, day, quarter)." });
    }
    const out: CalcSpec = { type, of: '' };
    if (c.window !== undefined) out.window = c.window;
    if (type === 'forecast') {
      const h = c.horizon ?? 3;
      if (!(typeof h === 'number' && Number.isInteger(h) && h >= 1 && h <= 6)) {
        fail({ message: 'Ennusteen jänteen on oltava 1–6 jaksoa.', fix: "Esimerkki: {'type': 'forecast', 'of': 'spend', 'horizon': 3}." });
      }
      out.horizon = h;
    }
    const of = c.of ?? measures[0];
    if (typeof of !== 'string' || !measures.includes(of)) {
      fail({ message: `Laskenta '${type}' viittaa kohteeseen '${String(of)}', joka ei ole tämän kyselyn mittari.`, fix: `Käytä jotakin näistä: ${measures.join(', ')}.` });
    }
    out.of = of;
    calc.push(out);
  }
  const limit = spec.limit ?? null;
  if (limit !== null && !(typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 500)) {
    fail({ message: 'Rivirajan on oltava kokonaisluku 1–500.', fix: "Esimerkki: 'limit': 10." });
  }
  const compare = spec.compare ?? null;
  if (compare !== null && compare !== 'previous_period' && compare !== 'previous_year') {
    fail({ message: `Tuntematon vertailu '${String(compare)}'.`, fix: "Käytä 'previous_period' tai 'previous_year'." });
  }
  if (compare && dims.some((d) => DIMS[d.field].type === 'time')) {
    fail({ message: 'Vertailua ei voi yhdistää päivämääräulottuvuuteen.', fix: "Poista päivämääräulottuvuus tai käytä laskentaa 'change_pct' ajan muutokseen." });
  }
  return {
    measures, dimensions: dims, filters: Array.isArray(spec.filters) ? spec.filters : [], period: spec.period ?? null,
    compare, calc, sort: Array.isArray(spec.sort) ? spec.sort.filter(isRecord) : [], limit, other: Boolean(spec.other),
  };
}

type Bind = string | number | null;

function bindable(v: unknown): Bind {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  return fail({ message: 'Suodattimen arvojen on oltava tekstiä tai lukuja.', fix: "Esimerkki: {'field': 'site', 'op': 'eq', 'value': 'Pohjola Tampere'}." });
}

function where({ filters, buyerId, a, b, ds }: {
  filters: unknown[]; buyerId: string | null; a: string; b: string; ds: Dataset;
}): [string, Bind[]] {
  const DIMS = ds.schema.dimensions;
  const parts = ['date BETWEEN ? AND ?'];
  const args: Bind[] = [a, b];
  if (buyerId !== null) { // a buyer sees only its own rows
    parts.unshift(`${ds.buyerCol} = ?`);
    args.unshift(buyerId);
  }
  for (const f of filters) {
    const r = isRecord(f) ? f : {};
    const field = r.field;
    const op = r.op ?? 'eq';
    const val = r.value;
    if (!has(DIMS, field)) fail({ message: `Kentällä '${String(field ?? null)}' ei voi suodattaa.`, fix: `Suodata jollakin näistä: ${keys(DIMS)}.` });
    if (!has(OPS, op)) fail({ message: `Tuntematon suodatinoperaattori '${String(op)}'.`, fix: `Käytä jotakin näistä: ${keys(OPS)}.` });
    const col = DIMS[field].sql;
    if (op === 'in' || op === 'not_in') {
      const vals = Array.isArray(val) ? val : [val];
      if (!vals.length) fail({ message: "'in' tarvitsee arvolistan.", fix: "Esimerkki: {'op': 'in', 'value': ['Maitotuotteet', 'Kala']}." });
      parts.push(`${col} ${OPS[op]} (${vals.map(() => '?').join(', ')})`);
      args.push(...vals.map(bindable));
    } else if (op === 'between') {
      if (!(Array.isArray(val) && val.length === 2)) {
        fail({ message: "'between' tarvitsee muodon [alin, ylin].", fix: "Esimerkki: {'op': 'between', 'value': ['2026-01-01', '2026-03-31']}." });
      }
      parts.push(`${col} BETWEEN ? AND ?`);
      args.push(...val.map(bindable));
    } else if (op === 'contains') {
      parts.push(`LOWER(${col}) LIKE ?`);
      args.push(`%${String(val).toLowerCase()}%`);
    } else {
      parts.push(`${col} ${OPS[op]} ?`);
      args.push(bindable(val));
    }
  }
  return [parts.join(' AND '), args];
}

function select({ conn, s, buyerId, a, b, ds, kAnon }: {
  conn: Sql; s: NormalSpec; buyerId: string | null; a: string; b: string; ds: Dataset; kAnon: number;
}): { rows: Row[]; suppressed: number } {
  const { dimensions: DIMS, measures: MEAS } = ds.schema;
  const dcols = s.dimensions.map((d): [string, string] => [d.field, d.grain ? GRAINS[d.grain] : DIMS[d.field].sql]);
  // internal aliases (d_x / m_x): an alias equal to a column name (e.g. "date") would make SQLite group by the raw column
  const sel = [...dcols.map(([name, expr]) => `${expr} AS d_${name}`), ...s.measures.map((m) => `${MEAS[m].sql} AS m_${m}`)];
  if (kAnon) sel.push(`COUNT(DISTINCT ${ds.buyerCol}) AS k_buyers`);
  const [w, args] = where({ filters: s.filters, buyerId, a, b, ds });
  let sql = `SELECT ${sel.join(', ')} FROM ${ds.table} WHERE ${w}`;
  if (dcols.length) sql += ` GROUP BY ${dcols.map(([n]) => `d_${n}`).join(', ')} HAVING COUNT(*) > 0`;
  const stmt = conn.prepare(sql);
  const names = stmt.columns().map((c) => c.name.slice(2));
  let rows: Row[] = stmt.raw().all(args).map((values) => {
    const r: Row = {};
    names.forEach((n, i) => { r[n] = Array.isArray(values) ? toCell(values[i]) : null; });
    return r;
  });
  let suppressed = 0;
  if (kAnon) {
    const kept = rows.filter((r) => (num(r.buyers) ?? 0) >= kAnon);
    suppressed = rows.length - kept.length;
    for (const r of kept) delete r.buyers;
    rows = kept;
  }
  if (dcols.length) rows = rows.filter((r) => dcols.every(([n]) => r[n] !== null && r[n] !== undefined));
  else if (rows.length && s.measures.every((m) => rows[0][m] === null)) rows = [];
  return { rows, suppressed };
}

function toCell(v: unknown): Cell {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return Number(v);
  return null;
}

/** Python's sort key (value is None, value): None sorts after every value, then values ascending. */
function compareCells(a: Cell | undefined, b: Cell | undefined): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return Number(an) - Number(bn);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function run({ conn, spec, buyerId, kAnon = 0 }: {
  conn: Sql; spec: unknown; buyerId: string | null; kAnon?: number;
}): QueryResult {
  const ds = dataset({ name: isRecord(spec) ? spec.dataset : undefined, conn });
  const { dimensions: DIMS, measures: MEAS } = ds.schema;
  const s = normalise({ spec, ds });
  s.dataset = ds.name;
  if (buyerId === null && !kAnon) {
    fail({ message: 'Usean asiakkaan kysely vaatii k-anonymiteetin.', fix: 'Kysy yhtenä asiakkaana.' });
  }
  if (kAnon && s.dimensions.some((d) => DIMS[d.field].identifying)) {
    fail({ message: 'Usean asiakkaan dataa ei voi ryhmitellä asiakkaan, ravintolan, agentin tai hyväksyjän mukaan.',
      fix: 'Ryhmittele tuoteryhmän, tuotteen, päivän, kanavan tai päätöksen mukaan.' });
  }
  const [a, b] = resolvePeriod({ period: s.period, ds });
  const first = select({ conn, s, buyerId, a, b, ds, kAnon });
  let rows = first.rows;
  let suppressed = first.suppressed;
  const timeDim = s.dimensions.find((d) => DIMS[d.field].type === 'time')?.field ?? null;
  const dimKeys = s.dimensions.map((d) => d.field);
  // sort: explicit, else time ascending, else first measure descending
  const order: SortSpec[] = s.sort.length ? s.sort
    : timeDim ? [{ by: timeDim, dir: 'asc' }] : dimKeys.length ? [{ by: s.measures[0], dir: 'desc' }] : [];
  for (const o of [...order].reverse()) {
    const by = o.by;
    if (rows.length && !has(rows[0], by)) fail({ message: `Lajittelu kentällä '${String(by ?? null)}' ei onnistu.`, fix: `Lajittele jollakin näistä: ${keys(rows[0])}.` });
    const sign = o.dir === 'desc' ? -1 : 1;
    if (typeof by === 'string') rows.sort((x, y) => sign * compareCells(x[by], y[by]));
  }
  if (s.limit && rows.length > s.limit) {
    const head = rows.slice(0, s.limit);
    const tail = rows.slice(s.limit);
    if (s.other && dimKeys.length === 1) {
      const other: Row = { [dimKeys[0]]: 'Other' };
      for (const m of s.measures) other[m] = ADDITIVE.has(m) ? tail.reduce((sum, r) => sum + (num(r[m]) ?? 0), 0) : null;
      head.push(other);
    }
    rows = head;
  }
  if (s.compare) {
    const span = daysBetween({ from: a, to: b }) + 1;
    const [pa, pb] = s.compare === 'previous_period'
      ? [addDays({ iso: a, days: -span }), addDays({ iso: a, days: -1 })]
      : [withYear({ iso: a, year: parseIso(a).year - 1 }), withYear({ iso: b, year: parseIso(b).year - 1 })];
    const prevRun = select({ conn, s, buyerId, a: pa, b: pb, ds, kAnon });
    suppressed += prevRun.suppressed;
    const keyOf = (r: Row) => JSON.stringify(dimKeys.map((k) => r[k]));
    const prev = new Map(prevRun.rows.map((r) => [keyOf(r), r]));
    for (const r of rows) {
      const p = prev.get(keyOf(r));
      for (const m of s.measures) {
        const pm = num(p?.[m]);
        const rm = num(r[m]);
        r[`${m}_prev`] = p?.[m] ?? null;
        r[`${m}_change_pct`] = pm && rm !== null ? round({ v: ((rm - pm) / pm) * 100, places: 1 }) : null;
      }
    }
  }
  calcs({ rows, calc: s.calc });
  if (timeDim && s.calc.some((c) => TIME_CALCS.has(c.type))) {
    const partial = partialLast({ rows, key: timeDim, s, b });
    const grain = s.dimensions[0].grain ?? 'month';
    for (const c of s.calc) {
      if (c.type === 'anomaly') anomaly({ rows, m: c.of, partial });
      else if (c.type === 'forecast') rows = forecast({ rows, key: timeDim, m: c.of, horizon: c.horizon ?? 3, grain, partial });
    }
  }
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && !Number.isInteger(v)) r[k] = round({ v, places: 2 });
  }
  const columns: Column[] = [
    ...dimKeys.map((k): Column => ({ name: k, label: DIMS[k].label, type: DIMS[k].type, role: 'dimension' })),
    ...s.measures.map((m): Column => ({ name: m, label: MEAS[m].label, unit: MEAS[m].unit, role: 'measure' })),
  ];
  const extra = Object.keys(rows[0] ?? {}).filter((k) => !dimKeys.includes(k) && !s.measures.includes(k));
  for (const k of extra) {
    const base = k.split('_')[0];
    const unit = k.endsWith('_pct') || k.endsWith('_share') ? '%' : has(MEAS, base) ? MEAS[base].unit : null;
    columns.push({ name: k, label: extraLabel({ k, meas: MEAS }), unit, role: 'derived' });
  }
  return {
    spec: s, columns, rows, period: { from: a, to: b }, dataset: ds.name,
    ...(kAnon ? { suppressed, kAnonymity: kAnon } : {}),
    shape: { dims: dimKeys, measures: s.measures, timeDim, n: rows.length, grain: s.dimensions.find((d) => d.grain)?.grain ?? null },
  };
}

export function extraLabel({ k, meas = SCHEMA.measures }: { k: string; meas?: Record<string, MeasureDef> }): string {
  const i = k.indexOf('_');
  const base = i < 0 ? k : k.slice(0, i);
  const kind = i < 0 ? '' : k.slice(i + 1);
  const m = has(meas, base) ? meas[base].label : base;
  const labels: Record<string, string> = {
    prev: `${m}, aiemmin`, change_pct: `${m}, muutos %`, share: `${m}, osuus %`, running_total: `${m}, kertymä`,
    rank: `${m}, sijoitus`, moving_avg: `${m}, liukuva keskiarvo`, lo: `${m}, alaraja-arvio`, hi: `${m}, yläraja-arvio`,
    z: `${m}, poikkeavuus (z)`, forecast: 'Ennuste', anomaly: 'Poikkeava', anchor: 'Viimeisin toteuma',
  };
  return labels[kind] ?? k;
}

// ---------------------------------------------------------------- forecast and anomaly (no ML: deterministic, explainable)

/** The last period is still running (e.g. the month to the 12th): leave it out of fits and flags. */
function partialLast({ rows, key, s, b }: { rows: Row[]; key: string; s: NormalSpec; b: string }): boolean {
  if (!rows.length) return false;
  const last = String(rows[rows.length - 1][key]);
  const grain = s.dimensions.find((d) => d.field === key)?.grain ?? null;
  const { year, month, day } = parseIso(b);
  if (grain === 'month') {
    const nxt = isoOf({ year: year + (month === 12 ? 1 : 0), month: (month % 12) + 1, day: 1 });
    return last === b.slice(0, 7) && daysBetween({ from: b, to: nxt }) > 1;
  }
  if (grain === 'quarter') return last === `${year}-Q${Math.floor((month + 2) / 3)}` && !(month % 3 === 0 && day >= 28);
  if (grain === 'week') return weekday(b) !== 6 && last === weekLabel(b);
  return false;
}

/** The label n periods later (n may be negative). */
export function shift({ label, grain, n }: { label: string; grain: string; n: number }): string {
  if (grain === 'month') {
    const [y, m] = label.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${String((((t % 12) + 12) % 12) + 1).padStart(2, '0')}`;
  }
  if (grain === 'quarter') {
    const [y, q] = label.split('-Q').map(Number);
    const t = y * 4 + q - 1 + n;
    return `${Math.floor(t / 4)}-Q${(((t % 4) + 4) % 4) + 1}`;
  }
  if (grain === 'week') {
    const [y, w] = label.split('-W').map(Number);
    return weekLabel(addDays({ iso: isoWeekMonday({ year: y, week: Math.max(1, w) }), days: n * 7 }));
  }
  return addDays({ iso: label, days: n });
}

const SEASON: Record<string, number> = { month: 12, quarter: 4, week: 52, day: 364 };

/** Seasonal-naive (same period last year) blended 50/50 with a linear trend over the last 6 full periods.
 * Bounds: +-1.28 sigma of the trend residuals (about an 80% band). Future rows carry is_forecast: true. */
function forecast({ rows, key, m, horizon, grain, partial }: {
  rows: Row[]; key: string; m: string; horizon: number; grain: string; partial: boolean;
}): Row[] {
  const hist = partial ? rows.slice(0, -1) : rows;
  const pts = hist.flatMap((r, i): Array<[number, number]> => {
    const v = num(r[m]);
    return v === null ? [] : [[i, v]];
  }).slice(-6);
  if (pts.length < 3) fail({ message: 'Ennuste tarvitsee vähintään 3 täyttä jaksoa historiaa.', fix: 'Laajenna ajanjaksoa tai käytä karkeampaa aikaväliä.' });
  const n = pts.length;
  const mx = pts.reduce((s, [i]) => s + i, 0) / n;
  const my = pts.reduce((s, [, v]) => s + v, 0) / n;
  const sxx = pts.reduce((s, [i]) => s + (i - mx) ** 2, 0) || 1;
  const slope = pts.reduce((s, [i, v]) => s + (i - mx) * (v - my), 0) / sxx;
  const trend = (i: number) => my + slope * (i - mx);
  const sigma = Math.sqrt(pts.reduce((s, [i, v]) => s + (v - trend(i)) ** 2, 0) / Math.max(1, n - 2));
  const byLabel = new Map(hist.map((r) => [String(r[key]), num(r[m])]));
  const lastI = hist.length - 1;
  const lastLabel = String(hist[lastI][key]);
  const out: Row[] = rows.map((r) => ({ ...r, is_forecast: false }));
  for (const r of out) {
    if (String(r[key]) === lastLabel) {
      r.forecast_anchor = true;
      r[`${m}_lo`] = r[m];
      r[`${m}_hi`] = r[m];
    }
  }
  const nonneg = pts.every(([, v]) => v >= 0);
  if (partial) out[out.length - 1].is_partial = true; // still running: shown, but not fitted and not forecast over
  for (let k = 1; k <= horizon + (partial ? 1 : 0); k++) {
    const label = shift({ label: lastLabel, grain, n: k });
    const t = trend(lastI + k);
    const seas = byLabel.get(shift({ label, grain, n: -SEASON[grain] }));
    let f = seas !== undefined && seas !== null ? 0.5 * seas + 0.5 * t : t;
    let lo = f - 1.28 * sigma;
    const hi = f + 1.28 * sigma;
    if (nonneg) {
      f = Math.max(0, f);
      lo = Math.max(0, lo);
    }
    if (partial && label === String(rows[rows.length - 1][key])) continue;
    out.push({ [key]: label, [m]: f, [`${m}_lo`]: lo, [`${m}_hi`]: hi, is_forecast: true,
      forecast_basis: seas !== undefined && seas !== null ? 'sama jakso viime vuonna + trendi' : 'kuuden viimeisen jakson trendi' });
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Robust z-score against the moving median of the previous 6 periods (MAD, floored at 5% of the median);
 * |z| > 3 is unusual. */
function anomaly({ rows, m, partial }: { rows: Row[]; m: string; partial: boolean }): void {
  const vals = rows.map((r) => num(r[m]));
  rows.forEach((r, i) => {
    r.is_anomaly = false;
    const win = vals.slice(Math.max(0, i - 6), i).filter((v): v is number => v !== null);
    const v = vals[i];
    if (win.length < 3 || v === null || (partial && i === rows.length - 1)) {
      r[`${m}_z`] = null;
      return;
    }
    const med = median(win);
    // floor at 5% of the median: ordinary +-15% swings in a kitchen's month are not "unusual"
    const mad = Math.max(median(win.map((x) => Math.abs(x - med))), 0.05 * Math.abs(med));
    if (mad === 0) {
      r[`${m}_z`] = null;
      return;
    }
    const z = (0.6745 * (v - med)) / mad;
    r[`${m}_z`] = round({ v: z, places: 2 });
    r.is_anomaly = Math.abs(z) > 3;
  });
}

function calcs({ rows, calc }: { rows: Row[]; calc: CalcSpec[] }): void {
  for (const c of calc) {
    const { of: m, type: t } = c;
    const vals = rows.map((r) => num(r[m]) || 0);
    if (t === 'share') {
      const tot = vals.reduce((s, v) => s + v, 0) || 1;
      rows.forEach((r, i) => { r[`${m}_share`] = (vals[i] / tot) * 100; });
    } else if (t === 'running_total') {
      let total = 0;
      rows.forEach((r, i) => { total += vals[i]; r[`${m}_running_total`] = total; });
    } else if (t === 'rank') {
      const order = rows.map((_, i) => i).sort((x, y) => vals[y] - vals[x]);
      order.forEach((i, rank) => { rows[i][`${m}_rank`] = rank + 1; });
    } else if (t === 'change_pct') {
      rows.forEach((r, i) => { r[`${m}_change_pct`] = i === 0 || !vals[i - 1] ? null : ((vals[i] - vals[i - 1]) / vals[i - 1]) * 100; });
    } else if (t === 'moving_avg') {
      const w = Math.max(2, Math.trunc(Number(c.window ?? 3)) || 2);
      rows.forEach((r, i) => {
        const win = vals.slice(Math.max(0, i - w + 1), i + 1);
        r[`${m}_moving_avg`] = win.reduce((s, v) => s + v, 0) / win.length;
      });
    }
  }
}
