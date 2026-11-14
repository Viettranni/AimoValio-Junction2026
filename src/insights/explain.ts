// Port of valioaimo gateway/analytics/explain.py: a plain-language caption and three facts for a query result.
import { parseIso } from './dates';
import { grouped } from './math';
import type { QueryResult } from './query';
import { allFields, type Cell, type Row } from './schema';

const SCHEMA = allFields();

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


/** f"{v:,.0f}" and friends. */
export function fmt({ v, unit }: { v: Cell | undefined; unit: string | null | undefined }): string {
  if (typeof v !== 'number') return '–';
  if (unit === 'EUR') return Math.abs(v) >= 100 ? `€${grouped({ v, digits: 0 })}` : `€${grouped({ v, digits: 2 })}`;
  if (unit === '%') return `${v.toFixed(1)}%`;
  if (unit === 'kg' || unit === 'kg CO2e') return `${grouped({ v, digits: 0 })} kg${unit === 'kg CO2e' ? ' CO₂e' : ''}`;
  if (unit === 'EUR/unit') return `€${grouped({ v, digits: 2 })}`;
  return grouped({ v, digits: 0 });
}

export function periodLabel(p: { from: string; to: string }): string {
  const a = parseIso(p.from);
  const b = parseIso(p.to);
  if (a.year === b.year && a.month === b.month) return `${MONTHS[a.month - 1]} ${a.year}`;
  return `${MONTHS[a.month - 1]} ${a.year !== b.year ? a.year : ''}`.trim() + ` – ${MONTHS[b.month - 1]} ${b.year}`;
}

export function labelOf({ key, value }: { key: string; value: Cell | undefined }): string {
  if (key === 'date' && typeof value === 'string' && value.length === 7) {
    const [y, m] = value.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  return value === null || value === undefined ? 'None' : String(value);
}

const n = (v: Cell | undefined): number => (typeof v === 'number' ? v : 0);
const TOTAL_UNITS = ['EUR', 'kg', 'kg CO2e', 'count', 'units'];

export function run(result: QueryResult): { caption: string; facts: string[] } {
  const { rows, shape } = result;
  const meas = SCHEMA.measures;
  if (!rows.length) return { caption: 'No orders match these filters.', facts: ['Try a longer period.', 'Or remove a filter.', 'Or pick another kitchen.'] };
  const m = shape.measures[0];
  const unit = meas[m].unit;
  const dims = shape.dims;
  const grain = shape.grain;
  const by = dims.length ? ' by ' + dims.map((d) => (d === 'date' && grain ? grain : SCHEMA.dimensions[d].label.toLowerCase())).join(' and ') : '';
  const caption = `${meas[m].label}${by}, ${periodLabel(result.period)}.`;
  const facts: string[] = [];
  if (!dims.length) {
    facts.push(`${meas[m].label}: ${fmt({ v: rows[0][m], unit })}.`);
    for (const extra of shape.measures.slice(1, 3)) facts.push(`${meas[extra].label}: ${fmt({ v: rows[0][extra], unit: meas[extra].unit })}.`);
  } else {
    const key = dims[0];
    const vals = rows.filter((r) => r[m] !== null && r[m] !== undefined && r[key] !== 'Other');
    // a month that is still running would look like the lowest month / a drop for totals
    const partial = vals.length > 0 && shape.timeDim === key && grain === 'month' && String(vals[vals.length - 1][key]) === result.period.to.slice(0, 7)
      && Number(result.period.to.slice(8)) < 28 && TOTAL_UNITS.includes(unit) && vals.length > 2;
    const full = partial ? vals.slice(0, -1) : vals;
    if (vals.length) {
      const hi = full.reduce((best, r) => (n(r[m]) > n(best[m]) ? r : best));
      const lo = full.reduce((best, r) => (n(r[m]) < n(best[m]) ? r : best));
      facts.push(`Highest: ${labelOf({ key, value: hi[key] })} (${fmt({ v: hi[m], unit })}).`);
      facts.push(`Lowest: ${labelOf({ key, value: lo[key] })} (${fmt({ v: lo[m], unit })}).`);
      if (shape.timeDim === key && vals.length > 1 && n(vals[0][m])) {
        const end = full[full.length - 1];
        const ch = ((n(end[m]) - n(vals[0][m])) / n(vals[0][m])) * 100;
        facts.push(`${ch >= 0 ? 'Up' : 'Down'} ${Math.abs(ch).toFixed(0)}% from ${labelOf({ key, value: vals[0][key] })} to ${labelOf({ key, value: end[key] })}`
          + (partial ? `; ${labelOf({ key, value: vals[vals.length - 1][key] }).split(' ')[0]} is still running.` : '.'));
      } else if (TOTAL_UNITS.includes(unit)) {
        const tot = rows.reduce((s, r) => s + n(r[m]), 0);
        facts.push(tot ? `The top one is ${((n(hi[m]) / tot) * 100).toFixed(0)}% of the total ${fmt({ v: tot, unit })}.` : `Total ${fmt({ v: tot, unit })}.`);
      } else {
        const avg = vals.reduce((s, r) => s + n(r[m]), 0) / vals.length;
        facts.push(`Average: ${fmt({ v: avg, unit })}.`);
      }
    }
  }
  if (shape.timeDim && dims.length) {
    const key = dims[0];
    const odd = rows.filter((r) => r.is_anomaly);
    const fut = rows.filter((r) => r.is_forecast);
    if (odd.length) { // unusual periods first: they are why someone asked
      const z = (r: Row) => Math.abs(n(r[`${m}_z`]));
      const r = odd.reduce((best, x) => (z(x) > z(best) ? x : best));
      facts.unshift(`Unusual: ${labelOf({ key, value: r[key] })} (${fmt({ v: r[m], unit })}), far from the months before it.`);
    }
    if (fut.length) {
      const b = fut[fut.length - 1];
      facts.unshift(`Forecast: about ${fmt({ v: b[m], unit })} by ${labelOf({ key, value: b[key] })} (likely ${fmt({ v: b[`${m}_lo`], unit })}–`
        + `${fmt({ v: b[`${m}_hi`], unit })}), from the same months last year and the recent trend.`);
    }
  }
  while (facts.length < 3) facts.push(`${rows.length} rows from ${periodLabel(result.period)}.`);
  return { caption, facts: facts.slice(0, 3) };
}
