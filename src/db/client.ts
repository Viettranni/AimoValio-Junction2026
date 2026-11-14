import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const DDL = `
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS drafts_conversation ON drafts (conversation_id);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, event_name TEXT NOT NULL, event_type TEXT NOT NULL,
  event_date TEXT NOT NULL, delivery_date TEXT NOT NULL, guests INTEGER NOT NULL,
  total REAL NOT NULL, total_with_tax REAL NOT NULL, receipt_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL, check_in_done INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS order_lines (
  id TEXT NOT NULL, order_id TEXT NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL,
  category TEXT NOT NULL, packs INTEGER NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL,
  unit_price REAL NOT NULL, PRIMARY KEY (order_id, id));
CREATE TABLE IF NOT EXISTS leftovers (
  order_id TEXT NOT NULL, line_id TEXT NOT NULL, product_id TEXT NOT NULL, category TEXT NOT NULL,
  event_type TEXT NOT NULL, event_name TEXT NOT NULL, event_date TEXT NOT NULL,
  ordered_qty REAL NOT NULL, leftover_qty REAL NOT NULL, unit TEXT NOT NULL, recorded_at TEXT NOT NULL,
  PRIMARY KEY (order_id, line_id));
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, order_id TEXT, at TEXT NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, summary TEXT NOT NULL, data_json TEXT);
CREATE INDEX IF NOT EXISTS audit_conversation ON audit_log (conversation_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** Agent gateway tables (offers, approvals, MCP chat transcripts, simulated deliveries). Also re-run lazily by src/gateway/store.ts. */
export const GATEWAY_DDL = `
CREATE TABLE IF NOT EXISTS gateway_offers (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL,
  json TEXT NOT NULL, created_at TEXT NOT NULL, valid_until TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS gateway_offers_customer ON gateway_offers (customer_id);
CREATE TABLE IF NOT EXISTS gateway_approvals (
  id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, customer_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  status TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT);
CREATE INDEX IF NOT EXISTS gateway_approvals_status ON gateway_approvals (status);
CREATE TABLE IF NOT EXISTS gateway_chats (
  conversation_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  messages_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (
  order_id TEXT NOT NULL, line_id TEXT NOT NULL, ordered_qty REAL NOT NULL, delivered_qty REAL NOT NULL,
  unit TEXT NOT NULL, reason TEXT, delivered_at TEXT NOT NULL, PRIMARY KEY (order_id, line_id));
`;

export function createDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  // Rollback journal (not WAL): the seed CLI and the dev server may touch the file at the same time;
  // WAL files can get detached from a running server when another process resets the DB.
  sqlite.pragma('journal_mode = DELETE');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec(DDL);
  sqlite.exec(GATEWAY_DDL);
  return drizzle(sqlite, { schema });
}

// On globalThis so Next.js dev-mode module reloads reuse the same connection.
const globalWithDbs = globalThis as { __aimoDbs?: Map<string, Db> };
const instances = (globalWithDbs.__aimoDbs ??= new Map<string, Db>());

/** Process singleton per path (default data/aimo.sqlite, override with AIMO_DB_PATH). */
export function getDb(): Db {
  const path = process.env.AIMO_DB_PATH ?? resolve(process.cwd(), 'data/aimo.sqlite');
  let db = instances.get(path);
  if (!db) {
    db = createDb(path);
    instances.set(path, db);
  }
  return db;
}
