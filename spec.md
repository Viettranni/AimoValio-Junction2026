# Aimo Planner: Spec

**Event:** Junction 2026 · Valio Aimo challenge "Trusted Trade Agents"
**Status:** Draft for approval · 2026-11-14
**Stack (decided):** Next.js + TypeScript, Mastra for the agent and pipeline, Claude Opus 5.5 (`claude-opus-5-5`)

---

## 1. Why this exists

Valio Aimo serves 20,000+ professional kitchens. Today a buyer ordering for an event (a wedding, a conference lunch, a school week) translates a menu into products by hand. They search a 17,000-item catalogue, guess quantities, check prices and stock one item at a time, and usually over-order "to be safe".

Aimo Planner replaces that with one sentence:

> "We have a wedding on 6 Dec, 300 guests, we want chicken and rice."

The assistant confirms what it needs, then plans the ingredients. It finds real Valio Aimo products, pulls live prices and stock, and corrects the quantities using what this customer actually had left over at past events. The result is a priced order draft. The buyer edits it by chatting or clicking, approves it, and it goes to Valio Aimo, with a receipt and a readable log of every decision the agent made.

**What makes it special:**
1. **Prompt instead of picking.** No manual catalogue browsing. We show the time saved.
2. **It learns from leftovers.** Waste and shortfalls from past events are recorded per ingredient. They become a percentage correction the buyer can accept or ignore.
3. **It's trustworthy by design.** The agent never orders, substitutes or overspends silently. A human approves; everything is logged.
4. **Drop-in.** A client adds one `<script>` tag to their site and gets the widget.
5. **Any language.** The buyer writes in whatever language they like (Finnish, Swedish, English, Estonian, …). The assistant plans and replies in that same language, as far as Opus 5.5 supports it.

**Judging criteria this maps to:** working end-to-end demo (30%), solving the problem (20%), autonomy and controls (20%), robustness to exceptions (15%), openness and credible path to production (15%).

## 2. Goals, non-goals, anti-goals

**Goals**
- One take, end to end, live: request → intake → animated planning → draft → edit → approve → order sent → receipt → (fast-forward) leftover check-in → new request shows the learning.
- Every number on screen can be traced back to a source: Valio API, catalogue data, portion rule or history.
- Feels hand-crafted and responsive. The first visible feedback comes in under 1 s, and the draft fills in progressively.

**Non-goals (hackathon scope)**
- Real ordering, payment, invoicing or authentication. Order submission is simulated.
- Multi-customer or multi-tenant admin, and user management.
- Recipe or menu creativity beyond what's needed to turn the menu into ingredients.
- Mobile-first layout. It should work on a laptop demo screen; phone width only needs to not break.

**Anti-goals (failure even if it "works")**
- **AI slop:** walls of chat text, emoji confetti, generic purple gradients, "As an AI…" preambles, or everything rendered as markdown bullets in a chat bubble.
- **Made-up facts:** a product, price, stock level or history figure that didn't come from data. If something is unknown, say so.
- **Silent changes:** a quantity, substitution or history correction applied without the buyer seeing it.
- **Making the user learn the system:** product codes, sales-unit codes (`KI`, `ST`), API terms or JSON in front of the buyer.

## 3. Users and the core flow

**Primary user:** a buyer or chef at a B2B food-service customer (caterer, hotel, restaurant, school kitchen). They're busy, know food, and don't care about tech.

**Demo customer:** "Helsinki Juhlapalvelu Oy", a catering company with a seeded order history (§8).

### 3.1 Flow

1. **Bubble.** The widget sits as a small round launcher in the corner of the host site. Opening it shows a short greeting and 2–3 example prompts as tappable chips.
2. **Request.** The buyer types freely.
3. **Intake (the pipeline the user asked for).** The agent extracts five required slots:
   | Slot | Required | Notes |
   |---|---|---|
   | Delivery date | yes | Needed for price and availability; shows the order cut-off time |
   | Guest count | yes | |
   | Menu / food preferences | yes | "chicken and rice", or "you suggest" |
   | Budget | yes, but can be skipped | "No limit" chip; if skipped the total is shown without a budget bar |
   | Allergies / diets | yes | Counts per diet ("12 gluten-free, 4 lactose-free") or "None" |
   - Slots already in the message are pre-filled and shown as **slot chips** in a strip above the input ("300 guests · 6 Dec · chicken & rice · budget ? · allergies ?"). Tapping a chip edits it.
   - Everything still missing is asked in **one** message, with quick-reply chips ("No allergies", "Gluten-free", "Lactose-free", "Vegan", "No budget limit").
   - Planning starts only when all five are filled. Event type ("wedding") and serving style are inferred if given and asked about only if they change portions significantly.
3b. **Menu options (buttons, never silent additions).** Once the core menu is known, the agent offers a short set of **optional add-ons** suited to the event as toggle buttons, for example "Salad", "Bread & butter", "Dessert", "Coffee & tea", "Sauce / gravy". There's also a free-text "Something else…" field. The defaults are off. Only the core dishes the buyer named, and what's needed to cook them (cooking fat, sauce base, seasoning), are added automatically, and those appear as rows tagged "needed for cooking". The same pattern is used whenever the agent needs a choice: 2–4 buttons plus "type your own".
4. **Planning (animated).** The agent narrates real steps as a live checklist (§6.3): understanding the menu → breaking it into ingredients → searching the catalogue → checking allergens → prices and stock for the date → comparing with history → building the draft.
5. **Draft panel.** The widget expands into a two-part layout (§6.1): the chat stays on the left, and the order draft **working sheet** slides out next to it.
6. **Edit loop.** The buyer changes the draft by:
   - typing ("make it 320 guests", "swap to basmati", "cheaper chicken", "remove the cream"); the agent changes only the affected rows, and those rows flash
   - clicking + / − steppers, Apply/Keep on history notes, or the remove icon on a row
   Each change re-prices from cached API data and re-checks the budget. A short confirmation appears in chat ("Chicken +3 kg, rice +2 kg").
7. **Review & send.** A review sheet shows every line, the substitutions with reasons, allergen coverage, delivery date and cut-off, and the total. The buyer presses **Approve & send to Valio Aimo**.
8. **Receipt.** An order confirmation with order number, lines, prices including and excluding VAT, delivery date and a "time saved" figure. It can be downloaded or printed. The audit log is reachable from here.
9. **After the event (check-in).** On the day after delivery, the widget shows a check-in: "How did the wedding go? Anything left over or short?" with the order's lines pre-listed. The buyer replies in free text ("about 5 kg chicken left, rice ran out, rest fine"). The agent turns this into per-line numbers, shows them back as a small editable table, and saves them on confirmation. The **demo controls** fast-forward button simulates the passage of time (§9).
10. **My orders (history and receipts).** A single quiet icon in the widget header opens **My orders**, a plain list of past orders (event name · date · guests · total · a leftover summary such as "−6% waste"). Opening one shows its saved receipt and the leftover figures recorded for it. From there the buyer can "Reorder as new draft". This is the only extra screen; there are no dashboards or charts. Receipts, orders, leftovers and audit entries all live in the database (§5) and survive restarts.

## 4. Data sources (all verified during recon)

Portal: `https://junction26.valioaimo.fi` · API key in the `X-API-Key` header (from the Junction challenge page; stored in `.env.local` as `VALIO_API_KEY`, never sent to the browser).

| Source | What it gives | How we use it |
|---|---|---|
| `POST /api/price` | Per product: `catalogPrice{value, valueWithTax}`, `comparisonPrice` per KG/L, currency, validity. Body: `customer`, `requestedDate`, `products` (1–1000 ids). The customer number is not meaningful. | Line prices, comparison per kg for "cheaper alternative" |
| `POST /api/availability` | Per product: `closingTime` (order cut-off), `salesBlock`, `logisticModel` (Stock vs Terminal), `scheduleLines[0]{availableAmount, availableDate, salesUnit}`. Empty schedule = can't deliver. Terminal → amount always 999999 (unknown). | Stock tags, cut-off time, substitutions when unavailable or blocked, "Supplier-delivered, stock not guaranteed" tag for Terminal |
| `GET /api/ping` | Health | Startup check |
| Product data JSON (87 MB, 17,546 items) | `id`, `salesUnit`, `baseUnit`, `units[]` (pack sizes in base units), `allowedLotSize`, `category`, `temperatureCondition`, `vendorName`, `synkkaData.names[en/fi/sv]`, `keyIngredients` (free text, **allergens in CAPS**), `ingredients[]`, `nutritionalContent`, `unitConversions[].netWeight` | Catalogue search index (§5.3) |
| Delivery reliability CSV | `productId, deliveryReliability` (0–1) | Ranking signal; "may deliver short" warning below 0.9 |
| Carbon footprint CSV | `productId, AVG kg CO2-eq/kg` (product-group average) | Optional tag and tie-breaker; total CO₂ estimate on the receipt |

**Gaps we fill ourselves:**
- **No order or submit endpoint.** We simulate order submission with a local mock (§5.5).
- **No order history.** We seed it (§8).
- **No structured allergen field.** We derive allergen tags at index-build time by parsing the CAPS words in `keyIngredients` and the ingredient names against the 14 EU allergens (Finnish and English keywords). Products with no ingredient data are tagged **"allergens unknown"**. They're never treated as safe for an allergy constraint, and the UI shows that.

## 5. Architecture

```
Host site ──<script src="/widget.js" data-customer="demo">──► injects launcher + iframe (/embed)
                                                                    │
Next.js app ─────────────────────────────────────────────────────────┤
  /embed            widget UI (chat + draft sheet + review + receipt)
  /demo-host        fake customer website to show the drop-in
  /api/chat         Mastra agent stream (AI SDK UI message stream)
  /api/draft/*      deterministic draft mutations (stepper, apply/keep, remove)
  /api/order        approve → mock submit → receipt
  /api/checkin      leftovers capture
  /api/demo/*       fast-forward clock, reset seed
Mastra
  orchestrator agent   Opus 5.5 · talks to the buyer · delegates to specialists (§5.2)
  specialist agents    intake · menu · product · allergen · pricing · history · order
  workflow "plan"      intake → menu → quantify → source → allergen check → price/stock → history → draft
  MCP server "aimo-products"  product & ingredient tools over the catalogue index (used by the product + allergen agents; exposed externally too)
Data
  data/catalog.index.json   built once from product JSON + CSVs (script)
  SQLite (Drizzle)          customers, events, orders, order_lines, leftovers, audit_log, drafts
External
  Valio mock APIs (server-side only, cached per (productId, date))
```

### 5.1 Embed (drag-and-drop)
- `public/widget.js` is a small vanilla script. It reads `data-customer`, `data-position` and `data-accent`, injects a launcher button, and opens an iframe pointing at `/embed`. The iframe isolates our styles from the host site and theirs from ours.
- The widget grows from bubble (≈ 380×600) to expanded panel (≈ min(1100px, 92vw) × 86vh) via `postMessage` to the parent script, which animates the iframe size.
- `/demo-host` is a believable but **fictional** caterer site (not a copy of any real company) with the snippet visibly embedded, to prove the drop-in.

### 5.2 Orchestrator and specialist agents (Mastra)

**Build order rule:** the first build task is to finalise this inventory as code stubs: each agent's name, responsibility, inputs and outputs, and tool list, with Zod schemas. Only then is any agent implemented. Each agent owns **one** job, and only its own tools. The orchestrator never calls a data tool directly; it delegates.

**Principle:** agents reason (language, menus, interpreting edits, judging matches). Tools compute and fetch. No agent invents a price, stock figure, quantity, allergen verdict or history figure; those come only from tool results.

| Agent | Responsible for | Tools it owns | Output |
|---|---|---|---|
| **Orchestrator** ("Aimo") | Talking to the buyer in their language; deciding which specialist to call next; composing short replies and choice buttons; never touching data directly | delegate-to-specialist (Mastra agent-as-tool), `emitProgress`, `askChoices` (renders 2–4 buttons + "type your own") | Chat messages, UI events |
| **Intake agent** | Pulling the five slots (date, guests, menu, budget, diets) out of free text in any language; spotting missing or odd values | `updateIntake`, `getCutoffForDate` | Slot state + missing list |
| **Menu agent** | Turning the menu into components with a portion category (chicken → `poultry_main`, rice → `grain_side`, + "needed for cooking" items); proposing optional add-ons as choices; diet variants (e.g. a gluten-free portion for 12 guests) | `getPortionRules`, `computeQuantities` | Component list with required kg/L |
| **Product agent** | Finding the best Valio Aimo product(s) for each component and ranking candidates (match, pack size fit, reliability, comparison price, CO₂); handling swaps ("cheaper chicken", "basmati instead") | **via MCP `aimo-products`:** `searchProducts`, `getProduct`, `getAlternatives` | Chosen product + 2 alternatives per component, with reasons |
| **Allergen agent** | Checking every chosen product against the stated diets/allergies (e.g. "does this contain EGG?"), and the 14 EU allergens plus lactose-free/vegan. Rejects or flags; "unknown" is never "safe" | **via MCP `aimo-products`:** `getIngredients`, `checkAllergens` | Pass / fail / unknown per line, with the ingredient evidence quoted |
| **Pricing & stock agent** | Live price, availability, cut-off, Terminal vs Stock, delivery reliability for the date; triggering substitution when something can't be delivered | `getPrices`, `getAvailability` (Valio API, batched + cached), `getReliability` | Priced, stock-checked lines + exceptions |
| **History agent** | Leftover ratios from past orders (§8.2) and the "Last time" text; parsing check-in replies into numbers | `getHistoryAdjustment`, `listPastOrders`, `recordLeftovers` | Per-line history suggestion + explanation |
| **Order agent** | Assembling the draft, applying edits, checking the budget, final re-validation, submitting **only** with the approval token, writing the receipt | `applyDraftChange`, `getDraft`, `validateForSubmit`, `submitOrder` (gated), `getReceipt` | Draft diffs, receipt |

**MCP server `aimo-products`.** Our own MCP server, built with Mastra's MCP server support, over `data/catalog.index.json`. Tools:
- `searchProducts(query, lang?, category?, excludeAllergens?, temperature?)`
- `getProduct(id)`
- `getAlternatives(id | component)`
- `getIngredients(id)`, which returns ingredient text + parsed allergens
- `checkAllergens(ids[], constraints[])`

The product and allergen agents use it through Mastra's MCP client, so the same interface an external purchasing agent would use is the one we use (openness criterion). It's served locally in development; there's a stdio/HTTP entry for external use.

**The plan workflow** runs the specialists in order: intake → menu → (choices) → product → allergen → pricing & stock → history → order/draft. Allergen and pricing checks run in parallel per line where they're independent. Every step emits progress events (`step.start` / `step.done` with a short label in the buyer's language and a count, e.g. "Found 9 matching products" or "Checked 9 products for egg and gluten"). These stream to the UI as data parts that drive the animated checklist. Edits after the draft exists go straight to the specialist that owns the change. "Make it 320 guests" goes to menu → order; "swap to basmati" goes to product → allergen → pricing → order. Nothing else re-runs.

**Every tool call** is typed with Zod and written to `audit_log` with the agent that made it.

- **Model use:** `claude-opus-5-5` for every agent. The orchestrator and the intake, allergen and pricing agents run at effort `low`; the menu and product agents at `medium`. Specialists get compact, cache-friendly system prompts. A full plan should feel quick, since the checklist shows progress throughout. Note: thinking cannot be disabled on Opus 5.5, so lower effort is the speed lever. Forced `tool_choice` (`any`/`tool`) returns a 400 on this model, so tool selection uses `auto` plus instructions, and structured steps (slot extraction, leftover parsing) use structured output / `strict` tool schemas. Use prompt caching on the stable system prompt and tool definitions. Fast mode (`speed: "fast"`) is an optional switch if demo latency hurts.

### 5.3 Catalogue index (build step)
`scripts/build-index.ts` reads the raw product JSON and the two CSVs. It writes `data/catalog.index.json` with one slim record per product: `id`, `nameEn`, `nameFi`, `category`, `salesUnit`, `salesUnitLabel` (human: "box", "bag", "piece", "kg"), `packNetKg` (or L), `packDescription` ("4 × 1.5 kg box"), `allowedLotSize`, `temperature` (frozen/chilled/ambient), `vendor`, `allergens[]` or `"unknown"`, `dietFlags` (lactose-free, gluten-free, vegan where derivable from name or ingredients), `reliability`, `co2PerKg`, plus a search text field. In-memory search uses MiniSearch with fuzzy and prefix matching, Finnish and English. The raw 87 MB file is **not** committed; the script downloads it, or reads it from a local path.

### 5.4 Price range
Each line has a quantity band `[qLow, qHigh]`:
- With history: `qLow = min(suggested, historyAdjusted)` and `qHigh = max(...)`.
- Without history: `qLow = suggested` and `qHigh = suggested + one pack` (the "safety pack" buyers usually add).
- `Total = Σ price × qLow … Σ price × qHigh`, excluding and including VAT. The range collapses to one number once the buyer has made every Apply/Keep choice.
- A **budget bar** under the total shows the budget. Going over it turns the bar into a warning and the agent proposes the cheapest swaps (by `comparisonPrice`) that get under budget.

### 5.5 Order submission (simulated)
`POST /api/order` checks the following again just before submitting:
- availability for the date
- that the cut-off time hasn't passed
- that there are no blocked lines

It then writes the order with a generated order number (`VA-2026-xxxxx`) and returns the receipt. The response carries a clear `simulated: true` flag. Any line that failed the final check comes back to the review screen, never silently dropped.

## 6. UI and brand

### 6.1 Layout (chosen: "C", a widget that expands into a panel)
- **Bubble state:** a navy launcher; the chat opens at ≈ 380 px wide.
- **Expanded state:** when the first draft is ready the panel grows (spring animation). The chat stays left at ≈ 380 px and the **order draft sheet** slides in from the right. The draft must clearly not look like chat, yet belong to the same product (user requirement).
- **Draft = "working sheet"** (chosen style 2):
  - a white card with a 10 px radius and a 2 px blue rule under the header ("Order draft · Wedding · 6 Dec · 320 pax")
  - column header row (Product · Qty · Price) on ice-blue, with items grouped by component (Protein, Sides, Sauce, …)
  - each row: product name in plain language, small blue tags ("in stock", "4 guests", "substitute", "supplier-delivered", "order by Thu 14:00"), a + / − quantity stepper showing human units ("50 kg", "12 boxes"), and the price right-aligned in tabular figures
  - footer on ice-blue: ESTIMATED TOTAL range, budget bar, primary button **Review & send**
- **"Last time" history note (chosen style B, soft warm glow):** a strip inside the row it belongs to. It uses a warm gradient fading into white (`#FFF6E8 → transparent`), rounded 8 px, no border, and a small amber history-clock icon. Text: "**Last time** you had 6 kg left over. History suggests **45 kg**." Actions: white pill "Use 45 kg", plain-text "Keep". After a choice the strip collapses to a single muted line ("History applied · −5 kg", with undo).
- **Changed rows** flash soft blue (`#EAF3FF`) for about 1.2 s; numbers count up or down.

Mockups from the session are in `docs/mockups/` (`layout.html`, `draft-style.html`, `draft-hybrid.html`, `history-note.html`). They are HTML fragments; open them in a browser to view.

### 6.2 Brand
Colour values are my guess at the Valio Aimo identity. **Builder: verify against valioaimo.fi before building and adjust the tokens.**
| Token | Value | Use |
|---|---|---|
| `--navy` | `#00205B` | Header, launcher, primary text, total bar |
| `--blue` | `#0057B8` | Primary buttons, user bubbles, accents, rules |
| `--sky` | `#E8F1FB` | Tags |
| `--ice` | `#F5F9FD` | Assistant bubbles, table header, footer |
| `--line` | `#D5E3F3` | Borders |
| `--warm` | `#FFF6E8` / icon `#C98A1B` | History notes only |
| `--ok` / `--warn` | `#1E8C5A` / `#C77700` | Status |
Type: Inter (or the Valio brand face if it's licensable). Use tabular figures for every number. No emoji in the UI, and no gradients other than the subtle page wash and the history glow.

### 6.3 Motion (the "wow", kept purposeful)
Library: Motion (Framer Motion).
- **Planning checklist:** each step appears with a pulsing dot. When it finishes, the dot turns into a check and a short result fades in ("9 products found"). While searching, product names flicker past in a small ticker under the step, to show real catalogue hits.
- **Draft build:** rows drop in one by one as they're sourced, prices count up from 0, and the total range settles last.
- **Panel expand:** a spring transition from bubble to two-column layout. The sheet slides in 24 px from the right with a fade.
- **Edits:** changed rows flash, steppers tick, and the total animates.
- **Approve:** the sheet folds into the receipt (a short scale-and-fade), with the order number stamped in.
- Respect `prefers-reduced-motion`.

### 6.4 Copy tone and language
Short, warm and professional, like a good Valio sales rep. Chat messages stay at 1–3 sentences, and detail goes into the sheet. Never show codes or units like `KI`; translate them.
- The agent replies in the language of the buyer's latest message, in any language Opus 5.5 handles.
- Product names are shown in the buyer's language when the catalogue has it (fi/sv/en); otherwise they're shown in English.
- Catalogue search always queries the Finnish and English names; the product agent translates the component into both.
- Fixed UI text (buttons, column headers, receipt labels) ships in English, Finnish and Swedish, chosen from the browser language and switched to match the conversation once the buyer writes. For other languages the agent's messages are translated and the fixed text falls back to English.

### 6.5 Minimalism rule
One accent colour, lots of white space, and no more than one primary button visible at a time. The widget has exactly four surfaces: chat, draft sheet, review/receipt, and My orders. Anything new must fit into one of them.

## 7. Autonomy and guardrails

| Action | Agent alone | Buyer must confirm |
|---|---|---|
| Extract slots, ask missing ones | ✅ | |
| Choose products for the menu | ✅ (shown as draft) | |
| Compute quantities | ✅ | |
| Apply history correction | | ✅ (Use/Keep per line) |
| Substitute an unavailable or blocked product | proposes it as a row tagged "substitute" with the reason | ✅ (implicit by approving the draft; highlighted on review) |
| Use a product with "allergens unknown" when a diet constraint applies | never by default; only if no safe option exists, flagged red | ✅ explicit |
| Exceed budget | never silently; flags it and proposes swaps | ✅ |
| Submit order | ❌ | ✅ Approve button only (the server checks an approval token issued by the UI click) |

**Exception handling (robustness, 15%):**
- Product unavailable on the date → find an alternative for the same component; else show the earliest `availableDate` and ask.
- `salesBlock` → exclude it and substitute.
- Terminal logistic model → tag "supplier-delivered, stock not guaranteed".
- Reliability < 0.9 → "may deliver short" tag, and suggest one extra pack.
- Cut-off passed for the date → warn at intake, and offer the next possible date.
- Valio API down or timing out → retry once, then show the last cached price with a "price from 10:42" note and block submit until it's fresh.
- Ambiguous menu ("something nice") → the agent proposes 2–3 menus as chips.
- Guest count unrealistic (0 or 50,000) → ask to confirm.

**Audit log:** every tool call, input summary, result summary, actor (agent/buyer) and timestamp, rendered as a readable timeline ("10:42 · Agent swapped Jasmine rice → Basmati rice: Jasmine not deliverable on 6 Dec") reachable from the receipt and the review screen.

## 8. History and learning

### 8.1 Seeded history
Six to ten past events for the demo customer over the last ~18 months (weddings, a Midsummer party, corporate lunches, a Christmas party). Each has real catalogue product ids, ordered quantities, and leftover or short amounts per line. The seed is designed to show:
- over-ordering of rice/grains of ~10%
- slight over-ordering of poultry (~10–12%)
- running short on one item at one event (rice, −5%)
- one category with no history (so no note appears; we never make a note up)

### 8.2 Calculation
- Per order line we store `ordered`, `leftover` (+) or `short` (−), and a **ratio** = leftover ÷ ordered (500 kg with 50 kg left = +10%; 20 kg short of 400 = −5%).
- For a new line, the ratio is looked up in this order of fallbacks:
  1. same product, similar event type
  2. same ingredient category (rice ↔ basmati ↔ jasmine; chicken fillet ↔ thigh)
  3. same category at any event
- Matching events are averaged with recency weighting (e.g. half-life ≈ 6 months).
- `historyAdjusted = suggested × (1 − ratio)`, rounded to packs. Minimum two data points or one very similar event, otherwise no note.
- The note always says what it's based on ("Based on 3 past weddings").

### 8.3 Check-in capture
- Lines are pre-filled from the order. The buyer's free-text reply is parsed with structured output into `{lineId, leftover|short|fine, amount, unit}`.
- The parsed table is shown back for confirmation. Lines not mentioned = "used up (0%)".
- On save, the lines land in `leftovers` and an audit entry is written.

## 9. Demo controls
A small settings icon visible only with `?demo=1` opens a panel with:
- **Fast-forward to day after event**, which sets a server-side clock offset and triggers the check-in
- **Reset demo data**, which re-seeds the database
- **Toggle latency mode** (fast mode on/off)

The real date and clock are used everywhere else.

### 9.1 Demo script (acceptance test)
1. Open `/demo-host`. Click the bubble. Type "We have a wedding on <date ~3 weeks out>, 300 guests, chicken and rice."
2. Chips show the date, 300 guests and chicken & rice. The agent asks about budget and allergies in one message. Answer "€1,500, 12 gluten-free and 4 lactose-free."
3. The checklist animates and the panel expands. The draft appears with real Valio products, prices, stock tags, and **Last time** notes on chicken and rice.
4. Click "Use 45 kg" on chicken. Type "make it 320 guests". The rows flash and the total updates.
5. Type "swap to basmati". The rice row changes.
6. Review & send → Approve. The receipt shows the order number and "Saved ~40 min vs manual ordering".
7. Demo controls → Fast-forward. The check-in appears. Reply "about 5 kg chicken left, rice ran out". Confirm the table.
8. New request, this time in Finnish: "Toiset häät, 250 vierasta, kanaa ja riisiä". The assistant answers in Finnish, and the chicken note now reflects the new data.
9. Open **My orders**: both orders are listed, and the first shows its receipt and the recorded leftovers.
10. Open the audit log; the whole story is readable, including which specialist did what ("Allergen agent: Basmati rice: no gluten, no egg ✓").

## 10. Openness (15%) and path to production
- Valio access sits behind a typed `ValioClient` interface; swapping the mock for production APIs means one adapter.
- The product and ingredient data is already served through our **MCP server `aimo-products`** (core, §5.2). The stretch goal is to also expose the pricing and order tools over MCP, with the same approval gate, so any external purchasing agent can run the guarded flow.
- The order draft and receipt are plain JSON with a published schema in `docs/`.
- A README section on assumptions, limitations, and what's needed for production: auth, customer-specific pricing, a real order endpoint, and verified allergen data.

## 11. Project shape (suggested)
```
/app            Next.js routes (embed, demo-host, api/*)
/src/mastra     orchestrator, agents/ (one file per specialist), workflow, tools
/src/mcp        aimo-products MCP server
/src/domain     portions, quantities, history, pricing range (pure, unit-tested)
/src/valio      API client + cache
/src/db         Drizzle schema, seed
/src/ui         widget components (chat, sheet, review, receipt, checklist)
/scripts        build-index.ts, seed.ts
/public         widget.js
/data           catalog.index.json (generated), portion-rules.json
```
Testing: unit tests for `/src/domain` (portion maths, pack rounding, history ratio, price range). One scripted end-to-end run of the demo script before presenting.

## 12. Calls I made (please check)
- Seven specialist agents plus an orchestrator, all on Opus 5.5 with per-agent effort levels. The MCP server covers products and ingredients; pricing and order tools stay as in-process tools (MCP for those is the stretch goal).
- Add-ons are off by default; "needed for cooking" items are added automatically but tagged.
- Fixed UI text in en/fi/sv; the agent's replies in any language.
- Order submission and history are simulated or seeded (Valio exposes neither).
- Allergens are derived from ingredient text; "unknown" is never treated as safe.
- The price range comes from quantity bands (§5.4), not from price uncertainty.
- History uses ratios with category fallback and recency weighting (§8.2).
- SQLite + Drizzle for local persistence; MiniSearch for the catalogue.
- Effort levels and the optional fast mode for latency (§5.2).
- Brand colours are guesses pending verification (§6.2).
- Portion rules (g/guest per component and event type) are a hand-written table in `data/portion-rules.json`, sourced from common catering guidelines.

## 13. Left to the builder
Component library choices within the visual spec, exact prompts, MiniSearch tuning, caching TTLs, DB schema details, test framework, and file layout below the top level.
