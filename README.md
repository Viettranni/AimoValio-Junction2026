# Aimo Planner: Junction 2026 · Valio Aimo "Trusted Trade Agents"

**A trusted gateway for purchasing agents.** Any AI agent (Claude, ChatGPT, Cursor, a script) connects to Valio Aimo over MCP, looks up products, live prices and availability, gets a binding offer at fixed catalogue prices, and orders within the authority its customer gave it. Anything outside that authority goes to a named human for sign-off. Code applies the policy, never a language model, and nothing changes price silently.

Our own chat widget for caterers is one client of the same platform: describe the event ("wedding, 300 guests, chicken and rice") and get a priced, stock-checked order draft that learns from past leftovers.

- Agent gateway, tools and MCP: [`MCP.md`](MCP.md) · Connect Claude / ChatGPT / Cursor / Inspector / curl: [`docs/CONNECT.md`](docs/CONNECT.md)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md) · Spec: [`spec.md`](spec.md) · Build summary: [`SUMMARY.md`](SUMMARY.md) · UI mockups: [`docs/mockups/`](docs/mockups/)

Stack: Next.js 16 + TypeScript · MCP (Mastra `MCPServer`, stdio + Streamable HTTP) · Mastra agents on Claude Opus 5.5 · SQLite (Drizzle) · MiniSearch.

## The 3-minute demo

1. **An external agent, in a terminal, using only MCP** (the brief's example):

   ```bash
   npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts
   ```

   "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability." The agent searches lactose-free milk, compares live Valio prices, stock and order cut-offs for Monday, requests an offer (1,000 × €1.01 = €1,010 excl. VAT, held for 15 minutes) and places it. €1,010 is over the agent's €1,000 limit, so the gateway answers `pending_approval`: waiting for Anna Virtanen, Purchasing manager, with the reason. About 3 seconds. `--small` (100 l) stays within authority and orders straight away; `--llm` lets Claude drive the same tools.

2. **The human sign-off:** open http://localhost:3000/approvals. Anna sees the agent, the total, why it needs her and the lines. Approve re-checks Valio and places the (simulated) order, or re-quotes if a price moved; Reject tells the agent. No MCP tool can approve.

3. **One client among many, the chef's widget:** http://localhost:3000/demo-host?demo=1. The same catalogue, prices and allergen checks behind a chat that plans a whole event. The orchestrator is also an MCP tool (`chatWithAimo`), so a Claude or ChatGPT user can plan the same way.

## Run it

Requirements: Node 22 and npm.

```bash
npm install
cp .env.example .env.local     # then fill in the three variables below
npm run seed                   # creates data/aimo.sqlite with the demo customer and past orders
npm run dev                    # http://localhost:3000/demo-host?demo=1
```

`.env.local` needs:

| Variable | What it is |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key (all agents run on `claude-opus-5-5`; `AIMO_MODEL` switches the model) |
| `VALIO_API_KEY` | Key for the Valio Aimo challenge API (prices, availability) |
| `VALIO_API_BASE` | `https://junction26.valioaimo.fi` |

Open http://localhost:3000/demo-host?demo=1: a mock Valio Aimo page with the widget in the corner. `?demo=1` shows the demo controls; **Reset demo** in those controls re-seeds the database (same as `npm run seed`), and **Fast-forward to day after event** jumps to the day after delivery for the leftover check-in.

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
# Streamable HTTP: POST http://localhost:3000/api/mcp with Authorization: Bearer <agent key> (runs with npm run dev)
```

Tools by group: catalogue (`searchProducts`, `getProduct`, `getAlternatives`, `getIngredients`, `checkAllergens`), pricing (`getPriceAndAvailability`), offers (`requestOffer`), orders (`placeOrder`, `getOrderStatus`), policy (`getAuthorityPolicy`) and assistant (`chatWithAimo`). Resources `aimo://policy` and `aimo://playbook`, prompt `order-request`. The demo key is `aimo-demo-agent-key` (set your own with `AIMO_AGENT_KEYS`, see `.env.example`). Setup for each client: [`docs/CONNECT.md`](docs/CONNECT.md).

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

- **Orders are simulated.** Valio exposes no order endpoint, so approval (by the buyer in the widget, by the gateway within an agent's authority, or by the approver on `/approvals`) writes a receipt to the local database ("Demo order. Nothing is charged."). Past orders and leftovers for the demo customer are seeded.
- **Authentication is demo-grade.** Agents use static API keys mapped to a customer (`AIMO_AGENT_KEYS`); the widget's customer id comes from the embed snippet; the approval page has no login. Production needs Valio's customer login, per-agent OAuth and customer-specific prices (the challenge API returns list prices for one customer).
- **Authority policy** is a constant per customer in `src/gateway/policies.ts` (demo: auto-approve up to €1,000 excl. VAT, approver Anna Virtanen). Production would let the customer edit it.
- **Allergen data is heuristic.** Allergens are parsed from ingredient text with keyword rules. Products with no ingredient list, or whose allergens come only from the product name, are "unknown" and never treated as safe: the buyer must tick each one on the review screen before approving. Production needs verified allergen data.
- **In the widget, approval is the buyer's click.** No widget agent can submit; external agents order only through the gateway's policy and human sign-off. The Approve button re-checks stock, cut-off, prices (a price older than 10 minutes that couldn't be refreshed blocks approval) and allergens, and never drops a failing line silently.
- Prices are list prices excl. VAT from the challenge API; the price range shown while history choices are open comes from quantity bands, not price uncertainty.
- Portion rules (grams per guest by component and event type) are a hand-written table in `data/portion-rules.json`.
- Fixed UI text is in English, Finnish and Swedish; the assistant replies in the buyer's language.
