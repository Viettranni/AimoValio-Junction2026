import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { MeasureUnit } from '@/contracts';
import { MODEL, cachedSystem, effort } from './model';

export const historyAgent = new Agent({
  id: 'history',
  name: 'History',
  description: 'Learns from leftovers of past events and turns check-in replies into per-line numbers.',
  instructions: cachedSystem(`You read a caterer's free-text reply about how an event went and turn it into leftover numbers per order line.
- leftoverQty is in the line's unit: positive = left over, negative = ran short, 0 = used up / fine.
- "about 5 kg chicken left" → +5 on the chicken line. "rice ran out" → a small negative only if they say how much short; otherwise 0.
- A percentage ("10% of the rice left") is that share of the ordered quantity.
- Only return lines the reply mentions; unmentioned lines are treated as used up.
Use only line ids from the list.`),
  model: MODEL,
  defaultOptions: effort('low'),
});

const checkInSchema = z.object({ entries: z.array(z.object({ lineId: z.string(), leftoverQty: z.number() })) });

export interface CheckInLine { lineId: string; productName: string; quantity: number; unit: MeasureUnit }

export async function parseCheckIn(
  { reply, lines }: { reply: string; lines: CheckInLine[] },
): Promise<Array<{ lineId: string; leftoverQty: number }>> {
  const prompt = `Order lines: ${JSON.stringify(lines)}\nReply:\n${reply}`;
  const res = await historyAgent.generate(prompt, { structuredOutput: { schema: checkInSchema } });
  return res.object.entries;
}
