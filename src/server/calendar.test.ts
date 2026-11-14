import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db/client';
import { resetAndSeed } from '@/db/seed';
import { listOrders } from '@/db/repo';
import type { DocumentContent, DocumentExtraction } from '@/mastra/agents/document';
import { parseIcs, planFromCalendar } from './calendar';

const empty: DocumentExtraction = {
  isFoodEvent: false, lang: 'fi', eventName: null, eventType: null, deliveryDate: null, guests: null, budget: null,
  diets: [], items: [], notes: null, unreadable: [],
};

/** A fake reader: food events say so in the title; "120 hlö" and "kana" are read from the text. */
async function read(content: DocumentContent): Promise<DocumentExtraction> {
  const text = content.kind === 'text' ? content.text : '';
  const food = /häät|lounas|juhla|wedding/i.test(text);
  const guests = /(\d+) hlö/.exec(text);
  return {
    ...empty, isFoodEvent: food, eventName: food ? text.split('\n')[0].replace('Calendar event: ', '') : null,
    guests: guests ? Number(guests[1]) : null,
    items: /kana/.test(text) ? [{ name: 'kana', quantity: null, unit: null }, { name: 'riisi', quantity: null, unit: null }] : [],
    diets: /GF 10/.test(text) ? [{ diet: 'gluten_free', guests: 10 }] : [],
    budget: /budjetti/.test(text) ? 2000 : null,
  };
}

let db: Db;
beforeEach(() => {
  db = createDb(':memory:');
  resetAndSeed(db);
});

describe('calendar planning', () => {
  it('reads VEVENTs from iCal, with folded lines and escapes', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Häät Laaksonen', 'DTSTART;TZID=Europe/Helsinki:20261128T150000',
      'DESCRIPTION:120 hlö\\, kana ja riisi\\nGF 10', ' jatkuu', 'LOCATION:Vanha ylioppilastalo', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Hammaslääkäri', 'DTSTART;VALUE=DATE:20261120', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics)).toEqual([
      { title: 'Häät Laaksonen', start: '2026-11-28', description: '120 hlö, kana ja riisi\nGF 10jatkuu', location: 'Vanha ylioppilastalo' },
      { title: 'Hammaslääkäri', start: '2026-11-20' },
    ]);
  });

  it('plans food events in the window, flags what is missing and skips the rest', async () => {
    const plan = await planFromCalendar([
      { title: 'Hammaslääkäri', start: '2026-11-20T09:00:00+02:00' },
      { title: 'Häät Laaksonen', start: '2026-11-28T15:00:00+02:00', description: '120 hlö, kana ja riisi, GF 10, budjetti' },
      { title: 'Pikkujoulut', start: '2026-12-11', description: 'juhla, menu auki' },
      { title: 'Vanha juhla', start: '2026-10-01', description: '50 hlö' },
      { title: 'Kesäjuhla', start: '2027-06-01', description: '50 hlö' },
    ], { customerId: 'helsinki-juhlapalvelu', today: '2026-11-14', db, read });

    expect(plan.events.map((e) => [e.title, e.status])).toEqual([
      ['Häät Laaksonen', 'ready_to_plan'], ['Pikkujoulut', 'needs_info'], ['Hammaslääkäri', 'not_food'],
    ]);
    expect(plan.skipped).toBe(2);
    const wedding = plan.events[0];
    expect(wedding).toMatchObject({ date: '2026-11-28', daysUntil: 14, urgent: false, guests: 120, missing: [] });
    expect(wedding.planEventArgs).toMatchObject({ deliveryDate: '2026-11-28', guests: 120, menu: ['kana', 'riisi'], budget: 2000 });
    expect(plan.events[1].questions).toContain('How many guests?');
    expect(plan.summary).toMatch(/^2 food events in the next 60 days; 1 ready to plan, 1 need details, 0 already ordered\.$/);
  });

  it('flags an event that already has an order, and urgency', async () => {
    const latest = listOrders('helsinki-juhlapalvelu', db)[0];
    const plan = await planFromCalendar([{ title: 'Häät', start: latest.eventDate, description: '120 hlö kana' }],
      { customerId: 'helsinki-juhlapalvelu', today: latest.eventDate, db, read });
    expect(plan.events[0]).toMatchObject({ status: 'already_ordered', urgent: true, daysUntil: 0 });
    expect(plan.events[0].existingOrders[0].orderId).toBe(latest.orderId);
  });
});
