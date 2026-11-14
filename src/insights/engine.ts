// Port of valioaimo gateway/analytics/engine.py: the state machine for the insight playbook.
// Same contract as the order playbook: StepNotAllowed (409) with next_allowed_tools, GuardFailed (422) with a
// `fix`, an audit event per call with the playbook version.
import { randomBytes } from 'node:crypto';
import * as charts from './charts';
import { connect } from './datasets';
import { GuardFailed, NotFound, StepNotAllowed } from './errors';
import * as explain from './explain';
import { round } from './math';
import { INSIGHT_PLAYBOOK, TOOL_INPUTS, TOOL_STEP } from './playbook';
import * as query from './query';
import { isRecord, type QueryResult } from './query';
import { SCHEMA, type Cell, type LineRow } from './schema';
import { connFor, type Sql } from './store';
import { validateInput } from './validate';

export interface DirectoryBuyer {
  id: string;
  name: string;
  sites: Array<{ id: string; name: string }>;
}

export interface AuditEvent {
  traceId: string;
  actor: string;
  action: string;
  buyerId: string;
  inputs: Record<string, unknown>;
  refs: Record<string, unknown>;
  reason: string;
  at: string;
}

/** What the engine needs from its host (the Python Gateway). */
export interface InsightsHost {
  /** Every buyer an analysis may be opened for, by id. */
  buyers: () => Record<string, DirectoryBuyer>;
  liveRows: () => LineRow[];
  now: () => Date;
  audit: AuditEvent[];
}

export interface AnalysisSession {
  sessionId: string;
  buyerId: string;
  siteId: string | null;
  step: string;
  calls: number;
  result: QueryResult | null;
  chart?: charts.ChartSpec;
  agent: string;
  createdAt: string;
}

export interface ToolCallResult {
  tool: string;
  step: string;
  output: Record<string, unknown>;
  next_allowed_tools: string[];
  sessionId: string;
}

interface Contribution { value: Cell; a: number; b: number; contribution: number; sharePct: number | null }

/** In-memory state stays bounded: the oldest analyses and audit events are dropped first. */
const MAX_SESSIONS = 1000;
const MAX_AUDIT = 5000;

const newId = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;

/** The public playbook (GET /api/insights/playbook). */
export function publicPlaybook() {
  return INSIGHT_PLAYBOOK;
}

export class InsightEngine {
  readonly sessions = new Map<string, AnalysisSession>();

  constructor(private readonly host: InsightsHost) {}

  /** The orders connection for the current source (demo year, or this project's orders). */
  get conn(): Sql {
    return connFor(this.host.liveRows);
  }

  allowed(s: AnalysisSession | null): string[] {
    if (s === null) return ['start_analysis'];
    if (s.step === 'start') return ['describe_data'];
    const out = ['describe_data', 'get_values', 'run_query', 'explain_change'];
    if (s.result !== null) out.push('suggest_chart', 'build_chart', 'explain_result');
    return out;
  }

  call({ sid, tool, args = {} }: { sid: string | null; tool: string; args?: unknown }): ToolCallResult {
    const s = sid ? this.sessions.get(sid) ?? null : null;
    if (sid && !s) throw new NotFound(`analyysisessiota ${sid} ei löydy`);
    if (!(tool in TOOL_STEP)) {
      throw new NotFound(`tuntematon työkalu ${tool}`, { known: Object.keys(TOOL_STEP).sort(), next_allowed_tools: this.allowed(s),
        fix: { tools: 'GET /api/insights/playbook listaa jokaisen työkalun ja sen syötteen' } });
    }
    const allowed = this.allowed(s);
    if (!allowed.includes(tool)) {
      throw new StepNotAllowed(`Työkalu '${tool}' ei ole vielä käytettävissä.`, { step: s?.step ?? null, next_allowed_tools: allowed,
        insightPlaybookVersion: INSIGHT_PLAYBOOK.version });
    }
    validateInput({ schema: TOOL_INPUTS[tool], tool, args });
    const a = isRecord(args) ? args : {};
    const t0 = performance.now();
    const out = this.dispatch({ s, tool, a });
    const session = tool === 'start_analysis' ? this.sessions.get(String(out.sessionId)) : s;
    if (!session) throw new NotFound(`analyysisessiota ${String(out.sessionId)} ei löydy`);
    session.step = TOOL_STEP[tool];
    session.calls += 1;
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    this.host.audit.push({
      traceId: session.sessionId, actor: `agent:${session.agent}`, action: `insight.${tool}`, buyerId: session.buyerId,
      inputs: Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'buyerId')),
      refs: { step: session.step, insightPlaybookVersion: INSIGHT_PLAYBOOK.version, ms },
      reason: typeof out.caption === 'string' ? out.caption : '', at: this.host.now().toISOString(),
    });
    if (this.host.audit.length > MAX_AUDIT) this.host.audit.splice(0, this.host.audit.length - MAX_AUDIT);
    return { tool, step: session.step, output: out, next_allowed_tools: this.allowed(session), sessionId: session.sessionId };
  }

  private dispatch({ s, tool, a }: { s: AnalysisSession | null; tool: string; a: Record<string, unknown> }): Record<string, unknown> {
    if (tool === 'start_analysis') return this.startAnalysis(a);
    if (!s) throw new NotFound('analyysisessiota ei löydy');
    switch (tool) {
      case 'describe_data': return this.describeData({ s, a });
      case 'get_values': return this.getValues({ s, a });
      case 'run_query': return this.runQuery({ s, a });
      case 'suggest_chart': return { suggestions: charts.suggest(this.result(s)) };
      case 'build_chart': {
        const chart = charts.build({ result: this.result(s), intent: a });
        s.chart = chart;
        return { chart };
      }
      case 'explain_change': return this.explainChange({ s, a });
      case 'explain_result': return explain.run(this.result(s));
      default: throw new NotFound(`tuntematon työkalu ${tool}`);
    }
  }

  private result(s: AnalysisSession): QueryResult {
    if (!s.result) throw new StepNotAllowed('Aja ensin kysely.', { next_allowed_tools: this.allowed(s) });
    return s.result;
  }

  // ---------------------------------------------------------------- tools
  private startAnalysis(a: Record<string, unknown>): Record<string, unknown> {
    const buyers = this.host.buyers();
    const bid = a.buyerId;
    const buyer = typeof bid === 'string' ? buyers[bid] : undefined;
    if (!buyer) throw new GuardFailed(`Tuntematon asiakas ${String(bid ?? null)}.`, { fix: `Käytä jotakin näistä: ${Object.keys(buyers).join(', ')}.` });
    const site = typeof a.siteId === 'string' && a.siteId ? a.siteId : null;
    if (site && !buyer.sites.some((x) => x.id === site)) {
      throw new GuardFailed(`Ravintola ${site} ei kuulu asiakkaalle ${buyer.id}.`, { fix: `Käytä jotakin näistä: ${buyer.sites.map((x) => x.id).join(', ')}.` });
    }
    const sid = newId('ANA');
    this.sessions.set(sid, { sessionId: sid, buyerId: buyer.id, siteId: site, step: 'start', calls: 0, result: null,
      agent: typeof a.agent === 'string' ? a.agent : 'analyst', createdAt: this.host.now().toISOString() });
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    return { sessionId: sid, buyerId: buyer.id, siteId: site, insightPlaybookVersion: INSIGHT_PLAYBOOK.version };
  }

  private siteName(s: AnalysisSession): string | null {
    if (!s.siteId) return null;
    return this.host.buyers()[s.buyerId]?.sites.find((x) => x.id === s.siteId)?.name ?? null;
  }

  private connForDataset(name: string): Sql {
    return name === 'orders' ? this.conn : connect(); // demo history, or this project's own orders (store source)
  }

  private describeData({ s, a }: { s: AnalysisSession; a: Record<string, unknown> }): Record<string, unknown> {
    const ds = query.dataset({ name: a.dataset, conn: a.dataset === undefined || a.dataset === 'orders' ? this.conn : undefined });
    const b = this.host.buyers()[s.buyerId];
    return {
      dataset: ds.name, datasets: ['orders', 'agent_activity', 'demand'],
      datasetNote: 'orders = vuoden tilaushistoria; agent_activity = yksi rivi agentin istuntoa kohti; '
        + 'demand = suunnitellut ja tilatut rivit sekä tarpeet, joita ei voitu täyttää (ja miksi).',
      measures: Object.fromEntries(Object.entries(ds.schema.measures).map(([k, v]) => [k, { label: v.label, unit: v.unit }])),
      dimensions: Object.fromEntries(Object.entries(ds.schema.dimensions).map(([k, v]) => [k, { label: v.label, type: v.type }])),
      timeGrains: Object.keys(query.GRAINS), period: { from: ds.period[0], to: ds.period[1] },
      relativePeriods: query.RELATIVE, operators: Object.keys(query.OPS), calcs: query.CALCS, chartTypes: charts.TYPES,
      sites: b ? b.sites.map((x) => x.name) : [], scopedToSite: this.siteName(s), recipes: INSIGHT_PLAYBOOK.recipes,
    };
  }

  private getValues({ s, a }: { s: AnalysisSession; a: Record<string, unknown> }): Record<string, unknown> {
    const f = a.field;
    const dims: Record<string, { sql: string }> = SCHEMA.dimensions;
    if (typeof f !== 'string' || !(f in dims)) throw new GuardFailed(`Tuntematon ulottuvuus '${String(f)}'.`, { fix: `Käytä jotakin näistä: ${Object.keys(dims).join(', ')}.` });
    const col = f !== 'date' ? dims[f].sql : 'substr(date,1,7)';
    let sql = `SELECT DISTINCT ${col} AS v FROM line WHERE buyer_id = ? AND ${col} IS NOT NULL`;
    const args: string[] = [s.buyerId];
    if (a.search) {
      sql += ` AND LOWER(${col}) LIKE ?`;
      args.push(`%${String(a.search).toLowerCase()}%`);
    }
    const limit = typeof a.limit === 'number' ? Math.trunc(a.limit) : 50;
    const values = this.conn.prepare(`${sql} ORDER BY 1 LIMIT ${limit}`).pluck().all(args);
    return { field: f, values };
  }

  private runQuery({ s, a }: { s: AnalysisSession; a: Record<string, unknown> }): Record<string, unknown> {
    const spec: Record<string, unknown> = { ...a };
    const site = this.siteName(s);
    if (site) spec.filters = [...(Array.isArray(spec.filters) ? spec.filters : []), { field: 'site', op: 'eq', value: site }];
    const res = query.run({ conn: this.connForDataset(typeof spec.dataset === 'string' ? spec.dataset : 'orders'), spec, buyerId: s.buyerId });
    s.result = res;
    return { columns: res.columns, rows: res.rows.slice(0, 20), rowCount: res.rows.length, shape: res.shape,
      period: res.period, truncated: res.rows.length > 20 };
  }

  /** Which values of `by` drove the change of `measure` from period_a to period_b (top 5 + Other). */
  private explainChange({ s, a }: { s: AnalysisSession; a: Record<string, unknown> }): Record<string, unknown> {
    const isOrders = a.dataset === undefined || a.dataset === 'orders';
    const ds = query.dataset({ name: a.dataset, conn: isOrders ? this.conn : undefined });
    const meas = ds.schema.measures;
    const m = String(a.measure);
    const by = String(a.by);
    if (!(m in meas)) throw new GuardFailed(`Tuntematon mittari '${m}'.`, { fix: `Käytä jotakin näistä: ${Object.keys(meas).join(', ')}.` });
    const sql = meas[m].sql.toUpperCase();
    if (!(sql.startsWith('SUM(') || sql.startsWith('COUNT(')) || sql.includes('/')) {
      throw new GuardFailed(`'${m}' on suhdeluku, joten sen muutosta ei voi jakaa osiin.`, { fix: 'Käytä summaa, kuten spend, waste, co2e, quantity tai orders.' });
    }
    const conn = this.connForDataset(ds.name);
    const base: Record<string, unknown> = { dataset: ds.name, measures: [m], dimensions: [by] };
    const site = this.siteName(s);
    if (site) base.filters = [{ field: 'site', op: 'eq', value: site }];
    const ra = query.run({ conn, spec: { ...base, period: a.period_a }, buyerId: s.buyerId });
    const rb = query.run({ conn, spec: { ...base, period: a.period_b }, buyerId: s.buyerId });
    const total = (r: QueryResult) => new Map<Cell, number>(r.rows.map((row) => [row[by], typeof row[m] === 'number' ? Number(row[m]) : 0]));
    const va = total(ra);
    const vb = total(rb);
    const parts = [...new Set([...va.keys(), ...vb.keys()])].map((k): Contribution => {
      const pa = va.get(k) ?? 0;
      const pb = vb.get(k) ?? 0;
      return { value: k, a: pa, b: pb, contribution: round({ v: pb - pa, places: 2 }), sharePct: null };
    });
    parts.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution));
    const sum = (xs: number[]) => xs.reduce((acc, v) => acc + v, 0);
    const totalA = sum([...va.values()]);
    const totalB = sum([...vb.values()]);
    const change = round({ v: totalB - totalA, places: 2 });
    const top = parts.slice(0, 5);
    const rest = parts.slice(5);
    if (rest.length) {
      top.push({ value: 'Other', a: sum(rest.map((p) => p.a)), b: sum(rest.map((p) => p.b)),
        contribution: round({ v: sum(rest.map((p) => p.contribution)), places: 2 }), sharePct: null });
    }
    const unit = meas[m].unit;
    const label = meas[m].label.toLowerCase();
    const word = change >= 0 ? 'nousua' : 'laskua';
    const signed = (v: number) => {
      const text = unit === 'EUR' && Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1).replace('.', ',')} t€` : explain.fmt({ v: Math.abs(v), unit });
      return (v >= 0 ? '+' : '−') + text;
    };
    for (const p of top) p.sharePct = change ? round({ v: (p.contribution / change) * 100, places: 1 }) : null;
    const sentences = top.slice(0, 3).map((p) => `${String(p.value)} selitti ${signed(p.contribution)} mittarin ”${label}” ${signed(change)} ${word}.`);
    return { measure: m, by, dataset: ds.name, periodA: ra.period, periodB: rb.period,
      totalA: round({ v: totalA, places: 2 }), totalB: round({ v: totalB, places: 2 }), change, contributions: top,
      sentences, caption: sentences[0] ?? 'Ei muutosta selitettävänä.' };
  }
}
