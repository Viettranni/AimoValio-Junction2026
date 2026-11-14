// The Aimo agent gateway as one MCP server: tools from the registry, the policy and playbook as resources,
// and an order-request prompt. Served over stdio (src/mcp/stdio.ts) and Streamable HTTP (src/app/api/mcp/route.ts).
import type { RequestContext } from '@mastra/core/request-context';
import { MCPServer, type MCPServerPrompts, type MCPServerResources } from '@mastra/mcp';
import { POLICY_RULES } from '@/gateway/policies';
import { describePolicy } from '@/gateway/policy';
import { agentFor } from './identity';
import { registryTools } from './registry';

export const PLAYBOOK = `# Aimo agent playbook (Valio Aimo)

You are a purchasing agent buying from Valio Aimo for one customer (your API key decides which). Two ways to buy:

## (a) Direct: you know the products
1. Look up: searchProducts (requireDiet / excludeAllergens for the buyer's requirements), getProduct, getIngredients, checkAllergens.
2. Price and availability: getPriceAndAvailability(productIds, deliveryDate): fixed price per pack (also per kg for products sold by the kg),
   comparison price per kg/l, deliverable on the date, stock, the order cut-off, reliability. Pick by price and availability.
3. Commit: requestOffer(deliveryDate, lines, requirements): a binding offer at fixed catalogue prices, valid until validUntil
   (15 min, never past the cut-off). Short lines stay with available:false, a reason and same-kind alternatives; nothing is swapped
   for you (request a new offer with substituteFor to use one).
4. Order: placeOrder(offerId, preferences).

## (b) Event: you know the occasion, not the products (same as the Aimo widget)
1. planEvent(deliveryDate, guests, menu, diets, budget, addons): Aimo plans menu → products → allergen checks per diet group →
   live prices and stock → history notes from this customer's past leftovers → a priced draft (draftId). 10–40 s.
2. getDraft / updateDraft(draftId, changes): setPacks, removeLine, historyChoice (accept "history" or keep "suggested"), scaleGuests,
   swapProduct (same kind + diets + fresh price/stock), addProduct. chatWithAimo also returns a draftId.
3. checkoutDraft(draftId): the draft becomes a fixed-price offer and goes through placeOrder's rules.
4. Delivery: getDeliveryStatus(orderId): received → confirmed → picking → out_for_delivery (ETA window) → delivered, the supplier
   track for terminal lines, late risk and short-delivered lines with reasons (simulated). getOrder and listOrders include the state.
5. After the event: getOrder(orderId), then reportLeftovers(orderId, entries) so the next plan learns from it. listOrders shows everything.

## (c) The buyer's own notes: a photo, PDF, Excel sheet or CSV
readOrderDocument(text | fileBase64 | fileUrl) reads it into event details and ingredients (amounts only when written), the slots still
missing and questions to ask. Ask them (never guess), then flow (b) with planEventArgs, or flow (a) for a shopping list with amounts.
If you can see the photo or sheet yourself, pass what it says as text.

## (d) Plan from the buyer's calendar
Read their calendar with your own calendar tool (e.g. Google Calendar) for the coming weeks, then planFromCalendar(events) (or icsUrl).
Skip already_ordered and not_food events. Ask the open questions for all events in one go, then planEvent per event, earliest and
urgent ones first, and checkoutDraft when the buyer agrees. The prompt plan-my-calendar walks through it.

## (e) Food waste (hävikki)
logWaste(entries: name or productId, quantity, unit, reason) whenever the buyer says food was thrown away; getWasteReport(from, to)
for the € value, CO₂, what is wasted most and what to order less of. Event leftovers per order line still go to reportLeftovers.

## Outcomes of placeOrder / checkoutDraft
- "ordered": within your authority. The receipt is a simulated order (no real order is sent in this demo).
- "pending_approval": outside your authority. Tell your user who signs off (approver) and why (reasons); poll getOrderStatus(approvalId).
- "requote": the offer expired or a price/stock changed. Nothing was ordered; review the new offer (or the re-priced draft) and go again.
- "not_orderable": nothing in it can be delivered on the date; nothing was ordered and no approval was requested.

## Rules
Prices are never negotiated; there is no price input anywhere. You cannot approve an order; only the human approver can. The gateway
applies the customer's policy deterministically (getAuthorityPolicy, resource aimo://policy), including the customer's default
requirements, and it counts today's orders for the same delivery date together against the limit. Lines whose allergens can't be
verified always go to a human.

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
    name: 'plan-my-calendar',
    description: "Read my calendar for the coming weeks and plan Valio Aimo orders for every food event on it",
    arguments: [
      { name: 'weeks', description: 'How many weeks ahead (default 4)', required: false },
    ],
  }, {
    name: 'order-request',
    description: 'Buy something from Valio Aimo within your authority, following the playbook',
    arguments: [
      { name: 'need', description: 'What to buy ("1,000 litres of lactose-free milk") or the event ("wedding for 300, chicken and rice, 12 gluten-free")', required: true },
      { name: 'deliveryDate', description: 'Delivery date, YYYY-MM-DD', required: true },
      { name: 'requirements', description: 'Diets or allergens to respect, e.g. "lactose-free"', required: false },
    ],
  }],
  getPromptMessages: async ({ name, args }) => {
    if (name === 'plan-my-calendar') {
      const weeks = Math.min(Math.max(Number(args?.weeks) || 4, 1), 26);
      const text = `Plan my catering orders for the next ${weeks} weeks from my calendar.
1. Read my calendar events from today for ${weeks} weeks with your calendar tool (title, start, description, location).
2. Call planFromCalendar with those events and horizonDays ${weeks * 7}.
3. Show me a short list: each food event with its date, guests and status. Skip not_food; for already_ordered, name the order.
4. Ask me every open question at once (guests, menu, diets, budget), urgent events first.
5. Then planEvent for each event I confirm, with planEventArgs plus my answers, and show the total per event.
6. Check out (checkoutDraft) only the ones I approve. If one needs sign-off, tell me who approves it and why. Never negotiate prices.`;
      return [{ role: 'user', content: { type: 'text', text } }];
    }
    if (name !== 'order-request') throw new Error(`Prompt not found: ${name}`);
    const text = `I need ${args?.need} delivered on ${args?.deliveryDate}.${args?.requirements ? ` Requirements: ${args.requirements}.` : ''}
Follow the Aimo playbook (resource aimo://playbook).
- If I named products or ingredients: find the option that meets our requirements based on price and availability:
  searchProducts → getPriceAndAvailability → requestOffer → placeOrder.
- If I described an event: planEvent → (updateDraft for history notes or changes) → checkoutDraft.
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
  instructions: 'Read resource aimo://playbook first. Direct flow: searchProducts → getPriceAndAvailability → requestOffer → placeOrder. ' +
    'Event flow: planEvent → updateDraft → checkoutDraft → getDeliveryStatus → getOrder → reportLeftovers. ' +
    'Notes, photos or Excel lists from the buyer: readOrderDocument, ask what is missing, then planEvent. ' +
    'Food thrown away: logWaste; waste overview: getWasteReport. ' +
    'Upcoming events in the buyer\'s calendar: read it with your calendar tool, then planFromCalendar. ' +
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
