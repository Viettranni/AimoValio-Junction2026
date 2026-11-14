// Planning from the buyer's calendar: the agent reads the calendar with its own connector (e.g. Claude's Google
// Calendar) and passes the events, or gives an iCal feed. See src/server/calendar.ts.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { agentFor } from '../identity';
import { fetchableUrl } from './documents';
import { ToolError } from './safe';

export const planFromCalendarTool = createTool({
  id: 'planFromCalendar',
  description:
    "Plan orders for the buyer's upcoming events from their calendar. Read the calendar with your own calendar tool and pass the events " +
    '(title, start, description, location), or pass icsText / icsUrl (an iCal feed). Each food event in the window comes back with what is known ' +
    '(guests, menu, diets), the missing details and questions to ask, any order already placed for that date (status already_ordered: do not ' +
    'order again), urgency (≤ 3 days), and planEventArgs. Non-food events are marked not_food. Then ask the questions and call planEvent per event. ' +
    'Takes about 5 s per 4 events.',
  inputSchema: z.object({
    events: z.array(z.object({
      title: z.string().max(200),
      start: z.string().describe('YYYY-MM-DD or ISO date-time'),
      description: z.string().max(4000).optional(),
      location: z.string().max(200).optional(),
    })).max(200).optional(),
    icsText: z.string().max(500_000).optional(),
    icsUrl: z.string().max(2000).optional().describe('Public https iCal feed, e.g. a calendar\'s secret .ics address'),
    horizonDays: z.number().int().min(1).max(365).optional().describe('How far ahead to look; default 60'),
  }),
  mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true } },
  execute: async ({ events, icsText, icsUrl, horizonDays }, context) => {
    if ([events, icsText, icsUrl].filter((x) => x !== undefined && x !== '').length !== 1) {
      throw new ToolError('Give exactly one of events, icsText or icsUrl.');
    }
    const { parseIcs, planFromCalendar } = await import('@/server/calendar');
    const { now } = await import('@/db/repo');
    let list = events ?? [];
    if (icsText) list = parseIcs(icsText);
    if (icsUrl) {
      const res = await fetch(fetchableUrl(icsUrl), { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new ToolError(`Could not download the calendar (HTTP ${res.status}).`);
      list = parseIcs((await res.text()).slice(0, 5_000_000));
    }
    return planFromCalendar(list, { customerId: agentFor(context).customerId, today: now().toISOString().slice(0, 10), horizonDays });
  },
});

export const calendarTools = [planFromCalendarTool] as const;
