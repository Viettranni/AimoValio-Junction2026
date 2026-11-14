export const eur = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Number(v).toLocaleString('fi-FI', { maximumFractionDigits: 0 })} €`);

export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export const pct = ({ v, digits }: { v: number | null; digits: number }) => (v === null ? '–' : `${v.toFixed(digits).replace('.', ',')} %`);

/** Polyline points for a sparkline of `values` in a w×h box. */
export function sparkPoints({ values, w, h }: { values: number[]; w: number; h: number }): Array<[number, number]> {
  const max = Math.max(...values);
  const min = Math.min(...values);
  return values.map((v, i) => [(i * (w - 4)) / (values.length - 1) + 2, h - 3 - ((v - min) / (max - min || 1)) * (h - 8)]);
}
