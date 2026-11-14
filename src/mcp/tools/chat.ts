// The Aimo orchestrator itself as an MCP tool, so Claude / ChatGPT users can plan an event order by chatting.
import { randomUUID } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import type { Draft } from '@/contracts';
import { getDraftByConversation, now as clockNow } from '@/db/repo';
import { GatewayError } from '@/gateway/offers';
import { getChat, saveChat } from '@/gateway/store';
import { agentFor } from '../identity';

const ISSUE_TAGS = new Set(['unavailable', 'allergens_unknown', 'may_deliver_short', 'substitute']);

/** Compact view of the planning draft: enough for the caller to show it, or to requestOffer with the same lines. */
export function draftSummary(d: Draft | null) {
  if (!d) return null;
  const issues = d.lines.flatMap((l) => [
    ...l.tags.filter((t) => ISSUE_TAGS.has(t)).map((t) => `${l.productName}: ${t.replace(/_/g, ' ')}${l.substituteFor ? ` (${l.substituteFor.reason})` : ''}`),
    ...(l.history?.choice === 'pending' ? [`${l.productName}: past events suggest ${l.history.historyPacks} instead of ${l.history.suggestedPacks} packs`] : []),
  ]);
  if (d.totals.overBudget) issues.push(`over budget (${d.totals.budget} EUR)`);
  return {
    status: d.status,
    deliveryDate: d.intake.deliveryDate ?? null,
    guests: d.intake.guests ?? null,
    lines: d.lines.map((l) => ({ productId: l.productId, productName: l.productName, packs: l.packs, packDescription: l.packDescription, unitPrice: l.unitPrice })),
    totals: { low: d.totals.low, high: d.totals.high, lowWithTax: d.totals.lowWithTax, highWithTax: d.totals.highWithTax, currency: 'EUR', note: 'excl. VAT unless "WithTax"' },
    cutoff: d.cutoff,
    openIssues: issues,
    toOrder: 'Call requestOffer with these productIds and packs (unit "packs") and the delivery date, then placeOrder.',
  };
}

export const chatWithAimoTool = createTool({
  id: 'chatWithAimo',
  description:
    'Talk to Aimo, Valio Aimo\'s ordering assistant, in any language: describe an event ("wedding 6 Dec, 120 guests, salmon and potatoes, 10 gluten-free") ' +
    'and Aimo plans a priced, stock-checked order draft, asks for anything missing and takes edits ("make it 140 guests"). ' +
    'Pass the returned conversationId to continue. Returns Aimo\'s reply and a compact draft summary. Chatting never orders anything: ' +
    'to order, call requestOffer with the draft lines, then placeOrder.',
  inputSchema: z.object({
    message: z.string().min(1).max(4000),
    conversationId: z.string().max(100).optional().describe('From a previous chatWithAimo result; omit to start a new conversation'),
  }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  execute: async ({ message, conversationId: given }, context) => {
    const agent = agentFor(context);
    const conversationId = given ?? `mcp-${randomUUID()}`;
    const chat = getChat(conversationId) ?? { customerId: agent.customerId, agentId: agent.agentId, messages: [] };
    if (chat.customerId !== agent.customerId) throw new GatewayError(`No conversation ${conversationId}`, 'not_found');

    const requestContext = new RequestContext();
    requestContext.set('conversationId', conversationId);
    requestContext.set('customerId', agent.customerId);
    // Loaded on first use: keeps the MCP server's start-up fast for catalogue-only callers.
    const { mastra } = await import('@/mastra');
    const messages = [...chat.messages, { role: 'user' as const, content: message }];
    const input = messages.map((m) => (m.role === 'user' ? { role: 'user' as const, content: m.content } : { role: 'assistant' as const, content: m.content }));
    const result = await mastra.getAgent('orchestrator').generate(input, { requestContext });
    const reply = result.text.trim();
    saveChat(conversationId, { ...chat, messages: [...messages, { role: 'assistant', content: reply }] }, clockNow().toISOString());
    return { conversationId, reply, draft: draftSummary(getDraftByConversation(conversationId)) };
  },
});

export const chatTools = [chatWithAimoTool];
