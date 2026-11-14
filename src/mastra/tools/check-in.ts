import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getReceipt, listOrders } from '@/db/repo';
import { getAimoContext, type AimoContext } from '../context';
import { audit, emitterFor, type Emit } from '../events';
import { defaultSpecialists, type Specialists } from '../specialists';

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
  const byLine = new Map(parsed.filter((e) => Number.isFinite(e.leftoverQty)).map((e) => [e.lineId, e.leftoverQty]));
  const entries = lines.map((l) => ({ lineId: l.lineId, leftoverQty: byLine.get(l.lineId) ?? 0 }));

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
      'History specialist. Turns the buyer\'s free-text reply about how an event went ("5 kg chicken left, rice ran out") into leftover numbers per order line ' +
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
