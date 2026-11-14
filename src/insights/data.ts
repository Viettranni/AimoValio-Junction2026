// The ported demo data in data/insights/ (copied from valioaimo gateway/data, demo rows exported once from Python).
// Every file is validated with zod on first read; nothing here is re-generated.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ActivityRow, DemandRow, LineRow } from './schema';
import { LINE_COLUMNS } from './schema';

const DIR = path.join(process.cwd(), 'data', 'insights');

function readJson<T>({ file, schema }: { file: string; schema: z.ZodType<T> }): T {
  return schema.parse(JSON.parse(readFileSync(path.join(DIR, file), 'utf8')));
}

function once<T>(load: () => T): () => T {
  let value: { v: T } | null = null;
  return () => (value ??= { v: load() }).v;
}

// ── buyers.json: organisations, kitchens (sites), approvers, mandate ──

const person = z.object({ id: z.string(), name: z.string(), role: z.string() });
const site = z.object({
  id: z.string(), name: z.string(), type: z.string(), address: z.string(), scale: z.number(), lead: z.string(),
});
const buyer = z.object({
  id: z.string(),
  name: z.string(),
  segment: z.string(),
  site: z.object({ id: z.string(), name: z.string() }),
  creditLimitEUR: z.number(),
  openInvoicesEUR: z.number(),
  admin: person,
  approvers: z.array(person),
  mandate: z.object({
    limits: z.object({ perOrderEUR: z.number(), perMonthEUR: z.number(), perEventEUR: z.number().nullish() }),
    hardExclusions: z.object({ allergens: z.array(z.string()) }),
  }),
  sites: z.array(site),
});
export type Buyer = z.infer<typeof buyer>;
export type Site = z.infer<typeof site>;

export const buyers = once(() => readJson({ file: 'buyers.json', schema: z.object({ buyers: z.array(buyer) }) }).buyers);

// ── history.json: the buyer's memory (favourites, past orders with outcome labels) ──

const memory = z.object({
  favourites: z.array(z.object({ key: z.string(), pinned: z.boolean().optional() })),
  orders: z.array(z.object({
    date: z.string(),
    eventType: z.string().optional(),
    lines: z.array(z.object({
      need: z.string(), key: z.string(), usage: z.number().optional(), label: z.string().optional(),
    })),
  })),
});
export type Memory = z.infer<typeof memory>;

const memories = once(() => readJson({ file: 'history.json', schema: z.object({ buyers: z.record(z.string(), memory) }) }).buyers);

/** recall.memory: the buyer's seeded memory, or an empty one. */
export function memoryOf(buyerId: string): Memory {
  return memories()[buyerId] ?? { favourites: [], orders: [] };
}

// ── catalog.json: the curated demo assortment (names by key) ──

const products = once(() => new Map(readJson({
  file: 'catalog.json',
  schema: z.object({ products: z.array(z.object({ key: z.string(), name: z.string() })) }),
}).products.map((p) => [p.key, p])));

export function productName(key: string): string {
  return products().get(key)?.name ?? key;
}

// ── demo-lines.json: the generated year of order history (store.py generate(), seed 2026) ──

const str = z.string();
const strN = z.string().nullable();
const num = z.number();
const numN = z.number().nullable();
const lineTuple = z.tuple([
  str, z.enum(['event', 'replenishment']), str, strN, strN, str, str, str, strN,
  strN, strN, numN, str, str, strN, strN, strN, num, str,
  numN, num, numN, numN, numN, numN, numN, z.enum(['right_sized', 'over_ordered']).nullable(),
]);

export const demoLines = once((): LineRow[] => {
  const file = readJson({ file: 'demo-lines.json', schema: z.object({ columns: z.array(z.string()), rows: z.array(lineTuple) }) });
  if (file.columns.join() !== LINE_COLUMNS.join()) throw new Error('data/insights/demo-lines.json columns do not match the line schema');
  return file.rows.map((r) => ({
    order_id: r[0], order_type: r[1], buyer_id: r[2], site_id: r[3], site_name: r[4], date: r[5], month: r[6],
    weekday: r[7], event_id: r[8], event_type: r[9], event_name: r[10], guests: r[11], product: r[12],
    product_key: r[13], category: r[14], brand: r[15], temp: r[16], qty: r[17], unit: r[18], unit_price: r[19],
    value_eur: r[20], kg: r[21], co2e_kg: r[22], on_time: r[23], used_pct: r[24], waste_eur: r[25], label: r[26],
  }));
});

// ── demo-datasets.json: agent_activity and demand rows after the source app's demo seed ──

const activityRow = z.object({
  kind: z.enum(['session', 'suggestion']), buyer: str, site: strN, agent: str, channel: str, date: str,
  decision: strN, top_rule: strN, requotes: num, c409: num, c422: num, time_to_order_s: numN, approval_wait_s: numN,
  approver: strN, approved: numN, order_total: numN, live_price_share: numN, suggestion: strN,
}) satisfies z.ZodType<ActivityRow>;
const demandRow = z.object({
  buyer: str, site: strN, date: strN, category: str, product: str, qty: num, value_eur: num,
  source: z.enum(['planned', 'ordered', 'unmet']), unmet_reason: strN,
}) satisfies z.ZodType<DemandRow>;

export const demoDatasets = once(() => readJson({
  file: 'demo-datasets.json',
  schema: z.object({ agent_activity: z.array(activityRow), demand: z.array(demandRow) }),
}));
