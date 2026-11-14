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

/**
 * The first delivery date after `requestedDate` on which every product can be delivered (Valio's earliest date)
 * and whose order cut-off (effectiveCutoff) is still ahead of `now`. Sundays are skipped. Null when no
 * availability is known or nothing fits within 60 days.
 */
export function nextOrderableDate(availabilities: AvailabilityInfo[], requestedDate: ISODate, now: Date): ISODate | null {
  const known = availabilities.filter((a) => a.deliverable && !a.salesBlock);
  if (!known.length) return null;
  for (let day = dayNumber(requestedDate) + 1; day < dayNumber(requestedDate) + 60; day++) {
    if (new Date(day * DAY_MS).getUTCDay() === 0) continue;
    const date = fromDayNumber(day);
    const ok = known.every((a) => {
      if (!deliverableOn(a, date)) return false;
      const cutoff = effectiveCutoff(a, date);
      return !cutoff || Date.parse(cutoff) > now.getTime();
    });
    if (ok) return date;
  }
  return null;
}
