// The Aimo orchestrator itself as an MCP tool, so Claude / ChatGPT users can plan an event order by chatting.
import { randomUUID } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import type { Draft } from '@/contracts';
import { getDraftByConversation, now as clockNow } from '@/db/repo';
import { GatewayError } from '@/gateway/offers';
import { getChat, saveChat } from '@/gateway/store';
import { buyerFacingText } from '@/mastra/narration';
import { agentFor } from '../identity';

const round2 = (n: number) => Math.round(n * 100) / 100;
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
    totals: { low: round2(d.totals.low), high: round2(d.totals.high), lowWithTax: round2(d.totals.lowWithTax), highWithTax: round2(d.totals.highWithTax), currency: 'EUR', note: 'excl. VAT unless "WithTax"' },
    cutoff: d.cutoff,
    openIssues: issues,
    toOrder: 'Call checkoutDraft with the draftId (or edit it first with updateDraft).',
  };
}

/** Internal conversation ids are namespaced per customer, so an id from one customer never reaches another's chat. */
export const chatConversationId = (customerId: string, id: string) => `mcp:${customerId}:${id}`;

export const chatWithAimoTool = createTool({
  id: 'chatWithAimo',
  description:
    'Talk to Aimo, Valio Aimo\'s ordering assistant, in any language: describe an event ("wedding 6 Dec, 120 guests, salmon and potatoes, 10 gluten-free") ' +
    'and Aimo plans a priced, stock-checked order draft, asks for anything missing and takes edits ("make it 140 guests"). ' +
    'Pass the returned conversationId to continue. Returns Aimo\'s reply, the draftId and a compact draft summary. Chatting never orders anything: ' +
    'to order, call checkoutDraft with the draftId (getDraft / updateDraft work on it too).',
  inputSchema: z.object({
    message: z.string().min(1).max(4000),
    conversationId: z.string().max(100).optional().describe('From a previous chatWithAimo result; omit to start a new conversation'),
  }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  execute: async ({ message, conversationId: given }, context) => {
    const agent = agentFor(context);
    const publicId = given ?? randomUUID();
    const conversationId = chatConversationId(agent.customerId, publicId);
    const existing = getChat(conversationId);
    // Only ids this customer started can be continued; anything else is "not found", never a fresh chat under that id.
    if (given && (!existing || existing.customerId !== agent.customerId)) throw new GatewayError(`No conversation ${given}`, 'not_found');
    const chat = existing ?? { customerId: agent.customerId, agentId: agent.agentId, messages: [] };

    const requestContext = new RequestContext();
    requestContext.set('conversationId', conversationId);
    requestContext.set('customerId', agent.customerId);
    // Loaded on first use: keeps the MCP server's start-up fast for catalogue-only callers.
    const { mastra } = await import('@/mastra');
    const messages = [...chat.messages, { role: 'user' as const, content: message }];
    const input = messages.map((m) => (m.role === 'user' ? { role: 'user' as const, content: m.content } : { role: 'assistant' as const, content: m.content }));
    const result = await mastra.getAgent('orchestrator').generate(input, { requestContext });
    const reply = buyerFacingText(result);
    saveChat(conversationId, { ...chat, messages: [...messages, { role: 'assistant', content: reply }] }, clockNow().toISOString());
    const draft = getDraftByConversation(conversationId);
    return { conversationId: publicId, reply, draftId: draft?.id ?? null, draft: draftSummary(draft) };
  },
});

export const chatTools = [chatWithAimoTool];
