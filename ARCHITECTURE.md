# Architecture

Aimo Planner is a drop-in ordering assistant for Valio Aimo B2B customers. A buyer describes an event in plain words. Agents turn that into a priced, stock-checked, allergen-safe order draft, corrected by the customer's own leftover history. The buyer edits it, approves it, and it is submitted (simulated).

The guiding rule: **agents reason; code computes.** Language models interpret requests, plan menus and pick between candidate products. Every price, stock figure, quantity, allergen verdict and history number comes from deterministic code over real data.

## System overview

```mermaid
flowchart LR
  subgraph Host["Customer's site (any domain)"]
    W["widget.js<br/>launcher + iframe"]
  end
  subgraph App["Next.js app"]
    E["/embed<br/>widget UI (React)"]
    R["API routes<br/>/api/*"]
    O["Orchestrator agent"]
    S["7 specialist agents<br/>+ delegate tools"]
    P["Pipeline<br/>build-draft · reprice · same-kind"]
    D["Domain<br/>portions · packs · history · totals · cut-off"]
    C["Catalogue index<br/>search · allergens · units"]
    M["MCP server<br/>aimo-products"]
    DB[("SQLite<br/>drafts · orders · leftovers · audit")]
    V["Valio client<br/>cache + retry"]
  end
  VA["Valio Aimo API<br/>/price · /availability"]
  AN["Claude Opus 5.5"]

  W -- iframe + postMessage --> E
  E -- AI SDK UI stream --> R
  R --> O --> S --> P
  P --> D & C & V & DB
  P -- allergen checks --> M --> C
  S & O --> AN
  V --> VA
  R -- approve / draft edits / orders --> DB
```

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Embed | `public/widget.js` | One `<script>` tag. It injects a launcher and an iframe to `/embed`, resizes on `postMessage` (origin-pinned both ways), and exposes `window.AimoWidget.open()`. |
| Widget UI | `src/ui/*`, `src/app/embed` | Chat, slot chips, choice buttons, planning checklist, the order-draft working sheet, review, receipt, My orders and check-in. `useLiveSession` talks to the backend; `useFixtureSession` (`?fixture=1`) is a scripted, no-key fallback. |
| API | `src/app/api/*` | `chat` (agent stream), `draft` (buyer edits), `order/approve` (the only submit path), `orders`, `audit`, `checkin`, `demo`. All inputs are validated with zod. |
| Server services | `src/server/*` | `approveAndSubmit` re-checks availability, cut-off, prices and allergens with fresh Valio data inside a race-safe transaction. It also handles check-in saving and the demo clock and reset. |
| Agents | `src/mastra/agents/*` | The orchestrator plus intake, menu, product, allergen, pricing, history and order specialists, all on `claude-opus-5-5` with per-agent effort. |
| Delegate tools | `src/mastra/tools/*` | `understandRequest`, `offerChoices`, `planOrder`, `editDraft` and `checkIn`. These are the only things the orchestrator can call; each is owned by one specialist. |
| Pipeline | `src/mastra/pipeline/*` | `buildDraft`: menu → quantities → search → product pick → allergen screen (via MCP) → price and stock → same-kind substitution and stock split → history → totals. |
| Domain (pure) | `src/domain/*` | Portion rules, rounding up to whole packs, leftover-history ratios, price range and totals, draft mutations, effective cut-off. |
| Catalogue | `src/catalog/*`, `data/catalog.index.json` | An index of 17,546 products built from the 87 MB raw file. MiniSearch over Finnish and English names; allergens derived from ingredient text and names; pack sizes per sales unit. |
| MCP | `src/mcp/*` | The `aimo-products` MCP server (`searchProducts`, `getProduct`, `getAlternatives`, `getIngredients`, `checkAllergens`). The pipeline's allergen step calls it over stdio; external agents can use the same server. |
| Valio | `src/valio/*` | Batched (≤1000), cached (10 min), retrying client for `/api/price` and `/api/availability`. Falls back to stale cache when Valio is down. |
| Data | `src/db/*` | SQLite via Drizzle: drafts, orders and receipts, order lines, leftovers, audit log, demo clock. `npm run seed` creates the demo customer and 8 past events. |
| Contracts | `src/contracts.ts` | The single set of shared types used by every layer, including the `data-*` stream parts. |

## Agents and their jobs

| Agent | Calls the model for | Deterministic work it owns |
|---|---|---|
| Orchestrator | Talking to the buyer in their language (at most 3 sentences), choosing the next tool | none (never touches data) |
| Intake | Extracting date, guests, menu, budget and diets from free text | Validating dates and guest counts, cut-off at intake |
| Menu | Turning the menu into components with portion categories and diet variants | Portion maths, diet rules for shared items |
| Product | Picking the best candidate per component; handling "cheaper" and swaps | Candidate ranking (pack granularity, reliability) |
| Allergen | Choosing between unknown-allergen fallbacks (rare) | Allergen screening via MCP; unknown is never safe |
| Pricing | none | Prices, stock, effective cut-off, same-kind substitution, stock split |
| History | Parsing the check-in reply ("5 kg chicken left, rice ran out") | Leftover ratios with fallbacks and recency weighting, clamped to stock |
| Order | Turning typed edits into draft changes | Applying changes, re-pricing, budget |

Every tool call writes an audit entry with the acting specialist, which the decision log shows.

## Request flow (happy path)

```mermaid
sequenceDiagram
  actor B as Buyer
  participant UI as Widget
  participant O as Orchestrator
  participant T as Delegate tools
  participant V as Valio API
  participant DB as SQLite
  B->>UI: "Wedding 6 Dec, 300 guests, chicken and rice"
  UI->>O: /api/chat (stream)
  O->>T: understandRequest (intake)
  T-->>UI: data-slots (chips), missing: budget, diets
  O->>T: offerChoices
  T-->>UI: data-choices (buttons)
  B->>UI: budget + diets, add-ons
  O->>T: planOrder
  T-->>UI: data-progress ×7 (animated checklist)
  T->>V: prices + availability (batched)
  T->>DB: save draft, audit
  T-->>UI: data-draft (sheet expands)
  B->>UI: +/− , Use/Keep, "make it 320 guests"
  UI->>DB: /api/draft or editDraft via chat
  B->>UI: Review → Approve
  UI->>V: fresh availability + prices (server)
  UI->>DB: order + receipt (transaction)
  Note over UI,DB: Fast-forward → check-in → leftovers saved → next plan uses them
```

## Safety and control

- **Only a buyer click submits.** No agent tool can submit. `/api/order/approve` re-checks everything and returns per-line problems instead of dropping lines silently. A double click is race-safe.
- **Allergens.**
  - Products with no real ingredient data are "unknown" and never pass a constraint.
  - Shared items must satisfy every diet group.
  - Diet coverage only counts one way: lactose-free never covers a milk allergy.
  - Unknown lines need a per-line tick in Review, which is recorded in the audit log.
- **No silent changes.** Substitutions are tagged with a reason in the buyer's language. Stock shortfalls are split or offered as choices. History notes need Use or Keep. Budget overruns are flagged.
- **Valio failure.** The client retries, then serves stale cache. Approve refuses stale prices or availability with a plain message, and the route returns 503 when nothing is cached.

## Key data interpretations

- **Sold-by-kg products:** Valio prices them per kg. A "pack" is the approximate piece weight, so the line price is per-kg price × piece weight. Stock is in kg, and lot sizes are normalised to packs at index build.
- **Order cut-off:** Valio's `closingTime` applies to the earliest `availableDate`. The cut-off for the requested date is the requested date minus the same lead time.
- **History:** leftovers are stored per line as a ratio (+ left over, − short). The fallbacks are same product → same category and event type → same category, weighted toward recent events (half-life about 6 months). A note is shown only when it changes the pack count.

## Running and testing

See [README.md](README.md). Summary: `npm run seed`, `npm run dev`, open `/demo-host?demo=1`. `npm test` runs 180 tests. `scripts/agent-smoke.ts` runs a live end-to-end conversation.
