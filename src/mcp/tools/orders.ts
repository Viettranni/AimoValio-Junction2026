// Commitment: place an offer within the agent's authority, or route it to a human for sign-off.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getOrderStatus, placeOrder } from '@/gateway/orders';
import { agentFor } from '../identity';
import { isoDate } from './requirements';

export const placeOrderTool = createTool({
  id: 'placeOrder',
  description:
    'Place an offer from requestOffer. The gateway re-checks live prices and availability first: if the offer expired or anything changed, ' +
    'nothing is ordered and you get status "requote" with a new offer and the list of changes. Otherwise it applies the customer\'s authority policy ' +
    '(see getAuthorityPolicy): within authority → status "ordered" with a receipt (simulated order); outside it → status "pending_approval" with the ' +
    'approver and reasons; poll getOrderStatus with the approvalId. You cannot approve; only the human approver can.',
  inputSchema: z.object({
    offerId: z.string(),
    preferences: z.object({
      allowSubstitutes: z.boolean().optional().describe('The buyer pre-approved substitute lines (substituteFor)'),
      latestDeliveryDate: isoDate.optional().describe('Latest delivery date the buyer accepts'),
    }).optional(),
  }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  execute: async (input, context) => placeOrder(input, { agent: agentFor(context) }),
});

export const getOrderStatusTool = createTool({
  id: 'getOrderStatus',
  description: 'Status of an order (VA-…), approval (AP-…) or offer (OF-…): ordered, pending_approval, rejected or requote, with the receipt and audit trail.',
  inputSchema: z.object({ id: z.string().describe('Order, approval or offer id') }),
  mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  execute: async ({ id }, context) => getOrderStatus(id, { agent: agentFor(context) }),
});

const drafts = () => import('@/gateway/drafts');

export const listOrdersTool = createTool({
  id: 'listOrders',
  description: "Your customer's orders (newest event first, with leftover ratio once reported) and the approvals still pending.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional().describe('Default 20') }),
  mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  execute: async ({ limit }, context) => (await drafts()).listAgentOrders({ agent: agentFor(context) }, limit),
});

export const getOrderTool = createTool({
  id: 'getOrder',
  description: 'One order: the receipt (lines, totals, delivery date; simulated order) and the leftovers recorded for it.',
  inputSchema: z.object({ orderId: z.string() }),
  mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  execute: async ({ orderId }, context) => (await drafts()).getOrder(orderId, { agent: agentFor(context) }),
});

export const reportLeftoversTool = createTool({
  id: 'reportLeftovers',
  description:
    'After the event, report what was left over (+) or ran short (−) per order line, in the line\'s unit; lines you leave out count as used up. ' +
    'Same as the widget\'s check-in: future planEvent drafts use it for history notes. Only after the delivery date.',
  inputSchema: z.object({
    orderId: z.string(),
    entries: z.array(z.object({ lineId: z.string(), leftoverQty: z.number().describe('+ left over, − short, in the line unit') })).max(200),
    note: z.string().max(300).optional(),
  }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  execute: async (input, context) => (await drafts()).reportLeftovers(input, { agent: agentFor(context) }),
});

export const orderTools = [placeOrderTool, getOrderStatusTool, listOrdersTool, getOrderTool, reportLeftoversTool];
