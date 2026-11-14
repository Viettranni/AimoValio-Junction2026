// The buyer's order history in the chat: "what did we order for midsummer?", "same as the 19 June order, for 100
// guests on 12 Dec". findPastOrders looks orders up; draftFromPastOrder puts the same products on a new draft,
// scaled to the new guest count and corrected by what was left over (or ran short) last time.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { EventType, Receipt } from '@/contracts';
import { getProduct } from '@/catalog';
import { getReceipt, listLeftoverRecords, listOrders } from '@/db/repo';
import { getAimoContext, type AimoContext } from '../context';
import { emitterFor, type Emit } from '../events';
import { runDirectOrder } from './direct-order';

const round2 = (n: number) => Math.round(n * 100) / 100;
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);

export const findPastOrdersSchema = z.object({
  date: z.string().optional().describe('YYYY-MM-DD of the past event, when the buyer names a date ("last Fri 19 June" → that date)'),
  query: z.string().optional().describe('Words from the event name or type, e.g. "midsummer", "juhannus", "wedding"'),
  limit: z.number().int().min(1).max(20).optional(),
});

/** Past orders of this customer, newest first; by date (± 1 day) and/or name words. Details for up to 3 matches. */
export function findPastOrders(input: z.infer<typeof findPastOrdersSchema>, ctx: Pick<AimoContext, 'customerId'>) {
  const all = listOrders(ctx.customerId);
  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 86_400_000;
  const wanted = input.query ? words(input.query) : [];
  const matches = all.filter((o) => {
    if (input.date && !near(o.eventDate, input.date)) return false;
    if (wanted.length) {
      const name = o.eventName.toLowerCase();
      if (!wanted.some((w) => name.includes(w.slice(0, Math.max(4, w.length - 2))))) return false;
    }
    return true;
  }).slice(0, input.limit ?? 10);
  const left = listLeftoverRecords(ctx.customerId);
  const detail = matches.length <= 3;
  return {
    total: all.length,
    orders: matches.map((o) => {
      const receipt = detail ? getReceipt(o.orderId) : null;
      return {
        orderId: o.orderId, eventName: o.eventName, date: o.eventDate, weekday: weekday(o.eventDate), guests: o.guests,
        totalExclVat: o.total,
        leftover: o.leftoverRatio === null ? 'no check-in' : `${Math.round(o.leftoverRatio * 100)}% left over`,
        ...(receipt ? {
          lines: receipt.lines.map((l) => {
            const rec = left.find((r) => r.orderId === o.orderId && r.lineId === l.lineId);
            return {
              product: l.productName, quantity: `${round2(l.quantity)} ${l.unit}`, packs: l.packs,
              ...(rec && rec.leftoverQty !== 0 ? { afterEvent: rec.leftoverQty > 0 ? `${round2(rec.leftoverQty)} ${rec.unit} left over` : `${round2(-rec.leftoverQty)} ${rec.unit} short` } : {}),
            };
          }),
        } : {}),
      };
    }),
    note: matches.length ? undefined : 'No order matches; list recent ones without filters, or ask the buyer.',
  };
}

export const draftFromPastOrderSchema = z.object({
  orderId: z.string().describe('From findPastOrders'),
  deliveryDate: z.string().describe('YYYY-MM-DD of the NEW delivery'),
  guests: z.number().int().min(1).max(5000).optional().describe('New guest count; default the same as last time'),
  useLeftovers: z.boolean().optional().describe('Correct amounts by what was left over or ran short last time (default true)'),
  lang: z.string().describe("Language of the buyer's latest message"),
  replaceExisting: z.boolean().optional().describe('True only when the buyer wants this instead of the open draft'),
});

export interface ReorderLine { productId: string; productName: string; unit: string; was: number; now: number; why: string | null }

/** New amounts per line: scaled to the guest count, then corrected by last time's leftovers (+) or shortfalls (−). */
export function reorderAmounts(receipt: Receipt, guests: number, leftovers: Map<string, number>, useLeftovers: boolean): ReorderLine[] {
  const scale = guests / receipt.guests;
  return receipt.lines.map((l) => {
    const left = useLeftovers ? (leftovers.get(l.lineId) ?? 0) : 0;
    const used = Math.max(l.quantity - left, l.quantity * 0.25);
    const now = round2(used * scale);
    const why = [
      scale !== 1 ? `${receipt.guests} → ${guests} guests` : null,
      left > 0 ? `${round2(left)} ${l.unit} was left over` : left < 0 ? `ran ${round2(-left)} ${l.unit} short` : null,
    ].filter(Boolean).join('; ') || null;
    return { productId: l.productId, productName: l.productName, unit: l.unit, was: round2(l.quantity), now, why };
  });
}

export async function runDraftFromPastOrder(input: z.infer<typeof draftFromPastOrderSchema>, ctx: AimoContext, emit: Emit) {
  const receipt = getReceipt(input.orderId);
  if (!receipt || receipt.customerId !== ctx.customerId) throw new Error(`No past order ${input.orderId}; use findPastOrders`);
  const guests = input.guests ?? receipt.guests;
  const leftovers = new Map(listLeftoverRecords(ctx.customerId).filter((r) => r.orderId === receipt.orderId).map((r) => [r.lineId, r.leftoverQty]));
  const lines = reorderAmounts(receipt, guests, leftovers, input.useLeftovers ?? true);
  const items = lines.map((l) => {
    const p = getProduct(l.productId);
    // Amounts are in the product's own unit; anything else is ordered by packs, scaled the same way.
    if (p && p.packUnit === l.unit) return { productId: l.productId, quantity: l.now, unit: l.unit as 'kg' | 'l' | 'pcs' };
    const old = receipt.lines.find((x) => x.productId === l.productId)!;
    return { productId: l.productId, quantity: Math.max(1, Math.ceil((old.packs * l.now) / Math.max(l.was, 1e-9))), unit: 'packs' as const };
  });
  const result = await runDirectOrder({
    deliveryDate: input.deliveryDate, items, title: receipt.eventName, lang: input.lang, replaceExisting: input.replaceExisting,
  }, ctx, emit, { guests, eventType: receipt.eventType as EventType, eventName: receipt.eventName });
  return {
    basedOn: { orderId: receipt.orderId, eventName: receipt.eventName, date: receipt.deliveryDate, guests: receipt.guests, totalExclVat: receipt.total },
    changes: lines.filter((l) => l.why).map((l) => `${l.productName}: ${l.was} → ${l.now} ${l.unit} (${l.why})`),
    ...result,
  };
}

export function createHistoryTools() {
  return {
    findPastOrders: createTool({
      id: 'findPastOrders',
      description:
        "Look up this customer's past orders (the same list as My orders): by the event's date and/or words from its name. " +
        'Returns order id, event, date, guests, total and how much was left over; for up to 3 matches also every line with what was left over or short. ' +
        'Use it whenever the buyer refers to a past event or order, or asks what they ordered before.',
      inputSchema: findPastOrdersSchema,
      execute: async (input, context) => findPastOrders(input, getAimoContext(context.requestContext)),
    }),
    draftFromPastOrder: createTool({
      id: 'draftFromPastOrder',
      description:
        'Put the products of a past order on a new draft for a new delivery date: scaled to the new guest count and, by default, corrected by ' +
        'what was left over or ran short last time. Live prices and stock for the new date; the sheet opens by itself. Returns what changed, ' +
        'the lines, total, problems and the approval it needs.',
      inputSchema: draftFromPastOrderSchema,
      execute: async (input, context) => runDraftFromPastOrder(input, getAimoContext(context.requestContext), emitterFor(context.writer)),
    }),
  };
}
