# Orchestrator, tools and MCP

How Aimo Planner's agents are wired: the agent gateway that external purchasing agents use over MCP (section 5), who talks to the buyer in the widget, which tools exist and who owns them, and the steps the planning pipeline runs. For the wider system, see [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. The big picture

```mermaid
flowchart TB
  B([Buyer in the widget]) <-->|chat stream| O

  subgraph Orchestrator["Orchestrator agent: Aimo (Claude Opus 5.5, effort low)"]
    O[Talks to the buyer in their language<br/>Decides the next step<br/>Never touches data]
  end

  O --> T1[understandRequest]
  O --> T2[offerChoices]
  O --> T3[planOrder]
  O --> T4[editDraft]
  O --> T5[checkIn]

  T1 -.owned by.-> S1[Intake agent]
  T3 -.runs.-> P[[Planning pipeline]]
  P -.uses.-> S2[Menu agent]
  P -.uses.-> S3[Product agent]
  P -.uses.-> S4[Allergen agent]
  P -.on behalf of.-> S5[Pricing agent]
  P -.on behalf of.-> S6[History agent]
  P -.on behalf of.-> S7[Order agent]
  T4 -.owned by.-> S7
  T5 -.owned by.-> S6

  P -->|allergen checks| MCP[(MCP server<br/>aimo-gateway)]
  P -->|prices + stock| V[(Valio Aimo API)]
  P -->|drafts, history, audit| DB[(SQLite)]

  UI{{Approve button}} -->|the only submit path| API["/api/order/approve"]
```

**The rule:** agents reason, code computes. The orchestrator can only call the five delegate tools. Specialists use the model only where judgment is needed. Every price, stock figure, quantity, allergen verdict and history number comes from code over real data. In the widget, no agent can submit an order; only the buyer's **Approve** button can. External purchasing agents order through the gateway (section 5), where code applies the customer's authority policy and a human signs off the rest.

## 2. Orchestrator tools

These are the only tools the orchestrator sees (`src/mastra/tools/*`). Each one is typed with zod, writes `data-*` stream parts the widget renders, and records its steps in the audit log under the owning specialist.

| Tool | Owner | What it does | UI it drives |
|---|---|---|---|
| `understandRequest` | Intake | Extracts date, guests, menu, budget and diets from free text in any language. Validates them (date at least tomorrow, guests 1–5000, cut-off). Only works before a draft exists. | `data-slots`: the slot chips |
| `offerChoices` | Orchestrator | Shows 2–6 quick-reply buttons plus an optional free-text field: missing slots, add-ons, stock shortfalls, substitutions. | `data-choices`: the buttons |
| `planOrder` | Menu → Product → Allergen → Pricing → History → Order | Runs the planning pipeline (section 4) and builds the priced draft. Called again with a new `deliveryDate` to re-plan. | `data-progress` (the animated checklist), then `data-draft` (the sheet) |
| `editDraft` | Order (calls Product, Allergen and Pricing as needed) | Turns typed changes into draft edits: set packs, remove, scale guests, history choice, swap, add, top-up for the remainder. Re-prices and reports problems. | `data-draft` with a diff (changed rows flash) |
| `checkIn` | History | Parses "about 5 kg chicken left, rice ran out" into a left / short amount per line. Saves nothing until the buyer confirms. | `data-checkin`: the editable table |

Buyer clicks (+/−, Use/Keep, remove, Approve, check-in Confirm) don't go through the model. They call `/api/draft`, `/api/order/approve` and `/api/checkin` directly.

## 3. Specialist agents

All run on `claude-opus-5-5` by default (`src/mastra/agents/*`); set `AIMO_MODEL` to another Mastra model-router string (e.g. `openai/<model>`) to switch. The effort and prompt-cache settings are only sent to Anthropic models. Model calls are injected through `src/mastra/specialists.ts`, so tests can stub them.

| Specialist | Model call (judgment) | Deterministic work done on its behalf | Effort |
|---|---|---|---|
| Intake | `extractIntake`: free text → slots | Date and guest validation, cut-off at intake | low |
| Menu | `planMenu`: dishes → components (portion category, diet variants, "needed for cooking" items) | Portion maths, diet rules for shared items, dropping orphan variants | medium |
| Product | `pickProducts`: best candidate per component, all components in one call | Candidate ranking (pack granularity, reliability, price for "cheaper") | medium |
| Allergen | `chooseUnknownFallback`: only when several candidates have unknown allergens | Allergen screening **via MCP**; unknown is never safe; diet coverage is one-way | low |
| Pricing | none | Valio prices and stock, effective cut-off, same-kind substitution, stock split or cap | low |
| History | `parseCheckIn`: leftover reply → numbers | Leftover ratios with fallbacks and recency weighting, clamped to stock | low |
| Order | `interpretEdit`: typed change → draft intents | Applying intents, re-pricing, budget, conflict detection | low |

A full plan costs about 3 model calls (menu, one product pick, plus the orchestrator turn) and takes about 20 s.

## 4. The planning pipeline (`planOrder` → `buildDraft`)

`src/mastra/pipeline/build-draft.ts`. Each step emits a progress event (the checklist in the widget) and writes audit entries.

```mermaid
flowchart TD
  A["① Understanding the menu<br/>Menu agent: planMenu → components<br/>+ applyDietRules (shared items meet every diet)"] --> B
  B["② Breaking it into ingredients<br/>portion rule × guests → kg / l / pcs per component"] --> C
  C["③ Searching the catalogue<br/>MiniSearch fi + en, top 8 per component<br/>ranked by pack granularity"] --> D
  D["Product agent: pickProducts<br/>one call for all components"] --> E
  E["④ Checking allergens<br/>checkAllergens via MCP aimo-gateway<br/>fail = never · unknown = flagged"] --> F
  F["⑤ Prices and stock for the date<br/>Valio /price + /availability (batched, cached)<br/>kg pricing · effective cut-off"] --> G
  G{"Deliverable and<br/>enough stock?"}
  G -- "not deliverable" --> H["Same-kind substitute<br/>or tag unavailable + offer choices"]
  G -- "short stock" --> I["fitToStock: split onto a similar product<br/>or cap + exception"]
  G -- yes --> J
  H --> J
  I --> J
  J["⑥ Comparing with your past events<br/>History: leftover ratio → note only if it changes packs<br/>clamped to stock"] --> K
  K["⑦ Building the draft<br/>totals range vs budget · cut-off · save · emit data-draft"]
```

What the steps guarantee:
- **Quantities:** always rounded up to whole packs, using minimum order steps normalised to packs.
- **Products sold by the kilo:** line price = per-kg price × piece weight, and stock is compared in kg.
- **Substitutes:** must be the same kind of product (name terms or category) and pass the same allergen constraints. They are never silent and always carry a reason in the buyer's language.
- **Resilience:** if a specialist call fails, the pipeline degrades (for example to the best catalogue match) instead of failing the whole plan. If Valio is down, the client serves cached prices and Approve refuses stale ones.

## 5. The agent gateway: MCP server `aimo-gateway`

This is the interface the Valio Aimo brief asks for: an **external purchasing agent** looks up products, price and availability, moves from inquiry to a commitment at fixed prices, and orders within its authority or routes the order to a human. It is one MCP server (`src/mcp/server.ts`, Mastra `MCPServer`) over a deterministic service layer (`src/gateway/*`). Everything the widget does is available to agents too: plan an event, edit the draft, check out, approval, order, leftovers. Connection steps for Claude Code, Claude Desktop, Cursor, MCP Inspector, ChatGPT and curl: [docs/CONNECT.md](docs/CONNECT.md).

### Flow (a): direct, when the agent knows the products

```mermaid
sequenceDiagram
  actor U as Buyer
  participant A as External agent<br/>(Claude, ChatGPT, a script)
  participant G as Aimo gateway (MCP)
  participant V as Valio Aimo API
  actor H as Approver
  U->>A: "1,000 l lactose-free milk by Monday"
  A->>G: searchProducts(requireDiet: lactose_free)
  A->>G: getPriceAndAvailability(ids, date)
  G->>V: /price + /availability
  G-->>A: price per pack (and per kg), stock, cut-off, reliability
  A->>G: requestOffer(date, lines, requirements)
  G-->>A: offer: fixed prices, validUntil (15 min, ≤ cut-off), short lines + alternatives
  A->>G: placeOrder(offerId, preferences)
  G->>V: re-check
  alt expired, or any price or stock change
    G-->>A: requote: newOffer + changes (nothing ordered)
  else nothing deliverable
    G-->>A: not_orderable (no approval requested)
  else within the customer's authority policy
    G-->>A: ordered: receipt (simulated order)
  else outside it
    G-->>A: pending_approval: approver + reasons
    H->>G: /approvals page: Approve or Reject (not an MCP tool)
    G->>V: re-check again (changed → requote)
    A->>G: getOrderStatus(approvalId) → ordered / rejected / requote
  end
```

### Flow (b): event, the same flow as the widget

```mermaid
sequenceDiagram
  actor U as Buyer
  participant A as External agent
  participant G as Aimo gateway (MCP)
  participant P as Planning pipeline<br/>(same as the widget)
  actor H as Approver
  U->>A: "Wedding 5 Dec, 300 guests, chicken and rice, 12 gluten-free"
  A->>G: planEvent(date, guests, menu, diets, budget, addons)
  G->>P: menu → products → allergens per diet group → Valio prices + stock → history from past leftovers
  G-->>A: draftId, lines, history notes, totals, cut-off, exceptions
  A->>G: updateDraft(historyChoice, setPacks, swapProduct, addProduct, ...)
  G-->>A: updated draft + diff (swaps validated: same kind, diets, fresh price/stock)
  A->>G: checkoutDraft(draftId)
  G->>G: fixed-price offer from fresh Valio prices → placeOrder rules
  alt a price moved since the draft
    G-->>A: requote: changes, draft re-priced (nothing ordered)
  else within authority
    G-->>A: ordered: receipt; draft submitted
  else outside it (incl. any line with unverified allergens)
    G-->>A: pending_approval → H approves on /approvals → ordered
  end
  Note over A,G: after the event
  A->>G: getOrder(orderId), reportLeftovers(orderId, entries)
  Note over G,P: the next planEvent shows history notes from these leftovers
```

### The rules that make it trustworthy

- **Fixed prices, no negotiation.** Every price is Valio's catalogue price; no tool takes a price, discount or counter-offer. An offer holds its prices for 15 minutes and never past the order cut-off.
- **Never a silent change.** `placeOrder` and `checkoutDraft` re-check Valio. If the offer expired or any line's price or availability changed, they return `requote` with the changes and order nothing. Short or undeliverable lines stay in the offer with `available: false`, a reason and same-kind alternatives; nothing is swapped in.
- **The gateway decides, not a model.** The authority policy (`src/gateway/policies.ts`, data) is evaluated by code (`src/gateway/policy.ts`). Demo customer: auto-approve up to €1,000 excl. VAT, otherwise Anna Virtanen (Purchasing manager) signs off. Rules: total over the limit, **counting this customer's agent orders already placed or pending today for the same delivery date** (no splitting an order to stay under it); a line that fails or can't be verified against the requirements; a substitute the buyer didn't pre-approve; delivery later than requested; cut-off less than 60 min away; lines that can't be delivered in full; products outside allowed categories.
- **Customer defaults always apply.** The policy carries default requirements the gateway merges into every offer even when the agent states none (demo: a nut-safe kitchen, no peanuts), and substitutes must be the same kind of product as the one they replace.
- **Only a human approves.** No MCP tool can approve. The approval page (`/approvals`, `src/app/api/approvals/*`) is the only path, and it re-checks Valio before ordering, in one transaction with the approval record.
- **Identity from the key.** Agents present an API key (`AIMO_AGENT_KEY` on stdio, `Authorization: Bearer` on HTTP). `src/gateway/agents.ts` maps it to `{ agentId, customerId, displayName }`; the customer never comes from tool input. An agent can't see or act on another customer's offers, drafts, orders or chats (chat ids are namespaced per customer). If `AIMO_AGENT_KEYS` is set but invalid, no key works (fail closed); the demo key only exists when it is unset.
- **Errors don't leak internals.** Gateway errors keep their message; anything unexpected is logged on the server and the agent gets a generic message.
- **Everything is audited**, per offer and per draft: `agent:<agentId>`, `gateway` (policy decisions, requotes), `approver:<name>`. `getOrderStatus` returns the trail.
- **Orders are simulated**, as in the widget: a receipt in SQLite (`simulated: true`).

### Security model in this prototype

| Who | Credential | Can |
|---|---|---|
| Purchasing agent | API key (`AIMO_AGENT_KEYS`, demo `aimo-demo-agent-key`) | Everything in the tool table below, for its own customer only |
| Human approver | **None in this prototype** | Approve or reject on `/approvals` and `POST /api/approvals/:id` |
| Buyer in the widget | None (customer id from the embed snippet) | The widget flow |

**The approval page and its API are unauthenticated in this prototype.** Anyone who can reach the app, including an agent that knows the URL, could call `POST /api/approvals/:id` and approve its own order. That is acceptable on localhost for the demo and nowhere else: never expose `/approvals` or `/api/*` publicly. Tunnel only `/api/mcp` (docs/CONNECT.md shows an ingress rule that does exactly that). Production needs an approver login (Valio customer SSO), with the approver's identity taken from it rather than from the form.

What is exposed over MCP: catalogue, live price and availability, offers, orders and drafts of the caller's customer, the policy, the planning assistant. Not exposed: approving, other customers' data, the audit log beyond the caller's own offers, any price input.

### Tools, by group

`src/mcp/registry.ts` assembles the groups in `src/mcp/tools/*`; the server and these docs use the same list. Every tool runs through `safe()` (`src/mcp/tools/safe.ts`).

| Group | Tool | Input | Returns |
|---|---|---|---|
| catalog | `searchProducts` | `query` (any language), optional `excludeAllergens`, `requireDiet`, `temperature`, `limit` | Ranked hits with match reasons; constraint-safe products first |
| catalog | `getProduct` | `id` | Pack size and unit, allergens, diet flags, reliability, CO₂ per kg |
| catalog | `getAlternatives` | `productId`, optional `limit` | Similar products (same category first) |
| catalog | `getIngredients` | `id` | Ingredient text (allergens in CAPS), parsed allergens and diet flags |
| catalog | `checkAllergens` | `ids[]`, `excludeAllergens`, `requireDiet` | Per product: `pass` / `fail` / `unknown`, conflicts, quoted evidence |
| pricing | `getPriceAndAvailability` | `productIds[]` (≤ 50), `deliveryDate`, optional `requirements` | Per product: price per pack excl./incl. VAT (KG products also per kg; `pricing.basis` says which Valio uses), comparison price, deliverable on the date, stock, earliest date, effective cut-off, reliability, CO₂, allergens, diet flags |
| offers | `requestOffer` | `deliveryDate`, `lines[]` (`productId`, `quantity`, `unit` packs/kg/l/pcs, optional `substituteFor`), optional `requirements` | Offer: lines at fixed prices, totals, cut-off, `validUntil`, effective requirements, short lines with reasons and alternatives |
| drafts | `planEvent` | `deliveryDate`, `guests`, `menu[]`, optional `diets[]`, `budget`, `addons[]`, `eventType`, `eventName`, `lang` | Draft (the widget's pipeline): `draftId`, lines with tags, substitutions and history notes, totals, cut-off, exceptions |
| drafts | `getDraft` | `draftId` | The draft |
| drafts | `updateDraft` | `draftId`, `changes[]`: `setPacks`, `removeLine`, `historyChoice`, `scaleGuests`, `swapProduct {lineId, productId}`, `addProduct {productId, packs or quantity}` | Updated draft, diff, stock problems; all changes or none |
| drafts | `checkoutDraft` | `draftId`, optional `requirements`, `preferences` | Like `placeOrder` (`ordered` / `pending_approval` / `requote` / `not_orderable`) plus `draftId` |
| orders | `placeOrder` | `offerId`, optional `preferences` (`allowSubstitutes`, `latestDeliveryDate`) | `ordered` + receipt, `pending_approval` + approver + reasons, `requote` + new offer + changes, `not_orderable`, or `rejected` |
| orders | `getOrderStatus` | an order (`VA-…`), approval (`AP-…`) or offer (`OF-…`) id | Status, offer, approval, receipt, audit trail |
| orders | `listOrders` | optional `limit` | Orders (with leftover ratio once reported) and pending approvals |
| orders | `getOrder` | `orderId` | Receipt and recorded leftovers |
| orders | `reportLeftovers` | `orderId`, `entries[]` (`lineId`, `leftoverQty` + left / − short), optional `note` | The widget's check-in: unmentioned lines count as used up; only after the delivery date; feeds future history notes |
| policy | `getAuthorityPolicy` | none | The caller's customer policy as JSON |
| assistant | `chatWithAimo` | `message`, optional `conversationId` | The orchestrator's reply (pre-tool narration removed), `draftId` and a compact draft summary; check it out with `checkoutDraft` |

**Resources:** `aimo://policy` (the caller's authority policy, JSON) and `aimo://playbook` (both flows and the rules, Markdown). **Prompt:** `order-request` (`need`, `deliveryDate`, optional `requirements`).

### Transports

- **stdio:** `npx tsx src/mcp/stdio.ts` from the repo root, identity from `AIMO_AGENT_KEY`. Mastra's `startStdio()` only accepts MCP 2026-07-28 clients, so the entry hands Mastra's own (private) server factory to the MCP SDK's `serveStdio` with 2025-era clients allowed. This was built against `@mastra/mcp` 2.9.0 and `@modelcontextprotocol/server` 2.4.0; after upgrading either, run `npx vitest run src/mcp/stdio.test.ts` (it opens a 2025-era `initialize` session over stdio). If the internal ever disappears, the entry falls back to `startStdio()` and logs that 2025-era clients will be rejected.
- **Streamable HTTP:** `POST /api/mcp` on the Next.js app (`src/app/api/mcp/route.ts`). `src/mcp/http.ts` checks the bearer key (401 otherwise), rejects browser requests from other origins (403; requests without `Origin`, as non-browser clients send them, pass; extra origins via `AIMO_ALLOWED_ORIGINS`) and bodies over 1 MB (413), then adapts the Fetch `Request` to the Node `req`/`res` that `MCPServer.startHTTP` expects (a small hand-written adapter, no new dependency) and passes the key as `authInfo`. The server runs with `legacy: 'stateless'`, so `initialize`-style clients work alongside 2026-07-28 clients. It advertises no list-changed notifications or resource subscriptions, because nothing changes at runtime and requests are stateless.

**How the app itself uses it:** the widget pipeline's allergen step calls `checkAllergens` through Mastra's `MCPClient` on the stdio server (`src/mcp/client.ts` → `checkAllergensViaMcp`), and the product and allergen agents only get the five catalogue tools from it. Inside the stdio server process itself (when an agent calls `planEvent` there), the pipeline uses those tools in-process instead of starting a second server.

**Try it:** `npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts` runs the brief's milk example as an external agent using only MCP (about 3 s); `--event` runs the event flow (about 15–30 s). See the README.

## 6. One turn, end to end

```mermaid
sequenceDiagram
  actor B as Buyer
  participant W as Widget
  participant O as Orchestrator
  participant T as Delegate tool
  participant S as Specialist (model)
  participant M as MCP aimo-gateway
  participant V as Valio API
  participant D as SQLite

  B->>W: "Wedding 6 Dec, 300 guests, chicken and rice"
  W->>O: /api/chat
  O->>T: understandRequest
  T->>S: Intake: extractIntake
  T-->>W: data-slots (chips)
  O->>T: offerChoices (budget, diets)
  T-->>W: data-choices
  B->>W: "€1500, 12 gluten-free" → Salad
  O->>T: planOrder(addons: Salad)
  T->>S: Menu: planMenu
  T->>S: Product: pickProducts
  T->>M: checkAllergens
  T->>V: /price + /availability
  T->>D: history, save draft, audit
  T-->>W: data-progress ×7, data-draft
  O-->>W: "Your draft is ready: about €837–939 …"
  B->>W: Approve (button)
  W->>D: /api/order/approve → re-check → order + receipt
```

## 7. Where to look in the code

| Concern | File |
|---|---|
| Orchestrator instructions and tool list | `src/mastra/agents/orchestrator.ts` |
| Specialist prompts and model calls | `src/mastra/agents/*.ts`, `src/mastra/specialists.ts` |
| Delegate tools | `src/mastra/tools/*.ts` |
| Pipeline | `src/mastra/pipeline/build-draft.ts`, `reprice.ts`, `same-kind.ts`, `reasons.ts` |
| Agent gateway (lookup, offers, orders, drafts/event flow, policy, approvals, identity) | `src/gateway/*` |
| MCP server, tool registry, tools, HTTP adapter, stdio entry, client | `src/mcp/server.ts`, `registry.ts`, `tools/*`, `http.ts`, `stdio.ts`, `client.ts` |
| Remote MCP endpoint, approval page | `src/app/api/mcp/route.ts`, `src/app/approvals/`, `src/app/api/approvals/*` |
| Headless external-agent demo | `npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts` (`--event`, `--small`, `--over`, `--http`, `--llm`) |
| Narration filter (pre-tool text never reaches the buyer) | `src/mastra/narration.ts` |
| Stream parts and shared types | `src/contracts.ts` |
| Live smoke test (prints the tool sequence) | `npx tsx --env-file=.env.local scripts/agent-smoke.ts` |
