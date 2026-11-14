// Port of valioaimo gateway/analytics/datasets.py: the agent_activity and demand tables, queried through the same
// compiler as the order history (spec.dataset). In the source they are built live from the gateway's sessions,
// audit and seller feedback; this project has no such records, so demo mode reads the rows exported once from the
// source's demo and live mode has no rows.
import Database from 'better-sqlite3';
import { demoDatasets } from './data';
import { roundHalfEven } from './math';
import {
  ACTIVITY_COLUMNS, ACTIVITY_SCHEMA, DEMAND_COLUMNS, DEMAND_SCHEMA, type ActivityRow, type DatasetSchema, type DemandRow,
} from './schema';
import { currentSource, type Sql } from './store';

export interface DatasetDef {
  table: string;
  schema: DatasetSchema;
  period: [string, string];
  buyerCol: string;
}

const WIDE: [string, string] = ['2026-01-01', '2027-12-31'];

export const DATASETS: Record<string, DatasetDef> = {
  agent_activity: { table: 'activity', schema: ACTIVITY_SCHEMA, period: WIDE, buyerCol: 'buyer' },
  demand: { table: 'demand', schema: DEMAND_SCHEMA, period: WIDE, buyerCol: 'buyer' },
};

/** Python's _pctl: the q-th value of the sorted non-null inputs (nearest rank, rounded half to even). */
function percentile(q: number) {
  return {
    start: (): number[] => [],
    step: (xs: number[], v: unknown) => {
      if (typeof v === 'number') xs.push(v);
      return xs;
    },
    result: (xs: number[]) => {
      if (!xs.length) return null;
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, roundHalfEven(q * (sorted.length - 1)))];
    },
  };
}

function table<R extends ActivityRow | DemandRow>({ db, name, columns, rows }: {
  db: Sql; name: string; columns: ReadonlyArray<keyof R>; rows: R[];
}) {
  db.exec(`CREATE TABLE ${name} (${columns.join(', ')})`);
  const insert = db.prepare(`INSERT INTO ${name} VALUES (${columns.map(() => '?').join(', ')})`);
  for (const r of rows) insert.run(columns.map((c) => r[c]));
}

/** A fresh in-memory SQLite with both tables (they are small; rebuilt per question). */
export function connect(): Sql {
  const db = new Database(':memory:');
  db.aggregate('p50', percentile(0.5));
  db.aggregate('p90', percentile(0.9));
  const demo = currentSource() === 'demo' ? demoDatasets() : { agent_activity: [], demand: [] };
  table<ActivityRow>({ db, name: 'activity', columns: ACTIVITY_COLUMNS, rows: demo.agent_activity });
  table<DemandRow>({ db, name: 'demand', columns: DEMAND_COLUMNS, rows: demo.demand });
  return db;
}
