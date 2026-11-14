import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getReceipt, listOrders } from '@/db/repo';
import { getAimoContext, type AimoContext } from '../context';
import { audit, emitterFor, type Emit } from '../events';
import type { CheckInEntry } from '../agents/history';
import { defaultSpecialists, type Specialists } from '../specialists';

/** Shortfall assumed when the buyer says a line ran out without saying how much: 5% of ordered, to the nearest 0.5. */
export const defaultShortfall = (ordered: number) => Math.max(0.5, Math.round(ordered * 0.05 * 2) / 2);

/** One parsed entry as a signed leftover: + left over, − short, 0 used up. */
export function toLeftoverQty(entry: CheckInEntry, ordered: number): number {
  const amount = entry.amount !== null && Number.isFinite(entry.amount) ? Math.abs(entry.amount) : null;
  if (entry.status === 'short') return -(amount || defaultShortfall(ordered));
  if (entry.status === 'left') return amount ?? 0;
  return 0;
}

/** Parses the reply into leftover numbers per line and shows them back; saving happens in the UI via /api/checkin. */
export async function runCheckIn(
  { ctx, orderId: requested, reply }: { ctx: AimoContext; orderId?: string; reply: string },
  { specialists, emit }: { specialists: Specialists; emit: Emit },
) {
  // Without an id, the check-in is for the latest order still waiting for one.
  const orderId = requested ?? listOrders(ctx.customerId).find((o) => !o.checkInDone)?.orderId;
  const receipt = orderId ? getReceipt(orderId) : null;
  if (!orderId || !receipt) throw new Error(requested ? `Order ${requested} was not found.` : 'No order is waiting for a check-in.');
  const lines = receipt.lines.map((l) => ({ lineId: l.lineId, productName: l.productName, quantity: l.quantity, unit: l.unit }));
  const parsed = await specialists.parseCheckIn({ reply, lines });
  const byLine = new Map(parsed.map((e) => [e.lineId, e]));
  const entries = lines.map((l) => {
    const e = byLine.get(l.lineId);
    return { lineId: l.lineId, leftoverQty: e ? toLeftoverQty(e, l.quantity) : 0 };
  });

  await emit({
    type: 'data-checkin',
    data: { orderId, eventName: receipt.eventName, lines: lines.map((l, i) => ({ ...l, leftoverQty: entries[i].leftoverQty })) },
  });
  audit(ctx.conversationId, 'history', 'checkIn',
    `Parsed check-in for ${orderId}: ${entries.filter((e) => e.leftoverQty !== 0).length} lines with leftovers or shortfalls`,
    { orderId, entries });
  return { orderId, entries };
}

export function createCheckInTool(specialists: Specialists = defaultSpecialists) {
  return createTool({
    id: 'checkIn',
    description:
      'History specialist. Turns the buyer\'s free-text reply about how an event went ("5 kg chicken left, rice ran out") into leftover numbers per order line ("ran out" = short; without an amount a small default shortfall is shown) ' +
      'and shows them back as an editable table. Nothing is saved until the buyer confirms in the table.',
    inputSchema: z.object({ orderId: z.string().optional().describe('Omit to use the latest order awaiting check-in'), reply: z.string().describe("The buyer's reply, verbatim") }),
    outputSchema: z.object({
      orderId: z.string(),
      entries: z.array(z.object({ lineId: z.string(), leftoverQty: z.number() })),
    }),
    execute: async ({ orderId, reply }, context) =>
      runCheckIn({ ctx: getAimoContext(context.requestContext), orderId, reply }, { specialists, emit: emitterFor(context.writer) }),
  });
}
