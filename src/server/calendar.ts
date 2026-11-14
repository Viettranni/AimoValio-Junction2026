// Planning from the buyer's calendar. Aimo never reads a calendar itself: Claude (or any agent) reads it with its own
// calendar connector and passes the events, or the buyer gives an iCal (.ics) feed. Each upcoming event is read like
// the buyer's notes (src/server/document.ts): food events get what is known, what is missing, the questions to ask and
// planEvent arguments; events that already have an order are flagged so nothing is ordered twice.
import { and, eq, gte, lte } from 'drizzle-orm';
import type { IntakeSlot } from '@/contracts';
import { getDb, type Db } from '@/db/client';
import { orders } from '@/db/schema';
import { extractDocument, type DocumentExtraction } from '@/mastra/agents/document';
import { documentQuestions, isShoppingList, missingSlots } from './document';

export interface CalendarEventInput {
  title: string;
  /** YYYY-MM-DD or an ISO date-time; the event's local date is the delivery date. */
  start: string;
  description?: string;
  location?: string;
}

export const MAX_CALENDAR_EVENTS = 25;
const DAY_MS = 86_400_000;

// ── iCal ──

/** Minimal iCalendar reader: VEVENT SUMMARY, DTSTART, DESCRIPTION, LOCATION. Recurring rules are not expanded. */
export function parseIcs(text: string): CalendarEventInput[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
  const out: CalendarEventInput[] = [];
  let cur: Partial<CalendarEventInput> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur?.title && cur.start) out.push(cur as CalendarEventInput);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0].toUpperCase();
    const value = line.slice(i + 1);
    if (key === 'SUMMARY') cur.title = unescape(value);
    else if (key === 'DESCRIPTION') cur.description = unescape(value);
    else if (key === 'LOCATION') cur.location = unescape(value);
    else if (key === 'DTSTART') {
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
      if (m) cur.start = `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  return out;
}

// ── Planning ──

export type CalendarStatus = 'already_ordered' | 'ready_to_plan' | 'needs_info' | 'not_food';

export interface CalendarPlanItem {
  title: string;
  date: string;
  daysUntil: number;
  /** Within 3 days: order cut-offs are close. */
  urgent: boolean;
  status: CalendarStatus;
  guests: number | null;
  menu: string[];
  diets: DocumentExtraction['diets'];
  missing: IntakeSlot[];
  questions: string[];
  existingOrders: Array<{ orderId: string; eventName: string; deliveryDate: string; total: number }>;
  planEventArgs?: Record<string, unknown>;
}

export interface CalendarPlan {
  today: string;
  horizonDays: number;
  /** Events in the window that were read; food events first by date. */
  events: CalendarPlanItem[];
  /** Events outside the window or beyond the limit, not read. */
  skipped: number;
  summary: string;
}

const dateOf = (start: string) => start.slice(0, 10);

/** Runs `fn` over items, at most `n` at a time, keeping the order. */
async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export async function planFromCalendar(
  events: CalendarEventInput[],
  opts: { customerId: string; today: string; horizonDays?: number; db?: Db; read?: typeof extractDocument },
): Promise<CalendarPlan> {
  const db = opts.db ?? getDb();
  const read = opts.read ?? extractDocument;
  const horizonDays = Math.min(Math.max(opts.horizonDays ?? 60, 1), 365);
  const todayMs = Date.parse(`${opts.today}T00:00:00Z`);
  const last = new Date(todayMs + horizonDays * DAY_MS).toISOString().slice(0, 10);
  const inWindow = events
    .filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.start) && dateOf(e.start) >= opts.today && dateOf(e.start) <= last)
    .sort((a, b) => dateOf(a.start).localeCompare(dateOf(b.start)));
  const taken = inWindow.slice(0, MAX_CALENDAR_EVENTS);

  const items = await mapLimit(taken, 4, async (e): Promise<CalendarPlanItem> => {
    const date = dateOf(e.start);
    const text = [`Calendar event: ${e.title}`, `Date: ${date}`, e.location && `Location: ${e.location}`, e.description && `Notes:\n${e.description}`]
      .filter(Boolean).join('\n');
    const x = { ...(await read({ kind: 'text', text, source: 'calendar event' }, opts.today)), deliveryDate: date };
    const daysUntil = Math.round((Date.parse(`${date}T00:00:00Z`) - todayMs) / DAY_MS);
    const near = (d: number) => new Date(Date.parse(`${date}T00:00:00Z`) + d * DAY_MS).toISOString().slice(0, 10);
    const existingOrders = db.select({ orderId: orders.id, eventName: orders.eventName, deliveryDate: orders.deliveryDate, total: orders.total })
      .from(orders).where(and(eq(orders.customerId, opts.customerId), gte(orders.deliveryDate, near(-3)), lte(orders.deliveryDate, date))).all();
    const base = {
      title: e.title, date, daysUntil, urgent: daysUntil <= 3, guests: x.guests, menu: x.items.map((i) => i.name), diets: x.diets, existingOrders,
    };
    if (!x.isFoodEvent) return { ...base, status: 'not_food', missing: [], questions: [] };
    const missing = missingSlots(x);
    const questions = documentQuestions(x);
    const planEventArgs = isShoppingList(x) ? undefined : {
      deliveryDate: date,
      ...(x.guests ? { guests: x.guests } : {}),
      ...(x.items.length ? { menu: x.items.map((i) => i.name) } : {}),
      ...(x.diets.length && x.diets.every((d) => d.guests !== null) ? { diets: x.diets } : {}),
      ...(x.budget !== null ? { budget: x.budget } : {}),
      ...(x.eventType ? { eventType: x.eventType } : {}),
      eventName: x.eventName ?? e.title.slice(0, 80),
      lang: x.lang,
    };
    // Budget and diets can be asked at planning time; guests and menu are needed to plan at all.
    const status: CalendarStatus = existingOrders.length ? 'already_ordered'
      : missing.some((m) => m === 'guests' || m === 'menu') ? 'needs_info' : 'ready_to_plan';
    return { ...base, status, missing, questions, ...(planEventArgs ? { planEventArgs } : {}) };
  });

  const count = (s: CalendarStatus) => items.filter((i) => i.status === s).length;
  const food = items.filter((i) => i.status !== 'not_food');
  const urgent = food.filter((i) => i.urgent && i.status !== 'already_ordered');
  const summary = [
    `${food.length} food ${food.length === 1 ? 'event' : 'events'} in the next ${horizonDays} days`,
    `${count('ready_to_plan')} ready to plan, ${count('needs_info')} need details, ${count('already_ordered')} already ordered`,
    urgent.length ? `urgent (≤ 3 days): ${urgent.map((u) => `${u.title} ${u.date}`).join(', ')}` : '',
  ].filter(Boolean).join('; ') + '.';
  return { today: opts.today, horizonDays, events: [...food, ...items.filter((i) => i.status === 'not_food')], skipped: events.length - taken.length, summary };
}
