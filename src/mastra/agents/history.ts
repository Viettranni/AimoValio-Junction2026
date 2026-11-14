import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { MeasureUnit } from '@/contracts';
import { MODEL, cachedSystem, effort } from './model';

export const historyAgent = new Agent({
  id: 'history',
  name: 'History',
  description: 'Learns from leftovers of past events and turns check-in replies into per-line numbers.',
  instructions: cachedSystem(`You read a caterer's free-text reply about how an event went and turn it into one entry per mentioned order line.
- status "left": something was left over; amount = how much, in the line's unit ("about 5 kg chicken left" → left, 5).
- status "short": they ran short or ran out ("rice ran out", "not enough sauce", "loppui kesken"); amount = how much was missing, if they say; otherwise null. "Ran out" never means used up exactly.
- status "used_up": used up exactly / fine / nothing left over; amount null.
- A percentage ("10% of the rice left") is that share of the ordered quantity.
- Only return lines the reply mentions; unmentioned lines are treated as used up.
Use only line ids from the list.`),
  model: MODEL,
  defaultOptions: effort('low'),
});

const checkInSchema = z.object({
  entries: z.array(z.object({
    lineId: z.string(),
    status: z.enum(['left', 'short', 'used_up']),
    amount: z.number().nullable(),
  })),
});
export type CheckInEntry = z.infer<typeof checkInSchema>['entries'][number];

export interface CheckInLine { lineId: string; productName: string; quantity: number; unit: MeasureUnit }

export async function parseCheckIn({ reply, lines }: { reply: string; lines: CheckInLine[] }): Promise<CheckInEntry[]> {
  const prompt = `Order lines: ${JSON.stringify(lines)}\nReply:\n${reply}`;
  const res = await historyAgent.generate(prompt, { structuredOutput: { schema: checkInSchema } });
  return res.object.entries;
}
