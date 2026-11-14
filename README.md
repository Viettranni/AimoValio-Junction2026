# Aimo Planner: Junction 2026 · Valio Aimo "Trusted Trade Agents"

**A trusted gateway for purchasing agents.** Any AI agent (Claude, ChatGPT, Cursor, a script) connects to Valio Aimo over MCP, looks up products, live prices and availability, gets a binding offer at fixed catalogue prices, and orders within the authority its customer gave it. Anything outside that authority goes to a named human for sign-off. Code applies the policy, never a language model, and nothing changes price silently.

Our own chat widget for caterers is one client of the same platform: describe the event ("wedding, 300 guests, chicken and rice") and get a priced, stock-checked order draft that learns from past leftovers.

- Agent gateway, tools and MCP: [`MCP.md`](MCP.md) · Connect Claude / ChatGPT / Cursor / Inspector / curl: [`docs/CONNECT.md`](docs/CONNECT.md)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md) · Spec: [`spec.md`](spec.md) · Build summary: [`SUMMARY.md`](SUMMARY.md) · UI mockups: [`docs/mockups/`](docs/mockups/)

Stack: Next.js 16 + TypeScript · MCP (Mastra `MCPServer`, stdio + Streamable HTTP) · Mastra agents on Claude Opus 5.5 · SQLite (Drizzle) · MiniSearch.

## The 3-minute demo

Start the app on port 3100 (`npm run dev -- -p 3100`, see Run it). Everything below uses `http://localhost:3100`; scripts take `AIMO_BASE_URL` if you run it elsewhere.

1. **An external agent plans and orders an event, using only MCP.** From Claude Code (or Claude Desktop, ChatGPT, Cursor; see [`docs/CONNECT.md`](docs/CONNECT.md)): "Plan a wedding for 300 guests on 5 December, chicken and rice, 12 gluten-free, then check out." Claude calls `planEvent` (the same pipeline as the widget: menu, products, allergen checks per diet group, live Valio prices and stock, history notes from this caterer's past leftovers), optionally `updateDraft`, then `checkoutDraft`. Or, without a model on the client side:

   ```bash
   npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts --event
   ```

   planEvent → accept a history note and add a pack with updateDraft → checkoutDraft → listOrders, in about 15–30 s. Within the €1,000 authority it orders; above it, it waits for a human.

2. **The brief's own example, deterministic:** "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability."

   ```bash
   npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts
   ```

   The agent searches lactose-free milk, compares live prices, stock and Monday's cut-offs, requests a fixed-price offer (at the time of writing 1,000 × €1.01 = €1,010) and places it. Over the €1,000 limit it gets `pending_approval`: waiting for Anna Virtanen, Purchasing manager, with the reason. The script says so honestly if today's prices put it under the limit; `--over` then sizes the order just over it. `--small` orders 100 l within authority. Orders placed or pending today for the same delivery date count together against the limit, so a run after `--small` also needs sign-off. About 3 s.

3. **The human sign-off:** http://localhost:3100/approvals. Anna sees the agent, the total, why it needs her and the lines. Approve re-checks Valio and places the (simulated) order, or re-quotes if a price moved; Reject tells the agent. No MCP tool can approve. (In this prototype the page has no login; see Assumptions.)

4. **One client among many, the chef's widget:** http://localhost:3100/demo-host?demo=1. The same pipeline behind a chat, and the **same gateway**: Review shows a fixed-price offer ("Prices fixed until 14:32 · Offer OF-…", with a countdown and any price changes), and Approve is the gateway's `placeOrder` with the same authority policy as Claude over MCP. A 300-guest wedding (about €780) orders straight away; a 700-guest one (about €1,480) shows "Sent to Anna Virtanen for approval" with the reason, and the widget updates by itself when she approves on `/approvals`. The orchestrator is also an MCP tool (`chatWithAimo`), and its drafts can be checked out with `checkoutDraft`.

5. **Delivery you can follow:** the receipt shows a simulated delivery timeline (Received → Confirmed → Picking → Out for delivery with an ETA window → Delivered, plus the supplier track for terminal lines). **Next delivery step** in the demo controls walks it forward; lines from less reliable products may arrive short, with the reason, and the leftover check-in is prefilled with them. External agents see the same thing through `getDeliveryStatus`.

## Run it

Requirements: Node 22 and npm.

```bash
npm install
cp .env.example .env.local     # then fill in the three variables below
npm run seed                   # creates data/aimo.sqlite with the demo customer and past orders
npm run dev -- -p 3100         # http://localhost:3100/demo-host?demo=1 (the docs use port 3100)
```

`.env.local` needs:

| Variable | What it is |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key (all agents run on `claude-opus-5-5`; `AIMO_MODEL` switches the model) |
| `VALIO_API_KEY` | Key for the Valio Aimo challenge API (prices, availability) |
| `VALIO_API_BASE` | `https://junction26.valioaimo.fi` |

Open http://localhost:3100/demo-host?demo=1: a mock Valio Aimo page with the widget in the corner. `?demo=1` shows the demo controls; **Reset demo** in those controls re-seeds the database (same as `npm run seed`), **Next delivery step** advances the demo clock to the latest order's next delivery state, and **Fast-forward to day after event** jumps to the day after delivery for the leftover check-in.

Optional: set `AIMO_DB_PATH` to keep the SQLite database somewhere other than `data/aimo.sqlite`, `AIMO_AGENT_KEYS` / `AIMO_AGENT_KEY` for agent identities (see `.env.example`), and `AIMO_MODEL` for another model (e.g. `openai/<model>` with `OPENAI_API_KEY`).

### Tests

```bash
npm test                       # vitest
npx tsc --noEmit -p .          # type check
npx tsx --env-file=.env.local scripts/agent-smoke.ts   # live run against Claude and Valio (costs tokens)
```

### Catalogue index

`data/catalog.index.json` (17,546 products, about 12 MB) is committed, so you don't need the raw data to run the app. Rebuild it with `npm run build:index` only if you have the raw challenge files in `data/raw/` (`products.json`, `reliability.csv`, `carbon.csv`; not committed).

### Agent gateway (MCP)

One MCP server, `aimo-gateway`, two transports:

```bash
npx tsx src/mcp/stdio.ts       # stdio, run from the project root; identity from AIMO_AGENT_KEY
# Streamable HTTP: POST http://localhost:3100/api/mcp with Authorization: Bearer <agent key> (runs with npm run dev -- -p 3100)
```

Tools by group: catalogue (`searchProducts`, `getProduct`, `getAlternatives`, `getIngredients`, `checkAllergens`), pricing (`getPriceAndAvailability`), offers (`requestOffer`), drafts (`planEvent`, `getDraft`, `updateDraft`, `checkoutDraft`), orders (`placeOrder`, `getOrderStatus`, `listOrders`, `getOrder`, `getDeliveryStatus`, `reportLeftovers`), policy (`getAuthorityPolicy`) and assistant (`chatWithAimo`). Resources `aimo://policy` and `aimo://playbook`, prompt `order-request`. The demo key is `aimo-demo-agent-key` (set your own with `AIMO_AGENT_KEYS`, see `.env.example`). Setup for each client: [`docs/CONNECT.md`](docs/CONNECT.md).

### Embed it on any site

```html
<script src="https://<aimo-host>/widget.js" data-customer="helsinki-juhlapalvelu" data-position="bottom-right" defer></script>
```

The script adds a launcher and an isolated iframe (`/embed`) that grows from a chat panel into chat plus order sheet. `data-position` can be `bottom-right` (default) or `bottom-left`.

## Architecture

One **orchestrator** agent talks to the buyer and delegates through five tools (`understandRequest`, `offerChoices`, `planOrder`, `editDraft`, `checkIn`). Behind them, seven **specialists** each own one judgment:

| Specialist | Job | How it runs |
| --- | --- | --- |
| Intake | Pulls date, guests, menu, budget, diets out of free text | LLM, structured output |
| Menu | Turns the menu into components, cooking needs, add-ons and diet variants | LLM, structured output |
| Product | Picks the best catalogue candidate and two alternatives per component | LLM, over candidates from the search index |
| Allergen | Screens products against the 14 EU allergens and diets; judges among "unknown" products | `checkAllergens` over MCP, LLM only for the unknown tie-break |
| Pricing & stock | Live price, availability, cut-off; substitutions and stock top-ups | Deterministic code over the Valio API (the agent is registered with the same tools) |
| History | Leftover ratios from past events; parses check-in replies | Domain maths + LLM for parsing |
| Order | Turns edit requests into draft changes | LLM, structured output; never submits |

The quantities, totals, pack rounding, history ratios and cut-offs are pure functions in `src/domain` and are unit-tested. If the product or allergen agent fails, the pipeline falls back to the best search match and says so in the decision log.

**What goes through MCP.** Everything an external agent needs: catalogue, live prices and availability, offers, orders within authority, approvals status and the policy (see [`MCP.md`](MCP.md) section 5; the service layer is `src/gateway`). The widget's draft pipeline also calls `checkAllergens` through our own MCP client (`src/mcp/client.ts`) on the stdio server, the same way an external agent would; if the server can't be reached, the same check runs in-process and a single warning is logged. Product search for the draft runs in-process for speed.

Folders: `src/app` (pages and API routes, incl. `/api/mcp` and `/approvals`), `src/gateway` (agent gateway: lookup, offers, orders, policy, approvals, identity), `src/mastra` (agents, tools, pipeline), `src/mcp` (MCP server, tool registry, tools, HTTP adapter, client), `src/domain` (pure logic), `src/catalog` (index, search, allergen parsing), `src/valio` (API client with a 10-minute cache), `src/db` (SQLite schema, seed), `src/ui` (widget), `public/widget.js` (embed script).

## Assumptions and limits

- **Orders are simulated.** Valio exposes no order endpoint, so an order (placed by the gateway within an agent's authority, the widget included, or approved by the approver on `/approvals`) writes a receipt to the local database ("Demo order. Nothing is charged."). Past orders and leftovers for the demo customer are seeded.
- **Authentication is demo-grade.** Agents use static API keys mapped to a customer (`AIMO_AGENT_KEYS`); the widget's customer id comes from the embed snippet. **The approval page `/approvals` and `/api/approvals/*` are unauthenticated:** anyone who can reach the app, an agent included, could approve. Run it on localhost only and, if you tunnel for ChatGPT, tunnel only `/api/mcp` (docs/CONNECT.md). Production needs Valio's customer login, per-agent OAuth and customer-specific prices (the challenge API returns list prices for one customer).
- **Authority policy** is a constant per customer in `src/gateway/policies.ts` (demo: auto-approve up to €1,000 excl. VAT per delivery date and day, approver Anna Virtanen, no peanuts by default). Production would let the customer edit it.
- **Allergen data is heuristic.** Allergens are parsed from ingredient text with keyword rules. Products with no ingredient list, or whose allergens come only from the product name, are "unknown" and never treated as safe: the buyer must tick each one on the review screen before approving. Production needs verified allergen data.
- **In the widget, approval is the buyer's click, through the gateway.** No widget agent can submit. The Approve button is `placeOrder` under the widget's server-side identity, with the same policy and human sign-off as external agents; it re-checks stock, cut-off, prices (a price older than 10 minutes that couldn't be refreshed blocks approval) and allergens, and never drops a failing line silently. Delivery after ordering is simulated (deterministic per order).
- Prices are list prices excl. VAT from the challenge API; the price range shown while history choices are open comes from quantity bands, not price uncertainty.
- Portion rules (grams per guest by component and event type) are a hand-written table in `data/portion-rules.json`.
- Fixed UI text is in English, Finnish and Swedish; the assistant replies in the buyer's language.
