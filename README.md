# Aimo Planner: Junction 2026 · Valio Aimo "Trusted Trade Agents"

A drop-in ordering assistant for Valio Aimo B2B customers. Describe the event ("wedding, 300 guests, chicken and rice") and get a priced, stock-checked order draft that learns from your past leftovers. Edit it by chatting or clicking, review it, and approve it.

- Spec: [`spec.md`](spec.md)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md) · Agents, tools and MCP: [`MCP.md`](MCP.md) · Build summary: [`SUMMARY.md`](SUMMARY.md)
- UI mockups: [`docs/mockups/`](docs/mockups/)

Stack: Next.js 16 + TypeScript · Mastra agents on Claude Opus 5.5 · SQLite (Drizzle) · MiniSearch.

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
| `ANTHROPIC_API_KEY` | Claude API key (all agents run on `claude-opus-5-5`) |
| `VALIO_API_KEY` | Key for the Valio Aimo challenge API (prices, availability) |
| `VALIO_API_BASE` | `https://junction26.valioaimo.fi` |

Open http://localhost:3000/demo-host?demo=1: a mock Valio Aimo page with the widget in the corner. `?demo=1` shows the demo controls; **Reset demo** in those controls re-seeds the database (same as `npm run seed`), and **Fast-forward to day after event** jumps to the day after delivery for the leftover check-in.

Optional: set `AIMO_DB_PATH` to keep the SQLite database somewhere other than `data/aimo.sqlite`.

### Tests

```bash
npm test                       # vitest
npx tsc --noEmit -p .          # type check
npx tsx --env-file=.env.local scripts/agent-smoke.ts   # live run against Claude and Valio (costs tokens)
```

### Catalogue index

`data/catalog.index.json` (17,546 products, about 12 MB) is committed, so you don't need the raw data to run the app. Rebuild it with `npm run build:index` only if you have the raw challenge files in `data/raw/` (`products.json`, `reliability.csv`, `carbon.csv`; not committed).

### MCP server

The catalogue is also an MCP server, `aimo-products`, that any MCP client (Claude Desktop, another purchasing agent) can use:

```bash
npx tsx src/mcp/stdio.ts       # stdio transport, run from the project root
```

Tools: `searchProducts`, `getProduct`, `getAlternatives`, `getIngredients`, `checkAllergens`.

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

**What goes through MCP.** The draft pipeline's allergen screening calls `checkAllergens` through our own MCP client (`src/mcp/client.ts`), on the stdio server above, the same way an external agent would. If the server can't be reached, the same check runs in-process and a single warning is logged. Product search for the draft runs in-process for speed (the same `searchProducts` function the MCP tool wraps). Pricing, availability and the order tools are not on MCP.

Folders: `src/app` (pages and API routes), `src/mastra` (agents, tools, pipeline), `src/mcp` (aimo-products server and client), `src/domain` (pure logic), `src/catalog` (index, search, allergen parsing), `src/valio` (API client with a 10-minute cache), `src/db` (SQLite schema, seed), `src/ui` (widget), `public/widget.js` (embed script).

## Assumptions and limits

- **Orders are simulated.** Valio exposes no order endpoint, so approval writes a receipt to the local database ("Demo order. Nothing is charged."). Past orders and leftovers for the demo customer are seeded.
- **No authentication.** The customer id comes from the embed snippet. Production needs Valio's customer login and customer-specific prices.
- **Allergen data is heuristic.** Allergens are parsed from ingredient text with keyword rules. Products with no ingredient list, or whose allergens come only from the product name, are "unknown" and never treated as safe: the buyer must tick each one on the review screen before approving. Production needs verified allergen data.
- **Approval is the buyer's click.** No agent can submit. The Approve button re-checks stock, cut-off, prices (a price older than 10 minutes that couldn't be refreshed blocks approval) and allergens, and never drops a failing line silently.
- Prices are list prices excl. VAT from the challenge API; the price range shown while history choices are open comes from quantity bands, not price uncertainty.
- Portion rules (grams per guest by component and event type) are a hand-written table in `data/portion-rules.json`.
- Fixed UI text is in English, Finnish and Swedish; the assistant replies in the buyer's language.
