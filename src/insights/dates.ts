// Calendar helpers on ISO dates (YYYY-MM-DD), in UTC, matching Python's `date` and strftime as the source uses them.

import { WEEKDAYS_FI } from './fi';

const DAY_MS = 86_400_000;

export interface Ymd { year: number; month: number; day: number }

export function parseIso(iso: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: ${iso}`);
  const ymd = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (toIso(fromYmd(ymd)) !== iso) throw new RangeError(`Not a real date: ${iso}`);
  return ymd;
}

function fromYmd({ year, month, day }: Ymd): Date {
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d;
}

function toIso(d: Date): string {
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function isoOf(ymd: Ymd): string {
  return toIso(fromYmd(ymd));
}

export function addDays({ iso, days }: { iso: string; days: number }): string {
  return toIso(new Date(fromYmd(parseIso(iso)).getTime() + days * DAY_MS));
}

/** Whole days from a to b (b - a). */
export function daysBetween({ from, to }: { from: string; to: string }): number {
  return Math.round((fromYmd(parseIso(to)).getTime() - fromYmd(parseIso(from)).getTime()) / DAY_MS);
}

/** Monday = 0 … Sunday = 6, like Python's date.weekday(). */
export function weekday(iso: string): number {
  return (fromYmd(parseIso(iso)).getUTCDay() + 6) % 7;
}

/** The Finnish short weekday name (ma, ti, ke, to, pe, la, su). */
export function weekdayName(iso: string): string {
  return WEEKDAYS_FI[weekday(iso)];
}

/** strftime('%Y-W%W'): weeks start on Monday; days before the year's first Monday are week 00. */
export function weekLabel(iso: string): string {
  const { year } = parseIso(iso);
  const yday = daysBetween({ from: `${String(year).padStart(4, '0')}-01-01`, to: iso });
  const w = Math.floor((yday + 7 - weekday(iso)) / 7);
  return `${year}-W${String(w).padStart(2, '0')}`;
}

/** date.fromisocalendar(year, week, 1): the Monday of ISO week `week`. */
export function isoWeekMonday({ year, week }: { year: number; week: number }): string {
  const jan4 = isoOf({ year, month: 1, day: 4 });
  const week1Monday = addDays({ iso: jan4, days: -weekday(jan4) });
  return addDays({ iso: week1Monday, days: (week - 1) * 7 });
}

/** date.replace(year=…): Feb 29 has no counterpart and raises, as in Python. */
export function withYear({ iso, year }: { iso: string; year: number }): string {
  const { month, day } = parseIso(iso);
  return isoOf(parseIso(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`));
}
