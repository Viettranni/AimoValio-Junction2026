// Port of valioaimo gateway/analytics/analyst.py: the analyst turns a typed question (+ page filters) into a chart,
// through the insight rails.
//
// Two engines, same tools, same order:
//   * "claude": Claude Haiku 5.5 drives the insight playbook tools in a tool loop (when ANTHROPIC_API_KEY /
//     ANTHROPIC_AUTH_TOKEN is set). Any error falls back to rules.
//   * "rules": a deterministic EN/FI phrase interpreter that builds the query spec itself.
// Both return the same answer shape, including the tool steps taken ("How I made this").
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, jsonSchema, stepCountIs, tool, type LanguageModel, type ToolSet } from 'ai';
import type { ChartSpec } from './charts';
import { fits } from './charts';
import type { DirectoryBuyer, InsightEngine } from './engine';
import { PlaybookError } from './errors';
import { INSIGHT_PLAYBOOK, TOOL_INPUTS } from './playbook';
import { isRecord, type Column, type NormalSpec } from './query';
import type { Row } from './schema';
import type { JsonSchema } from './validate';

export const MODEL = 'claude-haiku-5-5';

/** Python's re.search with Unicode word boundaries (JS \b only knows ASCII letters). */
const W = '[\\p{L}\\p{N}_]';
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const rx = (pattern: string) => new RegExp(pattern.replaceAll('\\b', B), 'u');
const search = ({ pattern, text }: { pattern: string; text: string }) => rx(pattern).test(text);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MEASURE_WORDS: Array<[string, string]> = [
  ['\\bco2|carbon|climate|hiili|päästö', 'co2e'],
  ['waste|left ?over|thrown|hävik|jäi yli|ylijä', 'waste'],
  ['on[- ]time|late|delay|myöhä|ajallaan|toimitusvarmuus', 'on_time_pct'],
  ['just right|right[- ]sized|sopiva', 'right_sized_pct'],
  ['\\borders?\\b|tilauks|tilaukset', 'orders'],
  ['\\bevents?\\b|tapahtum|juhl', 'events'],
  ['\\bguests?\\b|vieraat|vierait', 'guests'],
  ['weight|\\bkg\\b|kilo|paino', 'kg'],
  ['price|hinta|hinnat', 'avg_price'],
  ['quantity|volume|määrä', 'quantity'],
  ['spend|spent|cost|money|euro|€|kulu|kulut|kulutus|ostot|budget', 'spend'],
];
const DIM_WORDS: Array<[string, [string, string | null]]> = [
  ['by week|weekly|per week|viikoittain|viikko', ['date', 'week']],
  ['by quarter|quarterly|neljännes', ['date', 'quarter']],
  ['by day|daily|per day|päivittäin', ['date', 'day']],
  ['month|monthly|over time|trend|kuukau|kuukausittain|vuoden aikana', ['date', 'month']],
  ['weekday|day of (the )?week|viikonpäiv', ['weekday', null]],
  ['categor|kategori|tuoteryhm', ['category', null]],
  ['product|item|tuotte|tuote', ['product', null]],
  ['kitchen|restaurant|site|location|hotel|keittiö|ravintol|toimipai', ['site', null]],
  ['brand|supplier|merkki|toimittaj', ['brand', null]],
  ['event type|kind of event|tapahtumatyyp', ['event_type', null]],
  ['\\bevents?\\b|tapahtumittain|juhlittain', ['event', null]],
  ['storage|chilled|frozen|säilytys', ['temperature', null]],
  ['outcome|how it went|labels?', ['outcome', null]],
];
const CHART_WORDS: Array<[string, string]> = [
  ['heat ?map|lämpökartta', 'heatmap'], ['\\bpie\\b|donut|piirakka', 'donut'], ['scatter|hajonta', 'scatter'],
  ['bubble', 'bubble'], ['\\btable\\b|taulukko', 'table'], ['\\barea\\b', 'area'], ['stacked|pinottu', 'stacked'],
  ['grouped|side by side', 'grouped'], ['\\bmix\\b|100 ?%|percent(age)? split|osuusjakauma|prosenttijakauma', 'percent'],
  ['waterfall|vesiputous', 'waterfall'], ['histogram|distribution|jakauma', 'histogram'],
  ['box ?plot|spread', 'boxplot'], ['\\bbars?\\b|pylväs', 'bar'], ['\\bline\\b|viiva', 'line'],
  ['\\bkpi\\b|one number|total|yhteensä', 'kpi'],
];

function period(text: string): string | null {
  const t = text.toLowerCase();
  if (search({ pattern: 'last 3 months|past 3 months|last quarter|3 kk|viimeiset 3|kolme kuukautta', text: t })) return 'last_3_months';
  if (search({ pattern: 'last 6 months|past 6 months|half ?year|puoli vuotta|6 kk', text: t })) return 'last_6_months';
  if (search({ pattern: 'last 30 days|past month|30 päivää', text: t })) return 'last_30_days';
  if (search({ pattern: 'this month|last month|tässä kuussa|viime kuussa', text: t })) return 'last_month';
  return null;
}

/** Page filters for ask: always applied, and they win over guesses. */
export const ASK_FILTERS: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    site: { type: 'string', description: 'restaurant name, e.g. Pohjola Tampere' },
    siteId: { type: ['string', 'null'], description: 'restaurant id' },
    category: { type: 'string', description: 'product category, e.g. Maitotuotteet' },
    event_type: { type: 'string', description: 'event type, e.g. Gaala' },
    period: { description: '{from, to} or last_month | last_3_months | last_6_months | last_30_days | this_year',
      anyOf: [{ type: 'string' }, { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }] },
  },
  examples: [{ site: 'Pohjola Tampere', period: 'last_3_months' }],
};

export interface AskFilters { site?: string; siteId?: string | null; category?: string; event_type?: string; period?: unknown }

export interface Step { tool: string; args: unknown; next?: string[]; error?: Record<string, unknown> }

export interface Answer {
  sessionId: string;
  engine: 'rules' | 'claude';
  spec: unknown;
  chart: ChartSpec | null;
  columns: Column[];
  rows: Row[];
  period: { from: string; to: string };
  caption: string;
  facts: string[];
  assumed: string[];
  steps: Step[];
  note?: string;
}

export interface Clarify {
  clarify: true;
  prompt: string;
  intro: string;
  questions: Array<{ q: string; options: string[] }>;
}

type DimArg = string | { field: string; grain: string | null };
const dimField = (d: DimArg) => (typeof d === 'string' ? d : d.field);

interface RuleSpec {
  measures: string[];
  dimensions: DimArg[];
  filters: Array<{ field: string; op: string; value: unknown }>;
  limit?: number;
  sort?: Array<{ by: string; dir: string }>;
  other?: boolean;
  compare?: string;
  period?: unknown;
  calc?: Array<Record<string, unknown>>;
}

/** The Claude model when a key is configured (the key is read by the provider, never logged). */
function defaultModel(): LanguageModel | null {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return createAnthropic()(MODEL);
}

export class Analyst {
  private readonly model: LanguageModel | null;

  constructor(private readonly deps: {
    engine: InsightEngine;
    buyers: () => Record<string, DirectoryBuyer>;
    /** null forces the rule engine; omitted uses Claude when a key is set. */
    model?: LanguageModel | null;
  }) {
    this.model = deps.model === undefined ? defaultModel() : deps.model;
  }

  // ------------------------------------------------------------------ public
  async ask({ prompt, filters = {}, buyerId, siteId = null }: {
    prompt: string; filters?: AskFilters; buyerId: string; siteId?: string | null;
  }): Promise<Answer | Clarify> {
    let ans: Answer | Clarify | null = null;
    let note: string | null = null;
    if (this.model) {
      try {
        ans = await this.askClaude({ model: this.model, prompt, filters, buyerId, siteId });
      } catch (e) { // never leave the chef without an answer
        ans = this.rulesOrNull({ prompt, filters, buyerId, siteId });
        note = `Vastattu sisäänrakennetuilla säännöillä (${e instanceof Error ? e.name : 'Error'}).`;
      }
    } else {
      ans = this.rulesOrNull({ prompt, filters, buyerId, siteId }); // e.g. no rows to chart
    }
    if (ans && 'clarify' in ans) return ans;
    if (!ans || !hasData(ans)) { // nothing to show: ask, don't draw an empty chart
      return this.clarify({ prompt, buyerId, intro: '', empty: true, filtered: Object.values(filters).some(Boolean) });
    }
    return note ? { ...ans, note } : ans;
  }

  private rulesOrNull(args: { prompt: string; filters: AskFilters; buyerId: string; siteId: string | null }): Answer | null {
    try {
      return this.askRules(args);
    } catch (e) {
      if (e instanceof PlaybookError) return null;
      throw e;
    }
  }

  // ------------------------------------------------------------------ asking back
  /** Questions for the chef, each with quick answers (the UI adds Custom). Answers are appended to the prompt. */
  clarify({ prompt, buyerId, intro, questions, empty = false, filtered = false }: {
    prompt: string; buyerId: string; intro: string; questions?: string[]; empty?: boolean; filtered?: boolean;
  }): Clarify {
    const sites = (this.deps.buyers()[buyerId]?.sites ?? []).map((s) => s.name);
    let qs = questions ?? [];
    if (!qs.length) {
      qs = ['Mitä haluaisit tarkastella?', 'Miltä ajanjaksolta?'];
      if (empty) {
        qs = ['Tarkastellaanko koko vuotta?', 'Mitä haluaisit tarkastella sen sijaan?'];
        if (filtered) qs.splice(1, 0, 'Poistetaanko suodattimet (ravintola, tuoteryhmä ja tapahtumatyyppi)?');
      }
      if (sites.length > 1 && !empty) qs.push('Mitä ravintolaa tarkoitat?');
    }
    const introText = intro || 'Tarvitsen vähän lisätietoa vastatakseni tähän.';
    return { clarify: true, prompt, intro: introText, questions: qs.slice(0, 3).map((q) => ({ q, options: options({ q, sites }) })) };
  }

  // ------------------------------------------------------------------ rules engine
  interpret({ prompt, filters, buyerId }: { prompt: string; filters: AskFilters; buyerId: string }): {
    spec: RuleSpec; chart: string | null; assumed: string[];
  } {
    const t = ` ${prompt.toLowerCase()} `;
    const has = (pattern: string) => search({ pattern, text: t });
    const assumed: string[] = [];
    const measures: string[] = [];
    for (const [pat, m] of MEASURE_WORDS) if (has(pat) && !measures.includes(m)) measures.push(m);
    if (measures.includes('waste') && has('%|percent|share|rate|osuus|prosent')) measures[measures.indexOf('waste')] = 'waste_pct';
    if (!measures.length) {
      measures.push('spend');
      assumed.push('Näytin kulutuksen, koska kysymyksessä ei mainittu mittaria.');
    }
    let dims: DimArg[] = [];
    for (const [pat, [f, g]] of DIM_WORDS) {
      if (has(pat) && !dims.map(dimField).includes(f)) dims.push(g ? { field: f, grain: g } : f);
    }
    const top = rx('\\btop\\s*(\\d+)|(\\d+)\\s*(?:most|largest|biggest|eniten|suurinta)').exec(t);
    if (!dims.length && !has('\\btotal|yhteensä|\\bkpi\\b')) {
      dims = [{ field: 'date', grain: 'month' }];
      assumed.push('Jaoin tiedot kuukausiin, koska kysymyksessä ei sanottu miten.');
    }
    const names = dims.map(dimField);
    if (names.includes('site') && names.length > 1) { // "category per kitchen": kitchen first reads better
      dims = [...dims.filter((d) => dimField(d) === 'site'), ...dims.filter((d) => dimField(d) !== 'site')];
    }
    const spec: RuleSpec = { measures: measures.slice(0, 3), dimensions: dims.slice(0, 2), filters: [] };
    for (const s of this.deps.buyers()[buyerId]?.sites ?? []) {
      const words = s.name.toLowerCase().split(/\s+/)
        .filter((w) => w.length > 4 && !['keskuskeittiö', 'tuotantokeittiö', 'koulukeittiö', 'pohjola', 'sairaalan', 'kaari-sairaalan'].includes(w));
      if (words.some((w) => has(`\\b${escapeRe(w.slice(0, 6))}`))) spec.filters.push({ field: 'site', op: 'eq', value: s.name });
    }
    const categories: Record<string, string> = {
      Maitotuotteet: 'dairy|maito', Kala: 'fish|kala', Liha: 'meat|liha', 'Hedelmät ja vihannekset': 'veg|fruit|vihannes|hedelm',
      Leipomotuotteet: 'bakery|bread|leipä', Kuivatuotteet: 'dry goods|kuiva', Kasvipohjaiset: 'plant|vegan|kasvi',
    };
    for (const [cat, words] of Object.entries(categories)) {
      if (has(`\\b(${words})`) && !t.includes('categor')) spec.filters.push({ field: 'category', op: 'eq', value: cat });
    }
    const eventTypes: Record<string, string> = {
      Gaala: 'gala|gaala', Häät: 'wedding|häät', Konferenssi: 'conference|konferenss', Pikkujoulu: 'christmas party|pikkujoul',
      Syntymäpäivä: 'birthday|syntymäpäiv', Lounas: 'lunch|lounas',
    };
    for (const [et, words] of Object.entries(eventTypes)) {
      if (has(`(${words})`) && !names.includes('event_type')) spec.filters.push({ field: 'event_type', op: 'eq', value: et });
    }
    if (top) {
      const n = Number(top[1] ?? top[2]);
      spec.limit = Math.max(1, Math.min(50, n));
      spec.sort = [{ by: measures[0], dir: 'desc' }];
      if (has('rest|others|other|muut')) spec.other = true;
      if (!spec.dimensions.some((d) => dimField(d) === 'product') && !spec.dimensions.length) spec.dimensions = ['product'];
    }
    if (has('compared|versus|\\bvs\\.?\\b|previous|before|edellis|verrattuna')) {
      spec.compare = 'previous_period';
      const plain = spec.dimensions.filter((d) => typeof d === 'string');
      spec.dimensions = plain.length ? plain : ['site'];
    }
    const p = period(t);
    if (p) spec.period = p;
    const calc: Array<Record<string, unknown>> = [];
    if (has('\\bshare|osuus|proportion|part of')) calc.push({ type: 'share', of: measures[0] });
    if (has('running|cumulative|kertymä')) calc.push({ type: 'running_total', of: measures[0] });
    if (has('moving average|rolling|liukuva')) calc.push({ type: 'moving_avg', of: measures[0], window: 3 });
    const oneSeries = spec.dimensions.length === 1 && typeof spec.dimensions[0] !== 'string';
    if (oneSeries && has('forecast|predict|next \\d* ?months?|coming months|ennuste|ennusta')) calc.push({ type: 'forecast', of: measures[0], horizon: 3 });
    if (oneSeries && has('unusual|anomal|spike|odd|outlier|poikkea')) calc.push({ type: 'anomaly', of: measures[0] });
    if (calc.length) spec.calc = calc;
    // page filters always apply (and win over guesses for the same field)
    for (const field of ['site', 'category', 'event_type'] as const) {
      const value = filters[field];
      if (value) spec.filters = [...spec.filters.filter((f) => f.field !== field), { field, op: 'eq', value }];
    }
    if (filters.period) spec.period = filters.period;
    let chart = CHART_WORDS.find(([pat]) => has(pat))?.[1] ?? null;
    if (chart === 'kpi' && spec.dimensions.length) chart = null;
    return { spec, chart, assumed };
  }

  private askRules({ prompt, filters, buyerId, siteId }: { prompt: string; filters: AskFilters; buyerId: string; siteId: string | null }): Answer {
    const interpreted = this.interpret({ prompt, filters, buyerId });
    let spec: RuleSpec = interpreted.spec;
    const { chart: chartType, assumed } = interpreted;
    const steps: Step[] = [];
    const E = this.deps.engine;
    const call = ({ sid, toolName, args = {} }: { sid: string | null; toolName: string; args?: unknown }) => {
      const r = E.call({ sid, tool: toolName, args });
      steps.push({ tool: toolName, args, next: r.next_allowed_tools });
      return r;
    };
    const sid = call({ sid: null, toolName: 'start_analysis', args: { buyerId, siteId, agent: 'rules' } }).sessionId;
    call({ sid, toolName: 'describe_data' });
    try {
      call({ sid, toolName: 'run_query', args: spec });
    } catch (e) { // a guess the rails rejected: fall back to the safest question
      if (!(e instanceof PlaybookError)) throw e;
      assumed.push(`En voinut kysyä sitä täsmälleen (${e.message}), joten näytin kulutuksen kuukausittain.`);
      spec = { measures: ['spend'], dimensions: [{ field: 'date', grain: 'month' }], filters: spec.filters };
      call({ sid, toolName: 'run_query', args: spec });
    }
    const out = call({ sid, toolName: 'suggest_chart' }).output.suggestions;
    const types = Array.isArray(out) ? out.flatMap((s) => (isRecord(s) && typeof s.type === 'string' ? [s.type] : [])) : [];
    const session = E.sessions.get(sid);
    const ok = session?.result ? fits(session.result) : [];
    const ctype = chartType && ok.includes(chartType) ? chartType : types[0];
    if (chartType && ctype !== chartType) assumed.push(`Kaaviotyyppi ${chartType} ei sovi tähän vastaukseen, joten käytin tyyppiä ${ctype}.`);
    call({ sid, toolName: 'build_chart', args: { type: ctype } });
    const ex = call({ sid, toolName: 'explain_result' }).output;
    return this.answer({ sid, steps, ex, assumed, engine: 'rules', spec });
  }

  // ------------------------------------------------------------------ claude engine
  private async askClaude({ model, prompt, filters, buyerId, siteId }: {
    model: LanguageModel; prompt: string; filters: AskFilters; buyerId: string; siteId: string | null;
  }): Promise<Answer | Clarify> {
    const E = this.deps.engine;
    const steps: Step[] = [];
    const start = E.call({ sid: null, tool: 'start_analysis', args: { buyerId, siteId, agent: 'claude-haiku' } });
    const sid = start.sessionId;
    steps.push({ tool: 'start_analysis', args: { buyerId }, next: start.next_allowed_tools });
    const tools: ToolSet = {};
    for (const st of INSIGHT_PLAYBOOK.steps) {
      for (const name of st.tools) {
        if (name === 'start_analysis') continue;
        const schema: JsonSchema = { ...(TOOL_INPUTS[name] ?? { type: 'object' }) };
        delete schema.examples;
        tools[name] = tool({
          description: `Step '${st.id}': ${st.does}`, // the playbook's own input schema (1.1.0)
          inputSchema: jsonSchema(schema),
          execute: async (input: unknown) => {
            try {
              const r = E.call({ sid, tool: name, args: input });
              steps.push({ tool: name, args: input, next: r.next_allowed_tools });
              const chart = r.output.chart;
              const out = name !== 'build_chart' ? r.output
                : { built: true, type: isRecord(chart) && isRecord(chart.usermeta) ? chart.usermeta.chartType : null };
              return JSON.stringify(out).slice(0, 12000);
            } catch (e) {
              if (!(e instanceof PlaybookError)) throw e;
              steps.push({ tool: name, args: input, error: e.body() });
              throw new Error(JSON.stringify(e.body())); // the model sees the error and its `fix`
            }
          },
        });
      }
    }
    const system = "You answer a chef's question about their restaurant data by calling the tools in order: "
      + 'describe_data, optionally get_values, run_query (repeat if needed), suggest_chart, build_chart, explain_result. '
      + "Use only names returned by describe_data. If a tool returns an error with a 'fix', follow the fix and retry. "
      + "If the question is vague, choose the measure and grouping that answer it best (for example 'wasting money' "
      + "means waste in euros by product or kitchen, 'how are we doing' means spend and waste_pct over months) "
      + 'and say in the final sentence what you looked at. '
      + 'Only if the question cannot be mapped to the data at all, or run_query returns no rows even after you '
      + 'widen it, do not build a chart: reply with at most three short questions to the chef, one per line, '
      + "each ending with '?', and nothing else. Write clarification questions in Finnish because the app UI is Finnish. "
      + "For chart titles and the final sentence, use the same language as the user's question. "
      + `Apply these page filters in every run_query: ${JSON.stringify(filters)}. `
      + `Worked examples:\n${JSON.stringify(INSIGHT_PLAYBOOK.recipes)}`
      + '\nFinish after explain_result with one short sentence.';
    const res = await generateText({
      model, system, prompt, tools, maxOutputTokens: 4000, stopWhen: stepCountIs(10), maxRetries: 1,
      providerOptions: { anthropic: { effort: 'low' } },
    });
    const s = E.sessions.get(sid);
    if (!s?.chart || !s.result) {
      const qs = res.text.split(/\n+/).filter((q) => q.trim().endsWith('?')).map((q) => q.replace(/^[ \-•0-9.)]+|[ \-•0-9.)]+$/g, ''));
      if (qs.length) return this.clarify({ prompt, buyerId, intro: '', questions: qs });
      throw new Error('the model did not build a chart');
    }
    const ex = E.call({ sid, tool: 'explain_result' }).output;
    return this.answer({ sid, steps, ex, assumed: [], engine: 'claude', spec: s.result.spec });
  }

  // ------------------------------------------------------------------ shape
  private answer({ sid, steps, ex, assumed, engine, spec }: {
    sid: string; steps: Step[]; ex: Record<string, unknown>; assumed: string[]; engine: 'rules' | 'claude'; spec: RuleSpec | NormalSpec;
  }): Answer {
    const s = this.deps.engine.sessions.get(sid);
    const res = s?.result;
    if (!s || !res) throw new Error(`analysis ${sid} has no result`);
    return {
      sessionId: sid, engine, spec, chart: s.chart ?? null, columns: res.columns, rows: res.rows.slice(0, 300), period: res.period,
      caption: typeof ex.caption === 'string' ? ex.caption : '',
      facts: Array.isArray(ex.facts) ? ex.facts.filter((f): f is string => typeof f === 'string') : [],
      assumed, steps,
    };
  }
}

/** Any non-zero number in the rows (booleans count, as Python's bool is an int). */
function hasData(ans: Answer): boolean {
  return ans.rows.some((r) => Object.values(r).some((v) => (typeof v === 'number' || typeof v === 'boolean') && Boolean(v)));
}

function options({ q, sites }: { q: string; sites: string[] }): string[] {
  const t = q.toLowerCase();
  if (/katso|mittari|sen sijaan/.test(t)) return ['Kulutus', 'Hävikki', 'Tilaukset'];
  if (/ajanjakso|milloin|kuukau|jakso/.test(t)) return ['Viime kuukausi', 'Viimeiset 3 kuukautta', 'Koko vuosi'];
  if (/ravintola|keittiö|toimipaikka/.test(t)) return sites.slice(0, 3);
  return ['Kyllä', 'Ei'];
}
