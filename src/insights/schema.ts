// The analytics contract, ported unchanged from valioaimo gateway/analytics/store.py (line) and datasets.py
// (agent_activity, demand): field names, labels, units and SQL expressions are the source's.
// Columns a source cannot fill are null; SUM/AVG/COUNT skip nulls, so every measure handles them.

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface DimensionDef {
  label: string;
  type: 'time' | 'category';
  sql: string;
  /** Names a customer, kitchen, agent or approver: never grouped across buyers. */
  identifying?: boolean;
}

export interface MeasureDef {
  label: string;
  unit: string;
  sql: string;
}

export interface DatasetSchema {
  dimensions: Record<string, DimensionDef>;
  measures: Record<string, MeasureDef>;
}

/** One row per ordered product line. */
export interface LineRow {
  order_id: string;
  order_type: 'event' | 'replenishment';
  buyer_id: string;
  site_id: string | null;
  site_name: string | null;
  date: string;
  month: string;
  weekday: string;
  event_id: string | null;
  event_type: string | null;
  event_name: string | null;
  guests: number | null;
  product: string;
  product_key: string;
  category: string | null;
  brand: string | null;
  temp: string | null;
  qty: number;
  unit: string;
  unit_price: number | null;
  value_eur: number;
  kg: number | null;
  co2e_kg: number | null;
  on_time: number | null;
  used_pct: number | null;
  waste_eur: number | null;
  label: 'right_sized' | 'over_ordered' | null;
}

export const LINE_COLUMNS = [
  'order_id', 'order_type', 'buyer_id', 'site_id', 'site_name', 'date', 'month', 'weekday', 'event_id',
  'event_type', 'event_name', 'guests', 'product', 'product_key', 'category', 'brand', 'temp', 'qty', 'unit',
  'unit_price', 'value_eur', 'kg', 'co2e_kg', 'on_time', 'used_pct', 'waste_eur', 'label',
] as const satisfies ReadonlyArray<keyof LineRow>;

/** One row per playbook session, and one per seller-suggestion decision. */
export interface ActivityRow {
  kind: 'session' | 'suggestion';
  buyer: string;
  site: string | null;
  agent: string;
  channel: string;
  date: string;
  decision: string | null;
  top_rule: string | null;
  requotes: number;
  c409: number;
  c422: number;
  time_to_order_s: number | null;
  approval_wait_s: number | null;
  approver: string | null;
  approved: number | null;
  order_total: number | null;
  live_price_share: number | null;
  suggestion: string | null;
}

export const ACTIVITY_COLUMNS = [
  'kind', 'buyer', 'site', 'agent', 'channel', 'date', 'decision', 'top_rule', 'requotes', 'c409', 'c422',
  'time_to_order_s', 'approval_wait_s', 'approver', 'approved', 'order_total', 'live_price_share', 'suggestion',
] as const satisfies ReadonlyArray<keyof ActivityRow>;

/** One row per planned or ordered line, plus one per need that could not be met (and why). */
export interface DemandRow {
  buyer: string;
  site: string | null;
  date: string | null;
  category: string;
  product: string;
  qty: number;
  value_eur: number;
  source: 'planned' | 'ordered' | 'unmet';
  unmet_reason: string | null;
}

export const DEMAND_COLUMNS = [
  'buyer', 'site', 'date', 'category', 'product', 'qty', 'value_eur', 'source', 'unmet_reason',
] as const satisfies ReadonlyArray<keyof DemandRow>;

export const START = '2025-12-01';
export const END = '2026-11-12';

export const CATEGORY_LABEL: Record<string, string> = {
  dairy: 'Dairy', plant_based: 'Plant-based', produce: 'Fruit & veg', meat: 'Meat',
  fish: 'Fish', bakery: 'Bakery', dry_goods: 'Dry goods',
};
export const EVENT_LABEL: Record<string, string> = {
  gala: 'Gala', christmas_party: 'Christmas party', wedding: 'Wedding', conference: 'Conference',
  birthday: 'Birthday', lunch: 'Lunch', breakfast: 'Breakfast',
};

/** Queryable fields of `line`. The query compiler only accepts these names (no raw SQL from callers). */
export const SCHEMA = {
  dimensions: {
    date: { label: 'Date', type: 'time', sql: 'date' },
    weekday: { label: 'Weekday', type: 'category', sql: 'weekday' },
    site: { label: 'Kitchen', type: 'category', sql: 'site_name' },
    category: { label: 'Category', type: 'category', sql: 'category' },
    product: { label: 'Product', type: 'category', sql: 'product' },
    brand: { label: 'Brand', type: 'category', sql: 'brand' },
    event_type: { label: 'Event type', type: 'category', sql: 'event_type' },
    event: { label: 'Event', type: 'category', sql: 'event_name' },
    order_type: { label: 'Order type', type: 'category', sql: 'order_type' },
    outcome: { label: 'How it went', type: 'category', sql: 'label' },
    temperature: { label: 'Storage', type: 'category', sql: 'temp' },
  },
  measures: {
    spend: { label: 'Spend', unit: 'EUR', sql: 'SUM(value_eur)' },
    waste: { label: 'Food left over', unit: 'EUR', sql: 'SUM(waste_eur)' },
    waste_pct: { label: 'Left over (share)', unit: '%', sql: '100.0*SUM(waste_eur)/NULLIF(SUM(value_eur),0)' },
    co2e: { label: 'Carbon footprint', unit: 'kg CO2e', sql: 'SUM(co2e_kg)' },
    kg: { label: 'Weight', unit: 'kg', sql: 'SUM(kg)' },
    quantity: { label: 'Quantity', unit: 'units', sql: 'SUM(qty)' },
    orders: { label: 'Orders', unit: 'count', sql: 'COUNT(DISTINCT order_id)' },
    lines: { label: 'Order lines', unit: 'count', sql: 'COUNT(*)' },
    events: { label: 'Events', unit: 'count', sql: 'COUNT(DISTINCT event_id)' },
    guests: { label: 'Guests', unit: 'count', sql: 'SUM(DISTINCT CASE WHEN event_id IS NOT NULL THEN guests END)' },
    on_time_pct: { label: 'On time', unit: '%', sql: '100.0*AVG(on_time)' },
    right_sized_pct: { label: 'Just right', unit: '%', sql: "100.0*AVG(label='right_sized')" },
    avg_price: { label: 'Average price', unit: 'EUR/unit', sql: 'SUM(value_eur)/NULLIF(SUM(qty),0)' },
  },
} satisfies DatasetSchema;

export const TIME_GRAINS = ['day', 'week', 'month', 'quarter'] as const;

export const ACTIVITY_SCHEMA = {
  dimensions: {
    date: { label: 'Date', type: 'time', sql: 'date' },
    buyer: { label: 'Customer', type: 'category', sql: 'buyer', identifying: true },
    site: { label: 'Kitchen', type: 'category', sql: 'site', identifying: true },
    agent: { label: 'Agent', type: 'category', sql: 'agent', identifying: true },
    channel: { label: 'Channel', type: 'category', sql: 'channel' },
    decision: { label: 'Gateway decision', type: 'category', sql: 'decision' },
    top_rule: { label: 'Main rule', type: 'category', sql: 'top_rule' },
    approver: { label: 'Approver', type: 'category', sql: 'approver', identifying: true },
    kind: { label: 'Row kind', type: 'category', sql: 'kind' },
  },
  measures: {
    sessions: { label: 'Sessions', unit: 'count', sql: "SUM(kind='session')" },
    autonomous_rate: { label: 'Ordered without a human', unit: '%',
      sql: "100.0*AVG(CASE WHEN kind='session' AND decision IS NOT NULL THEN decision IN ('auto','tell_me') END)" },
    approval_rate: { label: 'Needed an OK', unit: '%',
      sql: "100.0*AVG(CASE WHEN kind='session' AND decision IS NOT NULL THEN decision='needs_ok' END)" },
    blocked_rate: { label: 'Could not order', unit: '%',
      sql: "100.0*AVG(CASE WHEN kind='session' AND decision IS NOT NULL THEN decision='blocked' END)" },
    requote_rate: { label: 'Re-quoted', unit: '%', sql: "100.0*AVG(CASE WHEN kind='session' THEN requotes>0 END)" },
    p50_time_to_order: { label: 'Time to order, median', unit: 's', sql: 'p50(time_to_order_s)' },
    p90_approval_wait: { label: 'Approval wait, 90th percentile', unit: 's', sql: 'p90(approval_wait_s)' },
    guidance_errors: { label: 'Refused calls (409 + 422)', unit: 'count', sql: 'SUM(c409 + c422)' },
    orders: { label: 'Orders', unit: 'count', sql: 'SUM(order_total IS NOT NULL)' },
    order_value: { label: 'Order value', unit: 'EUR', sql: 'SUM(order_total)' },
    live_price_share: { label: 'Priced live', unit: '%', sql: '100.0*AVG(live_price_share)' },
    suggestion_acceptance_rate: { label: 'Seller suggestions accepted', unit: '%',
      sql: "100.0*AVG(CASE WHEN kind='suggestion' THEN suggestion='accepted' END)" },
  },
} satisfies DatasetSchema;

export const DEMAND_SCHEMA = {
  dimensions: {
    date: { label: 'Need-by date', type: 'time', sql: 'date' },
    category: { label: 'Category', type: 'category', sql: 'category' },
    product: { label: 'Product', type: 'category', sql: 'product' },
    source: { label: 'Source', type: 'category', sql: 'source' },
    unmet_reason: { label: 'Why not met', type: 'category', sql: 'unmet_reason' },
    buyer: { label: 'Customer', type: 'category', sql: 'buyer', identifying: true },
    site: { label: 'Kitchen', type: 'category', sql: 'site', identifying: true },
  },
  measures: {
    planned_qty: { label: 'Planned', unit: 'units', sql: "SUM(CASE WHEN source IN ('planned','ordered') THEN qty END)" },
    ordered_qty: { label: 'Ordered', unit: 'units', sql: "SUM(CASE WHEN source='ordered' THEN qty END)" },
    unmet_qty: { label: 'Not met', unit: 'units', sql: "SUM(CASE WHEN source='unmet' THEN qty END)" },
    fill_rate: { label: 'Fill rate', unit: '%',
      sql: "100.0*SUM(CASE WHEN source='ordered' THEN qty ELSE 0 END)/NULLIF(SUM(qty),0)" },
    lost_value_eur: { label: 'Lost sales', unit: 'EUR', sql: "SUM(CASE WHEN source='unmet' THEN value_eur END)" },
    value_eur: { label: 'Value', unit: 'EUR', sql: 'SUM(value_eur)' },
    lines: { label: 'Lines', unit: 'count', sql: 'COUNT(*)' },
  },
} satisfies DatasetSchema;

export const UNMET_REASONS = ['not_deliverable', 'not_by_date', 'partial', 'blocked_allergen', 'over_limit_rejected'];

/** Labels of every dimension and measure across datasets (charts and explanations look names up here). */
export function allFields(): DatasetSchema {
  const out: DatasetSchema = { dimensions: {}, measures: {} };
  const all: DatasetSchema[] = [ACTIVITY_SCHEMA, DEMAND_SCHEMA, SCHEMA]; // orders last: its labels win on shared names
  for (const sch of all) {
    Object.assign(out.dimensions, sch.dimensions);
    Object.assign(out.measures, sch.measures);
  }
  return out;
}
