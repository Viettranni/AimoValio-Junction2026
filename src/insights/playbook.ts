// Insight playbook — rails for answering any question about a kitchen's own data.
// Ported unchanged from valioaimo gateway/analytics/insight_playbook.v1.yaml.
// Same rules as the order playbook: tools unlock in order (409 step_not_allowed + next_allowed_tools), every input
// is checked (422 with a `fix` that names what is valid), every call is audited with this version. Designed so a
// small model can follow it: each step has one job and the gateway does the hard parts (SQL, chart specs, wording).
import type { JsonSchema } from './validate';

export interface PlaybookStep {
  id: string;
  n: number;
  tools: string[];
  does: string;
  input?: unknown;
}

const noArgs: JsonSchema = { type: 'object', additionalProperties: false, properties: {}, examples: [{}] };

// 1.1.0: one JSON Schema per tool. Validated before the tool runs (422 bad_input with fix.expected and fix.example).
export const TOOL_INPUTS: Record<string, JsonSchema> = {
    start_analysis: {
      type: 'object', additionalProperties: false,
      properties: {
        buyerId: { type: 'string', description: "Customer account; must be the credential's own buyer." },
        siteId: { type: ['string', 'null'], description: 'Optional kitchen id to scope the analysis to.' },
        agent: { type: 'string', description: 'Set by the gateway: who drives the analysis.' },
      },
      examples: [{ buyerId: 'BUY-POHJOLA' }, { buyerId: 'BUY-POHJOLA', siteId: 'SITE-POHJOLA-TRE' }],
    },
    describe_data: {
      type: 'object', additionalProperties: false,
      properties: { dataset: { enum: ['orders', 'agent_activity', 'demand'], description: 'Which dataset to describe (default orders); the answer lists all datasets.' } },
      examples: [{}, { dataset: 'demand' }],
    },
    get_values: {
      type: 'object', additionalProperties: false, required: ['field'],
      properties: {
        field: { type: 'string', description: 'A dimension name from describe_data, e.g. product.' },
        search: { type: 'string', description: 'Optional text the values must contain.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'How many values (default 50).' },
      },
      examples: [{ field: 'site' }, { field: 'product', search: 'milk', limit: 20 }],
    },
    run_query: {
      type: 'object', additionalProperties: false,
      properties: {
        measures: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Measure names, e.g. [spend] or [spend, waste_pct].' },
        dimensions: {
          type: 'array', description: 'Dimension names, or {field: date, grain: day|week|month|quarter}.',
          items: { anyOf: [{ type: 'string' },
            { type: 'object', required: ['field'], properties: { field: { type: 'string' }, grain: { enum: ['day', 'week', 'month', 'quarter', 'year'] } } }] },
        },
        filters: {
          type: 'array', description: 'Each {field, op: eq|neq|in|not_in|contains|gte|lte|between, value}.',
          items: { type: 'object', required: ['field', 'op'], properties: { field: { type: 'string' }, op: { type: 'string' }, value: {} } },
        },
        period: {
          description: '{from, to} as YYYY-MM-DD, or last_month | last_3_months | last_6_months | last_30_days | this_year.',
          anyOf: [{ type: 'string' }, { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }],
        },
        compare: { enum: ['previous_period', 'previous_year', null], description: 'Compare with an earlier period (not with a date dimension).' },
        calc: {
          type: 'array', description: 'Each {type: share|running_total|rank|change_pct|moving_avg|forecast|anomaly, of: measure, window?, horizon?}.',
          items: { type: 'object', required: ['type'], properties: { type: { type: 'string' }, of: { type: 'string' }, window: { type: 'integer' }, horizon: { type: 'integer' } } },
        },
        sort: { type: 'array', description: 'Each {by: column, dir: asc|desc}.', items: { type: 'object', properties: { by: { type: 'string' }, dir: { enum: ['asc', 'desc'] } } } },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Row limit, 1-500.' },
        other: { type: 'boolean', description: 'true folds rows beyond limit into one Other row.' },
        dataset: { enum: ['orders', 'agent_activity', 'demand'], description: 'Which dataset to query (default orders).' },
      },
      examples: [
        { measures: ['spend'], dimensions: [{ field: 'date', grain: 'month' }] },
        { measures: ['spend'], dimensions: ['product'], sort: [{ by: 'spend', dir: 'desc' }], limit: 10, other: true },
      ],
    },
    suggest_chart: noArgs,
    build_chart: {
      type: 'object', additionalProperties: false, required: ['type'],
      properties: {
        type: { type: 'string', description: 'Chart type from describe_data.chartTypes, e.g. line, bar, donut.' },
        x: { type: 'string', description: 'Optional column for x.' },
        y: { type: 'string', description: 'Optional column for y.' },
        color: { type: 'string', description: 'Optional column for colour.' },
        size: { type: 'string', description: 'Optional column for size (bubble).' },
        title: { type: 'string', description: 'Optional chart title.' },
      },
      examples: [{ type: 'line' }, { type: 'bar', title: 'Top products' }],
    },
    explain_result: noArgs,
    explain_change: {
      type: 'object', additionalProperties: false, required: ['measure', 'period_a', 'period_b', 'by'],
      properties: {
        measure: { type: 'string', description: 'Measure to compare, e.g. spend.' },
        period_a: { type: 'object', description: 'Earlier period {from, to} (YYYY-MM-DD).', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
        period_b: { type: 'object', description: 'Later period {from, to} (YYYY-MM-DD).', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
        by: { type: 'string', description: 'Dimension whose values explain the change, e.g. site or category.' },
        dataset: { enum: ['orders', 'agent_activity', 'demand'], description: 'Which dataset (default orders).' },
      },
      examples: [{ measure: 'spend', period_a: { from: '2026-08-01', to: '2026-08-31' }, period_b: { from: '2026-09-01', to: '2026-09-30' }, by: 'site' }],
    },
};

export const INSIGHT_PLAYBOOK = {
  id: 'insight_playbook',
  version: '1.1.0',
  title: 'Ask the data — describe, query, chart, explain',
  principle: 'The model chooses what to ask; the gateway writes the query, the chart and the words.',
  steps: [
    { id: 'start', n: 0, tools: ['start_analysis'], does: 'Open an analysis for one buyer (and optionally one kitchen). Data never crosses buyers.',
      input: { buyerId: 'string', siteId: 'string (optional)' } },
    { id: 'describe', n: 1, tools: ['describe_data', 'get_values'],
      does: 'Learn what can be asked — measures with units, dimensions, time grains, period, kitchens, and the real values of any dimension.',
      input: { describe_data: {}, get_values: { field: 'a dimension name', search: 'optional text', limit: 'optional, default 50' } } },
    { id: 'query', n: 2, tools: ['run_query'], does: 'Ask one question as a query spec. Repeat as often as needed.',
      input: {
        measures: 'list of measure names, e.g. [spend] or [spend, waste_pct]',
        dimensions: 'list of dimension names or {field: date, grain: day|week|month|quarter}',
        filters: 'list of {field, op: eq|neq|in|not_in|contains|gte|lte|between, value}',
        period: '{from, to} as YYYY-MM-DD, or last_month | last_3_months | last_6_months | last_30_days | this_year',
        compare: 'previous_period | previous_year (not with a date dimension)',
        calc: 'list of {type: share|running_total|rank|change_pct|moving_avg, of: measure, window: n}',
        sort: 'list of {by: column, dir: asc|desc}',
        limit: '1-500',
        other: 'true folds rows beyond limit into one Other row',
      } },
    { id: 'suggest', n: 3, tools: ['suggest_chart'], does: 'Ask which chart types fit the last result, best first, with a reason each.' },
    { id: 'chart', n: 4, tools: ['build_chart'],
      does: 'Build the chart. Give only {type}; optionally x, y, color, size, title. Types: line, area, column, bar, stacked, grouped, percent, heatmap, donut, scatter, bubble, histogram, boxplot, waterfall, kpi, sparkline, table.' },
    { id: 'explain', n: 5, tools: ['explain_result', 'explain_change'],
      does: 'Get a plain caption and three facts for the last result; or explain_change: which values of a dimension drove the change of a measure between two periods.' },
  ] satisfies PlaybookStep[],
  recipes: [ // worked examples a small model can copy
    { ask: 'How has our spend moved this year?', query: { measures: ['spend'], dimensions: [{ field: 'date', grain: 'month' }] }, chart: { type: 'line' } },
    { ask: 'Top 10 products by spend in Tampere, rest as Other',
      query: { measures: ['spend'], dimensions: ['product'], filters: [{ field: 'site', op: 'eq', value: 'Pohjola Tampere' }],
        sort: [{ by: 'spend', dir: 'desc' }], limit: 10, other: true }, chart: { type: 'bar' } },
    { ask: 'Which kitchen wastes most compared to last quarter?',
      query: { measures: ['waste_pct'], dimensions: ['site'], period: 'last_3_months', compare: 'previous_period' }, chart: { type: 'column' } },
    { ask: 'Category mix per kitchen', query: { measures: ['spend'], dimensions: ['site', 'category'] }, chart: { type: 'percent' } },
    { ask: 'Expensive and wasteful products',
      query: { measures: ['spend', 'waste_pct'], dimensions: ['product'], sort: [{ by: 'spend', dir: 'desc' }], limit: 40 }, chart: { type: 'scatter' } },
    { ask: 'Carbon footprint by category, share of total',
      query: { measures: ['co2e'], dimensions: ['category'], calc: [{ type: 'share', of: 'co2e' }] }, chart: { type: 'donut' } },
    { ask: 'How often did our agent order without asking anyone, and how long did approvals take?',
      query: { dataset: 'agent_activity', measures: ['sessions', 'autonomous_rate', 'approval_rate', 'p90_approval_wait'] }, chart: { type: 'kpi' } },
    { ask: 'What did we need that Valio Aimo could not deliver, and why?',
      query: { dataset: 'demand', measures: ['unmet_qty', 'lost_value_eur'], dimensions: ['unmet_reason'] }, chart: { type: 'bar' } },
    { ask: 'Busiest weekdays per kitchen', query: { measures: ['orders'], dimensions: ['weekday', 'site'] }, chart: { type: 'heatmap' } },
  ],
  inputs: TOOL_INPUTS,
};


/** Tool name -> the step it belongs to. */
export const TOOL_STEP: Record<string, string> = Object.fromEntries(INSIGHT_PLAYBOOK.steps.flatMap((s) => s.tools.map((t) => [t, s.id])));
