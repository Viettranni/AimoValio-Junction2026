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

export const orderTools = [placeOrderTool, getOrderStatusTool];
