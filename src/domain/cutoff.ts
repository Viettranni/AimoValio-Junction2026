import type { AvailabilityInfo, ISODate } from '@/contracts';

const DAY_MS = 86_400_000;
const dayNumber = (d: ISODate) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;
const fromDayNumber = (n: number): ISODate => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** True when the product can be delivered on the requested date (not later). */
export function deliverableOn(a: AvailabilityInfo, requestedDate: ISODate): boolean {
  return a.deliverable && !a.salesBlock && (!a.availableDate || a.availableDate <= requestedDate);
}

/**
 * Order cut-off for delivery on `requestedDate`. Valio's closingTime is the cut-off for the
 * EARLIEST delivery (availableDate); a later delivery keeps the same lead time, so its cut-off
 * moves by the same number of days, at the same clock time and offset.
 * When the product only arrives after the requested date, the earliest cut-off is returned
 * (the line is not deliverable on time; see deliverableOn).
 */
export function effectiveCutoff(a: AvailabilityInfo, requestedDate: ISODate): string | null {
  const { closingTime, availableDate } = a;
  if (!closingTime || !availableDate) return null;
  if (availableDate >= requestedDate) return closingTime;
  const leadDays = dayNumber(availableDate) - dayNumber(closingTime.slice(0, 10));
  return `${fromDayNumber(dayNumber(requestedDate) - leadDays)}${closingTime.slice(10)}`;
}
