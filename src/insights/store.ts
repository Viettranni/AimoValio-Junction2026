// Port of valioaimo gateway/analytics/store.py: the `line` fact table in an in-memory SQLite (better-sqlite3, the
// engine this project already uses), so the query compiler's SQL runs unchanged.
// Demo mode reads the exported year (data/insights/demo-lines.json); live mode maps this project's own orders.
import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';
import { demoLines } from './data';
import { LINE_COLUMNS, type LineRow } from './schema';

export type Sql = Database.Database;
export type Source = 'demo' | 'live';

/** Which order data the insights read, per request (Python: the SOURCE context variable). */
const sourceStore = new AsyncLocalStorage<Source>();

export function currentSource(): Source {
  return sourceStore.getStore() ?? 'demo';
}

/** Runs fn with the insight data source set ("live", anything else is demo). */
export function using<T>({ source, fn }: { source: string | null | undefined; fn: () => T }): T {
  return sourceStore.run(source === 'live' ? 'live' : 'demo', fn);
}

/** The demo clock runs in Nov 2026; deliveries land within weeks. Used when there are no live orders yet. */
export const LIVE_PERIOD: [string, string] = ['2026-11-01', '2026-12-31'];

/** An in-memory SQLite with the `line` fact table (read-only use). */
export function lineDb(rows: LineRow[]): Sql {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE line (${LINE_COLUMNS.join(', ')})`);
  const insert = db.prepare(`INSERT INTO line VALUES (${LINE_COLUMNS.map(() => '?').join(', ')})`);
  db.transaction(() => {
    for (const r of rows) insert.run(LINE_COLUMNS.map((c) => r[c]));
  })();
  for (const c of ['buyer_id', 'site_id', 'month', 'date', 'event_id']) db.exec(`CREATE INDEX ix_${c} ON line(${c})`);
  return db;
}

let demo: Sql | null = null;

/** The demo year, loaded once per process. */
export function demoDb(): Sql {
  return (demo ??= lineDb(demoLines()));
}

/** The connection for the current source: the demo year, or live rows rebuilt per question (small, always current). */
export function connFor(liveRows: () => LineRow[]): Sql {
  return currentSource() === 'live' ? lineDb(liveRows()) : demoDb();
}
