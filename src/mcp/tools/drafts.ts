// The widget's event flow for agents: plan an event, edit the draft, check it out. Same pipeline, rules and storage.
// The service module is loaded on first use, so catalogue-only callers keep a fast server start.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { agentFor } from '../identity';
import { allergenSchema, dietFlagSchema, eventTypeSchema, portionCategorySchema } from '../schemas';
import { isoDate, requirementsSchema } from './requirements';

const service = () => import('@/gateway/drafts');
const preferencesSchema = z.object({
  allowSubstitutes: z.boolean().optional().describe('The buyer pre-approved substitute lines'),
  latestDeliveryDate: isoDate.optional(),
}).optional();

export const planEventTool = createTool({
  id: 'planEvent',
  description:
    'Plan an event order the way the Aimo widget does: menu → products → allergen checks per diet group → live Valio prices and stock → ' +
    'corrections from this customer\'s past leftovers (history notes) → a priced draft. Takes 10–40 s (the menu and product planners are AI). ' +
    'Returns draftId, lines (packs, prices, tags such as substitute / allergens_unknown / may_deliver_short, history notes to accept or not), totals, cut-off and exceptions. ' +
    'Nothing is ordered: edit with updateDraft, order with checkoutDraft.',
  inputSchema: z.object({
    deliveryDate: isoDate,
    guests: z.number().int().min(1).max(5000),
    menu: z.array(z.string().min(1)).min(1).max(20).describe('Dishes in any language, e.g. ["chicken", "rice"]'),
    diets: z.array(z.object({
      diet: z.union([dietFlagSchema, allergenSchema]).describe('A diet (gluten_free, lactose_free, vegan, vegetarian) or an allergen to avoid (e.g. "nuts")'),
      guests: z.number().int().min(1),
    })).optional().describe('Diet groups, e.g. [{ diet: "gluten_free", guests: 12 }]'),
    budget: z.union([z.number().positive(), z.literal('none')]).optional().describe('EUR excl. VAT'),
    addons: z.array(z.string()).optional().describe('Extras, e.g. ["Salad", "Bread & butter", "Coffee & tea"]'),
    eventType: eventTypeSchema.optional(),
    eventName: z.string().max(80).optional(),
    lang: z.string().max(10).optional().describe('Language for product names and reasons, e.g. "en", "fi"'),
  }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  execute: async (input, context) => (await service()).planEvent(input, { agent: agentFor(context) }),
});

export const getDraftTool = createTool({
  id: 'getDraft',
  description: 'Read a draft from planEvent or chatWithAimo: lines, prices, tags, history notes, totals, cut-off.',
  inputSchema: z.object({ draftId: z.string() }),
  mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  execute: async ({ draftId }, context) => (await service()).getDraft(draftId, { agent: agentFor(context) }),
});

const change = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('setPacks'), lineId: z.string(), packs: z.number().int().min(0) }),
  z.object({ kind: z.literal('removeLine'), lineId: z.string() }),
  z.object({ kind: z.literal('historyChoice'), lineId: z.string(), choice: z.enum(['history', 'suggested']).describe('history = use the amount past events suggest') }),
  z.object({ kind: z.literal('scaleGuests'), guests: z.number().int().min(1).max(5000) }),
  z.object({ kind: z.literal('swapProduct'), lineId: z.string(), productId: z.string().describe('Must be the same kind of product and meet the line\'s diets') }),
  z.object({
    kind: z.literal('addProduct'), productId: z.string(),
    packs: z.number().int().min(1).optional(), quantity: z.number().positive().optional().describe('Net amount in the product\'s unit (kg / l / pcs)'),
    componentLabel: z.string().max(60).optional(), category: portionCategorySchema.optional(),
  }).describe('Same kind as a dish that is still short → covers the rest of it; otherwise a new item (give packs or quantity)'),
]);

export const updateDraftTool = createTool({
  id: 'updateDraft',
  description:
    'Change a draft exactly as you say, all changes or none: setPacks, removeLine, historyChoice (accept or decline a history note), scaleGuests, ' +
    'swapProduct (validated: same kind, meets the diets, fresh Valio price, deliverable on the date) and addProduct. Prices come from Valio; there is no price input. ' +
    'Returns the updated draft, the diff and stock problems.',
  inputSchema: z.object({ draftId: z.string(), changes: z.array(change).min(1).max(50) }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  execute: async ({ draftId, changes }, context) => (await service()).updateDraft(draftId, changes, { agent: agentFor(context) }),
});

export const checkoutDraftTool = createTool({
  id: 'checkoutDraft',
  description:
    'Order a draft: its lines become a fixed-price offer from fresh Valio prices, then the same placeOrder rules apply. Returns "ordered" (receipt; simulated order), ' +
    '"pending_approval" (approver and reasons; lines with unverified allergens always need a human), "requote" (Valio prices changed since the draft: the draft now has the new prices, call again), ' +
    'or "not_orderable". Pending history notes are fine: the draft\'s pack counts are ordered.',
  inputSchema: z.object({ draftId: z.string(), requirements: requirementsSchema.optional(), preferences: preferencesSchema }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  execute: async (input, context) => (await service()).checkoutDraft(input, { agent: agentFor(context) }),
});

export const draftTools = [planEventTool, getDraftTool, updateDraftTool, checkoutDraftTool];
