// Port of valioaimo gateway/analytics/charts.py: chart intent -> Vega-Lite v5 spec. Models pick a type (and
// optionally fields); the gateway writes the spec, so even a small model never has to know Vega-Lite.
// intent = {type: one of TYPES, x?: field, y?: field, color?: field, size?: field, title?: string}
// Specs carry no colours; the page applies its light/dark theme as Vega-Lite config.
import { GuardFailed } from './errors';
import { labelOf } from './explain';
import type { Column, QueryResult } from './query';
import { isRecord } from './query';
import { allFields, type Row } from './schema';

const SCHEMA = allFields();

export const SCHEMA_URL = 'https://vega.github.io/schema/vega-lite/v5.json';
export const TYPES: Record<string, string> = {
  line: 'Kehitys ajan yli', area: 'Kehitys ja volyymi', column: 'Muutaman arvon vertailu, pysty',
  bar: 'Luokkien järjestys, vaaka', stacked: 'Kokonaisuus osiin jaettuna', grouped: 'Osat vierekkäin',
  percent: 'Osien jakauma (100 %)', heatmap: 'Kaksi luokittelua kerralla', donut: 'Osuus kokonaisuudesta (muutama osa)',
  scatter: 'Kaksi mittaria vastakkain', bubble: 'Kolme mittaria kerralla', histogram: 'Arvojen jakauma',
  boxplot: 'Vaihtelu luokittain', waterfall: 'Mikä muutoksen aiheutti', kpi: 'Yksi iso luku',
  sparkline: 'Pieni trendi', table: 'Kaikki luvut',
};

/** A Vega-Lite spec, or a plain table. Only JSON-safe values. */
export type ChartSpec = { [key: string]: unknown };
export interface ChartIntent { type?: unknown; x?: unknown; y?: unknown; color?: unknown; size?: unknown; title?: unknown }

function cols(result: QueryResult) {
  const { dims, timeDim: time, measures: meas } = result.shape;
  return { dims, time, cats: dims.filter((d) => d !== time), meas, n: result.rows.length };
}

const unique = (xs: string[]) => [...new Set(xs)];

export function fits(result: QueryResult): string[] {
  const { dims, time, meas, n } = cols(result);
  const out: string[] = [];
  if (!dims.length) return ['kpi', 'table'];
  if (time && dims.length === 1) out.push('line', 'area', 'column', 'waterfall', 'sparkline');
  if (time && dims.length === 2) out.push('line', 'area', 'stacked', 'grouped', 'percent', 'heatmap', 'boxplot');
  if (!time && dims.length === 1) out.push('bar', 'column', 'waterfall', ...(n <= 10 ? ['donut'] : []));
  if (!time && dims.length === 2) out.push('heatmap', 'stacked', 'grouped', 'percent', 'boxplot');
  if (meas.length >= 2 && dims.length) out.push('scatter', 'bubble');
  if (n >= 8 && dims.length) out.push('histogram');
  out.push('table');
  return unique(out);
}

export function suggest(result: QueryResult): Array<{ type: string; why: string }> {
  const { dims, time, meas, n } = cols(result);
  let order: string[];
  if (!dims.length) order = ['kpi'];
  else if (meas.length >= 2 && !time) order = ['scatter', 'bubble'];
  else if (time && dims.length === 1) order = ['line', 'area', 'column'];
  else if (time) order = ['line', 'stacked', 'heatmap'];
  else if (dims.length === 2) order = ['heatmap', 'stacked', 'grouped'];
  else {
    const share = result.columns.some((c) => c.name.endsWith('_share'));
    order = share && n <= 8 ? ['donut', 'bar'] : ['bar', n <= 8 ? 'donut' : 'column'];
  }
  const ok = fits(result);
  const out = [...order.filter((t) => ok.includes(t)), ...ok.filter((t) => !order.includes(t))];
  return out.slice(0, 5).map((t) => ({ type: t, why: TYPES[t] }));
}

function field({ result, name }: { result: QueryResult; name: string }): Column {
  const c = result.columns.find((x) => x.name === name);
  if (!c) throw new GuardFailed(`'${name}' ei ole tuloksessa.`, { fix: `Käytä jotakin näistä: ${result.columns.map((x) => x.name).join(', ')}.` });
  return c;
}

type Enc = { [key: string]: unknown };

function enc({ result, name, axisType = null, extra = {} }: {
  result: QueryResult; name: string; axisType?: string | null; extra?: Enc;
}): Enc {
  const c = field({ result, name });
  const unit = c.unit && c.unit !== 'count' && c.unit !== 'units' ? ` (${c.unit === 'EUR' ? '€' : c.unit})` : '';
  const grain = result.shape.grain;
  let type = axisType;
  if (type === null) {
    if (c.role !== 'dimension') type = 'quantitative';
    else if (c.type === 'time' && (grain === 'month' || grain === 'day')) type = 'temporal';
    else type = 'nominal';
  }
  const e: Enc = { field: name, type, title: c.label + unit };
  if (c.type === 'time' && (grain === 'month' || grain === 'day')) {
    const format = grain === 'month' ? '%b %Y' : '%-d.%-m.%Y';
    if (type === 'temporal') {
      e.timeUnit = grain === 'month' ? 'yearmonth' : 'yearmonthdate';
      e.axis = { format, labelAngle: 0 };
    } else {
      // Discrete chart axes still hold timestamps, so format their labels as dates too.
      e.axis = { labelExpr: `timeFormat(datum.value, '${format}')`, labelAngle: 0 };
    }
  }
  return { ...e, ...extra };
}

function tooltip(result: QueryResult): Enc[] {
  return result.columns.slice(0, 6).map((c) => ({ ...enc({ result, name: c.name }), ...(c.role !== 'dimension' ? { format: ',.1f' } : {}) }));
}

/** Forecast = the same series, dashed, with a light band for the likely range (one axis, one colour);
 * unusual periods = larger dots with a surface ring (config style 'anomaly') and a tooltip; a period that is still
 * running = a hollow dot, kept off the line so it does not look like a drop. */
function layerTimeCalcs({ spec, m, rows }: { spec: ChartSpec; m: string; rows: Row[] }): void {
  const encoding = spec.encoding;
  const mark = spec.mark;
  delete spec.encoding;
  delete spec.mark;
  if (!isRecord(encoding)) return;
  const { x, y, tooltip: tip } = encoding;
  const tips = Array.isArray(tip) ? tip : [];
  const yTitle = isRecord(y) ? y.title : undefined;
  const fut = 'datum.is_forecast || datum.forecast_anchor';
  const layers: ChartSpec[] = [];
  const anyForecast = rows.some((r) => r.is_forecast);
  if (anyForecast) {
    layers.push({ transform: [{ filter: fut }], mark: { type: 'area', opacity: 0.18, interpolate: 'monotone' },
      encoding: { x, y: { field: `${m}_lo`, type: 'quantitative', title: yTitle }, y2: { field: `${m}_hi` } } });
  }
  layers.push({ transform: [{ filter: '!datum.is_forecast && !datum.is_partial' }], mark, encoding: { x, y, tooltip: tip } });
  if (anyForecast) {
    layers.push({ transform: [{ filter: fut }], mark: { type: 'line', strokeDash: [6, 4], strokeWidth: 2, interpolate: 'monotone' },
      encoding: { x, y, tooltip: [...tips,
        { field: `${m}_lo`, type: 'quantitative', title: 'Alaraja', format: ',.0f' },
        { field: `${m}_hi`, type: 'quantitative', title: 'Yläraja', format: ',.0f' }] } });
  }
  if (rows.some((r) => r.is_partial)) {
    layers.push({ transform: [{ filter: 'datum.is_partial' }], mark: { type: 'point', filled: false, size: 64, strokeWidth: 2 },
      encoding: { x, y, tooltip: tip } });
  }
  if (rows.some((r) => r.is_anomaly)) {
    layers.push({ transform: [{ filter: 'datum.is_anomaly' }], mark: { type: 'point', filled: true, size: 110, strokeWidth: 2, style: 'anomaly' },
      encoding: { x, y, tooltip: [...tips, { field: `${m}_z`, type: 'quantitative', title: 'Poikkeavuus (z)' }] } });
  }
  spec.layer = layers;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** A temporal axis drawn as discrete bars: keep ticks discrete, but format their timestamp labels. */
function asOrdinal(e: Enc): void {
  const axis = isRecord(e.axis) ? e.axis : null;
  const format = typeof axis?.format === 'string' ? axis.format : null;
  e.type = 'ordinal';
  delete e.timeUnit;
  if (format) e.axis = { labelExpr: `timeFormat(datum.value, '${format}')`, labelAngle: 0 };
  else delete e.axis;
}

export function build({ result, intent }: { result: QueryResult; intent: ChartIntent }): ChartSpec {
  const t = intent.type;
  if (typeof t !== 'string' || !(t in TYPES)) throw new GuardFailed(`Tuntematon kaaviotyyppi '${String(t ?? null)}'.`, { fix: `Käytä jotakin näistä: ${Object.keys(TYPES).join(', ')}.` });
  const ok = fits(result);
  if (!ok.includes(t)) throw new GuardFailed(`Kaaviotyyppi ${t} ei sovi tähän tulokseen.`, { fix: `Nämä sopivat: ${ok.join(', ')}. Tai muuta kyselyä.` });
  if (!result.rows.length) throw new GuardFailed('Tulos on tyhjä.', { fix: 'Laajenna ajanjaksoa tai poista suodatin ja aja run_query uudelleen.' });
  const { dims, time, meas, n } = cols(result);
  const title = str(intent.title);
  if (t === 'table') return { type: 'table', columns: result.columns, rows: result.rows, title };
  const m = str(intent.y) ?? meas[0];
  const x = str(intent.x) ?? time ?? dims[0] ?? null;
  const color = str(intent.color) ?? dims.find((d) => d !== x) ?? null;
  const spec: ChartSpec = { $schema: SCHEMA_URL, data: { values: result.rows }, width: 'container',
    height: t !== 'sparkline' && t !== 'kpi' ? 260 : 60, usermeta: { chartType: t } };
  if (title) spec.title = title;
  const tip = tooltip(result);
  if (t === 'line' || t === 'area' || t === 'sparkline') {
    if (x === null) throw new GuardFailed(`Kaaviotyyppi ${t} tarvitsee ulottuvuuden.`, { fix: `Nämä sopivat: ${ok.join(', ')}.` });
    spec.mark = { type: t !== 'area' ? 'line' : 'area', point: t === 'line' && n <= 24, interpolate: 'monotone', strokeWidth: 2.5,
      ...(t === 'area' ? { line: true, opacity: 0.25 } : {}) };
    const encoding: Enc = { x: enc({ result, name: x }), y: enc({ result, name: m }), tooltip: tip };
    if (color && color !== x) encoding.color = enc({ result, name: color });
    spec.encoding = encoding;
    if (t === 'sparkline') {
      encoding.x = { ...enc({ result, name: x }), axis: null };
      encoding.y = { ...enc({ result, name: m }), axis: null };
      spec.config = { view: { stroke: null } };
    } else if (result.rows.some((r) => r.is_forecast || r.is_anomaly || r.is_partial)) {
      layerTimeCalcs({ spec, m, rows: result.rows });
    }
  } else if (t === 'column' || t === 'bar') {
    const cat = t === 'column' ? x : str(intent.x) ?? dims[0];
    if (cat === null) throw new GuardFailed(`Kaaviotyyppi ${t} tarvitsee ulottuvuuden.`, { fix: `Nämä sopivat: ${ok.join(', ')}.` });
    const val = enc({ result, name: m });
    const key = enc({ result, name: cat, extra: t === 'bar' && cat !== time ? { sort: '-x' } : {} });
    spec.mark = { type: 'bar', cornerRadiusEnd: 4 };
    spec.encoding = t === 'column' ? { x: key, y: val, tooltip: tip } : { y: key, x: val, tooltip: tip };
    if (t === 'column' && key.type === 'temporal') asOrdinal(key);
  } else if (t === 'stacked' || t === 'grouped' || t === 'percent') {
    if (x === null || color === null) throw new GuardFailed(`Kaaviotyyppi ${t} tarvitsee kaksi ulottuvuutta.`, { fix: `Nämä sopivat: ${ok.join(', ')}.` });
    spec.mark = { type: 'bar', cornerRadiusEnd: 2 };
    const xe = enc({ result, name: x });
    if (xe.type === 'temporal') asOrdinal(xe);
    const ye = enc({ result, name: m, extra: { stack: t === 'percent' ? 'normalize' : t === 'grouped' ? null : 'zero' } });
    if (t === 'percent') {
      ye.axis = { format: '%' };
      ye.title = 'Osuus';
    }
    const encoding: Enc = { x: xe, y: ye, color: enc({ result, name: color }), tooltip: tip };
    if (t === 'grouped') encoding.xOffset = { field: color };
    spec.encoding = encoding;
  } else if (t === 'heatmap') {
    const [a, b] = color && x ? [x, color] : [dims[0], dims[1]];
    spec.mark = { type: 'rect', cornerRadius: 3 };
    spec.encoding = { x: enc({ result, name: a, axisType: 'ordinal' }), y: enc({ result, name: b, axisType: 'ordinal' }),
      color: enc({ result, name: m }), tooltip: tip };
    spec.height = Math.max(160, 28 * new Set(result.rows.map((r) => r[b])).size);
  } else if (t === 'donut') {
    spec.mark = { type: 'arc', innerRadius: 70, padAngle: 0.01 };
    spec.encoding = { theta: enc({ result, name: m, extra: { stack: true } }),
      color: enc({ result, name: dims[0], extra: { sort: { field: m, order: 'descending' } } }), tooltip: tip };
    spec.view = { stroke: null };
  } else if (t === 'scatter' || t === 'bubble') {
    const ix = str(intent.x);
    const m2 = ix && meas.includes(ix) ? ix : meas[0];
    const m1 = meas.length > 1 ? meas.find((mm) => mm !== m2) ?? meas[0] : meas[0];
    spec.mark = { type: 'circle', opacity: 0.75 };
    const encoding: Enc = { x: enc({ result, name: m2 }), y: enc({ result, name: m1 }), tooltip: tip };
    if (t === 'bubble') encoding.size = enc({ result, name: str(intent.size) ?? (meas.length > 2 ? meas[2] : m2) });
    if (dims.length > 1) encoding.color = enc({ result, name: dims[1] });
    spec.encoding = encoding;
  } else if (t === 'histogram') {
    spec.mark = { type: 'bar', cornerRadiusEnd: 2 };
    spec.encoding = { x: enc({ result, name: m, extra: { bin: { maxbins: 12 } } }),
      y: { aggregate: 'count', title: 'Lukumäärä' } };
  } else if (t === 'boxplot') {
    const cat = dims.find((d) => d !== time) ?? dims[0];
    spec.mark = { type: 'boxplot', extent: 'min-max' };
    spec.encoding = { x: enc({ result, name: cat, axisType: 'nominal' }), y: enc({ result, name: m }) };
  } else if (t === 'waterfall') {
    const key = dims[0];
    const rows = result.rows;
    const num = (r: Row) => (typeof r[m] === 'number' ? Number(r[m]) : 0);
    const first = num(rows[0]);
    const data: Array<Record<string, string | number>> = [{ step: labelOf({ key, value: rows[0][key] }), start: 0, end: first, delta: first, kind: 'start' }];
    let prev = first;
    for (const r of rows.slice(1)) {
      const v = num(r);
      data.push({ step: labelOf({ key, value: r[key] }), start: prev, end: v, delta: v - prev, kind: v >= prev ? 'up' : 'down' });
      prev = v;
    }
    spec.data = { values: data };
    spec.mark = { type: 'bar', cornerRadius: 2 };
    spec.encoding = {
      x: { field: 'step', type: 'ordinal', sort: null, title: SCHEMA.dimensions[key].label },
      y: { field: 'start', type: 'quantitative', title: enc({ result, name: m }).title }, y2: { field: 'end' },
      color: { field: 'kind', type: 'nominal', title: null, legend: null },
      tooltip: [{ field: 'step', type: 'ordinal' }, { field: 'delta', type: 'quantitative', format: ',.0f', title: 'Muutos' }],
    };
  } else if (t === 'kpi') {
    const row = result.rows[0];
    const c = field({ result, name: m });
    spec.data = { values: [{ value: row[m], label: c.label, unit: c.unit ?? null }] };
    spec.mark = { type: 'text', fontSize: 44, fontWeight: 700 };
    spec.encoding = { text: { field: 'value', type: 'quantitative', format: ',.0f' } };
    spec.height = 80;
  }
  return spec;
}
