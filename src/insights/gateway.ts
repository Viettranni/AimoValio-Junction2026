// Composition root for insights (the Python Gateway's role for analytics): the buyer directory, the insight engine,
// the analyst and an in-memory audit trail. One per process; tests build their own with fakes.
import type { LanguageModel } from 'ai';
import { Analyst } from './analyst';
import { buyers as demoBuyers, type Buyer } from './data';
import { InsightEngine, type AuditEvent, type DirectoryBuyer, type InsightsHost } from './engine';
import type { LineRow } from './schema';
import { connFor } from './store';
import type { ViewsHost } from './views';

export interface InsightsDeps {
  /** This project's orders as `line` rows (live mode). */
  liveRows: () => LineRow[];
  /** This project's own customers: the buyers live mode shows. */
  liveCustomers: () => Array<{ id: string; name: string }>;
  now: () => Date;
  /** Whether live Valio Aimo prices are configured. */
  liveApi: boolean;
  /** null forces the rule engine; omitted uses Claude when a key is set. */
  model?: LanguageModel | null;
}

export class InsightsGateway implements InsightsHost, ViewsHost {
  readonly audit: AuditEvent[] = [];
  readonly insights: InsightEngine;
  readonly analyst: Analyst;

  constructor(private readonly deps: InsightsDeps) {
    this.insights = new InsightEngine(this);
    this.analyst = new Analyst({ engine: this.insights, buyers: () => this.buyers(), model: deps.model });
  }

  liveRows = () => this.deps.liveRows();
  now = () => this.deps.now();
  get liveApi() { return this.deps.liveApi; }

  /** The demo organisations (buyers.json) and this project's customers (no kitchens of their own). */
  buyers = (): Record<string, DirectoryBuyer> => {
    const out: Record<string, DirectoryBuyer> = {};
    for (const c of this.deps.liveCustomers()) out[c.id] = { id: c.id, name: c.name, sites: [] };
    for (const b of demoBuyers()) out[b.id] = { id: b.id, name: b.name, sites: b.sites.map((s) => ({ id: s.id, name: s.name })) };
    return out;
  };

  buyer = (buyerId: string): DirectoryBuyer | undefined => this.buyers()[buyerId];

  /** A demo organisation with its kitchens, mandate and people. */
  demoBuyer(buyerId: string): Buyer | undefined {
    return demoBuyers().find((b) => b.id === buyerId);
  }

  conn = () => connFor(this.deps.liveRows);
}
