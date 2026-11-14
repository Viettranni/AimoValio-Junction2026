// Food waste (hävikki) for agents: log what the kitchen threw away, and see where food and money go unused.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { agentFor } from '../identity';
import { isoDate } from './requirements';

const service = () => import('@/gateway/waste');
const reasons = ['expired', 'spoiled', 'overproduction', 'plate_waste', 'damaged', 'other'] as const;

export const logWasteTool = createTool({
  id: 'logWaste',
  description:
    'Log food the kitchen threw away (hävikki), e.g. "we binned 5 l of milk that expired and 3 kg of leftover rice". ' +
    'Give each item by productId, or by name in any language (matched to this customer\'s past orders first, then the catalogue), ' +
    'with quantity, unit and reason. Returns each entry with the matched product, its value at the price this customer last paid ' +
    '(excl. VAT) and a CO₂ estimate, plus any names that could not be matched. For leftovers per line of a past order, use reportLeftovers.',
  inputSchema: z.object({
    entries: z.array(z.object({
      productId: z.string().optional(),
      name: z.string().max(120).optional().describe('What was thrown away, any language, e.g. "basmatiriisi"'),
      quantity: z.number().positive(),
      unit: z.enum(['kg', 'l', 'pcs', 'packs']),
      reason: z.enum(reasons).describe('expired, spoiled, overproduction (cooked, not served), plate_waste (served, not eaten), damaged, other'),
      note: z.string().max(300).optional(),
    })).min(1).max(50),
    date: isoDate.optional().describe('Day it was thrown away; default today'),
    orderId: z.string().optional().describe('The order the food came from, when known'),
  }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  execute: async (input, context) => (await service()).logWaste(input, { agent: agentFor(context) }),
});

export const getWasteReportTool = createTool({
  id: 'getWasteReport',
  description:
    'Food waste summary for a period (default the last 90 days): logged waste by reason and product with € value and CO₂, ' +
    'food left over after events (from check-ins), and plain-language insights on what to order less of.',
  inputSchema: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
  mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  execute: async (input, context) => (await service()).getWasteReport(input, { agent: agentFor(context) }),
});

export const wasteTools = [logWasteTool, getWasteReportTool] as const;
