/** round(v, places) for display and storage. */
export const round = ({ v, places }: { v: number; places: number }) => Math.round(v * 10 ** places) / 10 ** places;

/** Python's round(x) to a whole number: halves go to the even neighbour. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** A Finnish number: space-grouped thousands, decimal comma (1 234,5). */
export const grouped = ({ v, digits }: { v: number; digits: number }) =>
  v.toLocaleString('fi-FI', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** A Finnish number with a fixed number of decimals, no grouping (7,7). */
export const fixed = ({ v, digits }: { v: number; digits: number }) => v.toFixed(digits).replace('.', ',');
