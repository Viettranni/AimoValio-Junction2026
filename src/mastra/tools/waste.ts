// Food waste in the chat: "we threw away 3 kg of rice" is logged through the same gateway service as Claude's
// logWaste over MCP (src/gateway/waste.ts), as the widget's own gateway identity.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { widgetAgent } from '@/gateway/agents';
import { getWasteReport, logWaste, WASTE_REASONS } from '@/gateway/waste';
import { getAimoContext } from '../context';
import { audit } from '../events';

export const logWasteChatTool = createTool({
  id: 'logWaste',
  description:
    'Log food the kitchen threw away (hävikki) when the buyer says so, e.g. "heitettiin 3 kg riisiä ja 5 l maitoa, vanhentunut". ' +
    'One entry per product: name in the buyer\'s words, quantity, unit and reason. Returns the matched products, their value and CO₂.',
  inputSchema: z.object({
    entries: z.array(z.object({
      name: z.string().describe("What was thrown away, in the buyer's words"),
      quantity: z.number().positive(),
      unit: z.enum(['kg', 'l', 'pcs', 'packs']),
      reason: z.enum(WASTE_REASONS).describe('expired, spoiled, overproduction (cooked, not served), plate_waste (served, not eaten), damaged, other'),
    })).min(1).max(20),
    date: z.string().optional().describe('YYYY-MM-DD when not today ("yesterday" → resolve against today)'),
  }),
  execute: async (input, context) => {
    const { conversationId } = getAimoContext(context.requestContext);
    const r = logWaste(input, { agent: widgetAgent() });
    audit(conversationId, 'orchestrator', 'logWaste', `Logged ${r.logged.length} waste entries (≈ €${r.totals.valueEur})`);
    return {
      logged: r.logged.map((e) => ({ product: e.productName, quantity: e.quantity, unit: e.unit, reason: e.reason, valueEur: e.valueEur })),
      totals: r.totals,
      unmatched: r.unmatched,
    };
  },
});

export const wasteReportChatTool = createTool({
  id: 'wasteReport',
  description: 'How much food went to waste (logged waste and leftovers after events), its € value and CO₂, what is wasted most, with insights. Default the last 90 days.',
  inputSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
  execute: async (input) => getWasteReport(input, { agent: widgetAgent() }),
});
