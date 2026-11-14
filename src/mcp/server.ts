// The Aimo agent gateway as one MCP server: tools from the registry, the policy and playbook as resources,
// and an order-request prompt. Served over stdio (src/mcp/stdio.ts) and Streamable HTTP (src/app/api/mcp/route.ts).
import type { RequestContext } from '@mastra/core/request-context';
import { MCPServer, type MCPServerPrompts, type MCPServerResources } from '@mastra/mcp';
import { POLICY_RULES } from '@/gateway/policies';
import { describePolicy } from '@/gateway/policy';
import { agentFor } from './identity';
import { registryTools } from './registry';

export const PLAYBOOK = `# Aimo agent playbook (Valio Aimo)

You are a purchasing agent buying from Valio Aimo for one customer (your API key decides which).

1. Look up: searchProducts (use requireDiet / excludeAllergens for the buyer's requirements), getProduct, getIngredients, checkAllergens.
2. Price and availability: getPriceAndAvailability(productIds, deliveryDate) gives the fixed price per pack (and per kg for products sold by the kg),
   comparison price per kg/l, whether it can be delivered on the date, stock, the order cut-off and reliability. Pick by price and availability.
3. Commit: requestOffer(deliveryDate, lines, requirements) returns a binding offer at fixed catalogue prices, valid until validUntil
   (15 min, never past the cut-off). Lines that can't be delivered in full stay in the offer with available:false, a reason and
   same-kind alternatives. Nothing is swapped for you: to use an alternative, request a new offer with substituteFor set.
4. Order: placeOrder(offerId, preferences). The gateway re-checks live prices and stock.
   - "requote": the offer expired or something changed. Nothing was ordered; review newOffer and changes, then place newOffer.
   - "ordered": within your authority. The receipt is a simulated order (no real order is sent in this demo).
   - "pending_approval": outside your authority. Tell your user who signs off (approver) and why (reasons); poll getOrderStatus(approvalId).
5. Rules: prices are never negotiated; there is no price input anywhere. You cannot approve an order; only the human approver can,
   on the Aimo approval page. The gateway applies the policy deterministically (getAuthorityPolicy, resource aimo://policy).

Rules that need a human: ${POLICY_RULES.map((r) => r.id).join(', ')}.
`;

function policyText(requestContext: RequestContext) {
  try {
    const agent = agentFor({ requestContext });
    return JSON.stringify({ agent: { agentId: agent.agentId, displayName: agent.displayName }, ...describePolicy(agent.customerId) }, null, 2);
  } catch {
    return JSON.stringify({ error: 'Authenticate with an agent API key to see your customer\'s limits and approver.', rules: POLICY_RULES }, null, 2);
  }
}

const resources: MCPServerResources = {
  listResources: async () => [
    { uri: 'aimo://policy', name: 'Authority policy', description: "Your customer's authority policy: limits, approver, rules (JSON)", mimeType: 'application/json' },
    { uri: 'aimo://playbook', name: 'Agent playbook', description: 'How to go from lookup to offer to order to approval, and the rules', mimeType: 'text/markdown' },
  ],
  getResourceContent: async ({ uri, requestContext }) => {
    if (uri === 'aimo://policy') return { text: policyText(requestContext) };
    if (uri === 'aimo://playbook') return { text: PLAYBOOK };
    throw new Error(`Resource not found: ${uri}`);
  },
};

const prompts: MCPServerPrompts = {
  listPrompts: async () => [{
    name: 'order-request',
    description: 'Buy something from Valio Aimo within your authority, following the playbook',
    arguments: [
      { name: 'need', description: 'What to buy, e.g. "1,000 litres of lactose-free milk"', required: true },
      { name: 'deliveryDate', description: 'Delivery date, YYYY-MM-DD', required: true },
      { name: 'requirements', description: 'Diets or allergens to respect, e.g. "lactose-free"', required: false },
    ],
  }],
  getPromptMessages: async ({ name, args }) => {
    if (name !== 'order-request') throw new Error(`Prompt not found: ${name}`);
    const text = `I need ${args?.need} delivered on ${args?.deliveryDate}.${args?.requirements ? ` Requirements: ${args.requirements}.` : ''}
Find the option that meets our requirements based on price and availability, request an offer and place it.
Follow the Aimo playbook (resource aimo://playbook): searchProducts → getPriceAndAvailability → requestOffer → placeOrder.
If the order needs sign-off, tell me who approves it and why. Never negotiate prices.`;
    return [{ role: 'user', content: { type: 'text', text } }];
  },
};

export const aimoGatewayServer = new MCPServer({
  id: 'aimo-gateway',
  name: 'aimo-gateway',
  title: 'Valio Aimo agent gateway',
  version: '1.0.0',
  description: 'Valio Aimo for purchasing agents: catalogue, live prices and availability, fixed-price offers, orders within authority and human approval.',
  instructions: 'Read resource aimo://playbook first. Flow: searchProducts → getPriceAndAvailability → requestOffer → placeOrder → getOrderStatus. ' +
    'Prices are fixed (no negotiation). Orders outside your authority wait for a human approver; you cannot approve.',
  tools: registryTools(),
  resources,
  prompts,
  // 2025-era clients (an initialize request: Claude Desktop, Cursor, curl examples) are served statelessly over HTTP.
  legacy: 'stateless',
});

// Every request is stateless and the tool, resource and prompt lists never change at runtime, so don't advertise
// list-changed notifications or resource subscriptions (Mastra's defaults) that no client could ever receive.
type Caps = { tools?: object; resources?: object; prompts?: object; [k: string]: unknown };
const server = aimoGatewayServer as unknown as { capabilities?: () => Caps };
const mastraCapabilities = server.capabilities?.bind(aimoGatewayServer);
if (mastraCapabilities) {
  server.capabilities = () => {
    const c = mastraCapabilities();
    return { ...c, tools: {}, ...(c.resources ? { resources: {} } : {}), ...(c.prompts ? { prompts: {} } : {}) };
  };
}
