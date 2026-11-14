# Aimo Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the drop-in Valio Aimo ordering assistant described in `spec.md`, end to end, demo-ready.

**Architecture:** Next.js 16 App Router hosts the widget (`/embed`), a fictional host site (`/demo-host`), and API routes. A Mastra orchestrator agent (Opus 5.5) delegates to seven specialist agents. Specialists reason; deterministic tools (in `src/domain`, `src/catalog`, `src/valio`, `src/db`) compute and fetch. Product and ingredient tools are served by our own MCP server `aimo-products`. The UI streams AI SDK v7 UI messages with custom `data-*` parts (`src/contracts.ts`).

**Tech Stack:** next 16.4.6, react 19.3, @mastra/core 1.83.0, @mastra/mcp 2.9.0, @mastra/ai-sdk 1.12, ai 7.0.173, @ai-sdk/react, zod 4, drizzle-orm 0.45.4 + better-sqlite3 13, minisearch 7.2, motion 14, vitest 5, tailwindcss 4.

**Spec:** `spec.md` (read it first). **Contracts:** `src/contracts.ts` (all shared types; do not rename).

## Global Constraints
- Model: `anthropic/claude-opus-5-5` via Mastra model router (env `ANTHROPIC_API_KEY`). Never use forced `tool_choice` (`any`/`tool`): it returns a 400 on Opus 5.5. Thinking can't be disabled; lower `effort` for speed.
- Valio API: base `VALIO_API_BASE`, header `X-API-Key: VALIO_API_KEY`, server-side only. Always send header `User-Agent: Mozilla/5.0 (AimoPlanner)` because the host blocks default clients. Max 1000 products per request. Fixtures are in `docs/valio/sample-*.json`.
- No agent invents prices, stock, quantities, allergen verdicts or history numbers; those come only from tool results.
- "allergens unknown" is never treated as safe.
- Never show technical codes (`KI`, `ST`, product ids) to the buyer.
- Brand tokens (spec §6.2): navy `#00205B`, blue `#0057B8`, sky `#E8F1FB`, ice `#F5F9FD`, line `#D5E3F3`, warm `#FFF6E8` / icon `#C98A1B`, ok `#1E8C5A`, warn `#C77700`. Inter, tabular numbers, no emoji.
- Four widget surfaces only: chat, draft sheet, review/receipt, My orders.
- Next 16 has breaking changes. Read `node_modules/next/dist/docs/` before writing route or page code. Mastra docs are in `node_modules/@mastra/*/dist/docs/references/`.
- Do not edit `package.json`, `src/contracts.ts` or another task's directory. If you need a dependency or a contract change, stop and report it.
- Do not run `git commit`; the coordinator commits.

## Review Focus
1. A product with no ingredient data used for a gluten-free guest group must come back `allergen.verdict: 'unknown'` and tag `allergens_unknown`, never `pass`. (T1 test `checkAllergens unknown`)
2. A Valio price response with `error: true`, or an empty `scheduleLines`, must yield `ok:false` / `deliverable:false`, not a crash or €0 line. (T3 tests)
3. Pack rounding must never under-order: 47.2 kg needed with a 6 kg box → 8 boxes. (T2 test `packsFor rounds up`)
4. History with fewer than 2 data points and no very-similar event → `null` (no note). (T2 test `history needs evidence`)
5. Re-pricing a draft after an edit must not drop lines with `unitPrice: null`; the totals must exclude them and say so. (T2 test `totals skip unpriced`)

---

## Wave 1 (parallel; disjoint directories)

### Task 1: Catalogue index, search, allergens
**Files:** Create `scripts/build-index.ts`, `src/catalog/units.ts`, `src/catalog/allergens.ts`, `src/catalog/search.ts`, `src/catalog/index.ts`; generate `data/catalog.index.json`; tests in `src/catalog/*.test.ts`.
**Interfaces (Produces):**
- `parseAllergens(keyIngredientsText: string | undefined, ingredientNames: string[]): Allergen[] | 'unknown'`
- `deriveDietFlags(p: { nameEn: string; nameFi: string; allergens: Allergen[] | 'unknown' }): DietFlag[]`
- `deriveUnits(raw): { salesUnitLabel; packSize; packUnit; packDescription }` uses `units[]`, `unitConversions[].netWeight`, and name parsing ("4x1,5kg", "10 kg", "1 L")
- `loadCatalog(): CatalogProduct[]` (lazy singleton reading `data/catalog.index.json`)
- `getProduct(id: string): CatalogProduct | undefined`
- `searchProducts(q: SearchQuery): SearchHit[]` (MiniSearch over nameFi + nameEn, fuzzy 0.2, prefix; filters excludeAllergens: drop `'unknown'` too when excludeAllergens/requireDiet is non-empty, unless no safe hit exists, then return unknowns flagged in reasons; prefer food-service pack sizes; boost reliability ≥ 0.95)
- `getAlternatives(productId: string, limit?: number): SearchHit[]`
- `checkAllergens(ids: string[], constraints: { excludeAllergens?: Allergen[]; requireDiet?: DietFlag[] }): AllergenCheck[]`
- Script `npm run build:index` reads `data/raw/products.json`, `data/raw/reliability.csv`, `data/raw/carbon.csv`. Skip products without an English or Finnish name. Output under 25 MB.
- [ ] Tests: `parseAllergens` finds `egg`+`mustard` in the potato salad text "mayonnaise (... EGG YOLK ...), spices (MUSTARD SEED ...)"; `MILK`/`maito` → milk; `WHEAT`/`BARLEY`/`RYE`/`OATS` → gluten; no text and no ingredients → `'unknown'`. `deriveUnits` "Kariniemen Chicken breast fillet ... appr. 4,4 kg" gives packSize ≈ 4.4 kg. `searchProducts({query:'chicken breast fillet'})` top 5 contain a chicken fillet product; `searchProducts({query:'kana', ...})` works (Finnish); with `excludeAllergens:['gluten']` no hit has gluten. `checkAllergens unknown`: a product with allergens 'unknown' and constraint gluten_free → verdict 'unknown'.
- [ ] Run `npx vitest run src/catalog` → PASS. Run `npm run build:index` → prints product count (~15k+) and file size.

### Task 2: Domain maths (pure)
**Files:** Create `data/portion-rules.json`, `src/domain/portions.ts`, `src/domain/quantities.ts`, `src/domain/history.ts`, `src/domain/totals.ts`, `src/domain/draft.ts`; tests `src/domain/*.test.ts`.
**Interfaces (Produces):**
- `portion-rules.json`: `{ [category in PortionCategory]: { unit: MeasureUnit; perGuest: { default: number; [eventType]?: number } } }` in kg/l/pcs per guest (raw weight bought). Values from catalering guidelines, e.g. poultry_main 0.18 kg (wedding 0.20), grain_side 0.08 kg dry, potato_side 0.25, veg_side 0.12, salad 0.10, sauce 0.08 l, bread 0.06 kg, dessert 0.12 kg, dairy 0.05 l, beverage 0.3 l, cooking_fat 0.01 kg, seasoning 0.003 kg.
- `getPortion(category: PortionCategory, eventType: EventType): { amount: number; unit: MeasureUnit }`
- `requiredAmount(category, eventType, guests): { amount: number; unit: MeasureUnit }`
- `packsFor(required: number, product: Pick<CatalogProduct,'packSize'|'packUnit'|'allowedLotSize'>): PackPlan` rounds UP to whole packs (respects allowedLotSize ≥ 1; packSize 0 → treat as 1 pcs).
- `computeHistoryAdjustment(input: { productId: string; category: PortionCategory; eventType: EventType; suggestedQty: number; unit: MeasureUnit; records: LeftoverRecord[]; now: Date }): HistoryAdjustment | null`. Fallback order same_product (any event) → same_category_event → same_category. Ratio = Σ(wᵢ·leftoverᵢ/orderedᵢ)/Σwᵢ with wᵢ = 0.5^(ageDays/182). Requires ≥ 2 records, or 1 record with the same product and same eventType. `adjustedQty = suggested × (1 − ratio)`. `last` = the most recent record used.
- `computeTotals(lines: DraftLine[], budget: number | 'none' | undefined): DraftTotals`. Per line, qLow/qHigh packs: with history pending → min/max(historyPacks, suggestedPacks); history chosen → packs; no history → low = packs, high = packs + 1 for `requested` lines in categories poultry/meat/fish/veg_main/grain_side/potato_side, else packs. Unpriced lines are excluded. `collapsed` = no line has a pending history choice. Over budget = high > budget.
- `applyDraftChange(draft: Draft, change: DraftChange, ctx: { getProduct(id): CatalogProduct | undefined }): { draft: Draft; diff: DraftDiff }`. Pure; recomputes totals; adds the `updated` tag to changed lines and removes `updated` from the others; `scaleGuests` recomputes component amounts and line packs, preserving the product choices.
- [ ] Tests: `packsFor rounds up` (47.2 kg, pack 6 kg → 8 packs, quantity 48); `history needs evidence` (1 record, different product → null); ratio example 500 ordered / 50 left → 0.10 and adjusted 45 from 50; shortfall 400 / −20 → −0.05; recency weighting favours newer; `totals skip unpriced`; the total range collapses after all history choices; `applyDraftChange setPacks` marks only that line updated; `scaleGuests` 300→320 raises poultry packs.
- [ ] `npx vitest run src/domain` → PASS.

### Task 3: Valio client
**Files:** Create `src/valio/client.ts`, `src/valio/cache.ts`; tests `src/valio/client.test.ts` (mock `fetch` with `docs/valio/sample-*.json`).
**Interfaces (Produces):**
- `getPrices(ids: string[], date: ISODate): Promise<Map<string, PriceInfo>>`
- `getAvailability(ids: string[], date: ISODate): Promise<Map<string, AvailabilityInfo>>`
- `ping(): Promise<boolean>`
- Behaviour: dedupe ids; chunk at 1000; cache per `(endpoint, id, date)` for 10 min (cache.ts: `getCached/setCached`, injectable clock); retry once on network error or 5xx after 400 ms; timeout 8 s; on final failure return the stale cached value if one exists (keep its old `fetchedAt`), otherwise throw `ValioUnavailableError`. Terminal `availableAmount` 999999 → null. `deliverable = scheduleLines.length > 0 && !salesBlock && !line.salesBlock && (availableAmount ?? 1) > 0`. Normalise `availableDate` to YYYY-MM-DD.
- [ ] Tests: parses the fixture prices (460000 price 1.96, withTax 2.22, taxRate 13.5, comparison 4.9 KG); unknown id 999999999 → `ok:false`; availability unknown id → `deliverable:false`; chunks 2500 ids into 3 calls; cache hit makes no second fetch; 500 then 200 → succeeds after a retry; failure with a stale cache → returns stale.
- [ ] `npx vitest run src/valio` → PASS. Plus a live smoke script `scripts/valio-smoke.ts` (`npx tsx --env-file=.env.local scripts/valio-smoke.ts`) prints prices for 460000.

### Task 4: Database, repositories, seed
**Files:** Create `src/db/schema.ts`, `src/db/client.ts`, `src/db/repo.ts`, `src/db/seed.ts`, `scripts/seed.ts`; tests `src/db/repo.test.ts` (in-memory SQLite).
**Interfaces (Produces):**
- DB file `data/aimo.sqlite` (env `AIMO_DB_PATH` overrides; `:memory:` in tests). Tables: `customers`, `drafts` (id, conversationId, json, updatedAt), `orders` (id, customerId, eventName, eventType, eventDate, deliveryDate, guests, total, totalWithTax, receiptJson, submittedAt, checkInDone), `order_lines` (id, orderId, productId, productName, category, packs, quantity, unit, unitPrice), `leftovers` (orderId, lineId, productId, category, eventType, eventName, eventDate, orderedQty, leftoverQty, unit, recordedAt), `audit_log` (id, conversationId, orderId?, at, actor, action, summary, dataJson), `settings` (key, value) for the demo clock offset. Create tables on first open (idempotent `CREATE TABLE IF NOT EXISTS`, no migration tooling needed).
- `getDb()`; `saveDraft(d: Draft)`; `getDraftByConversation(conversationId): Draft | null`; `insertOrder(receipt: Receipt, draft: Draft): void`; `listOrders(customerId): OrderSummary[]`; `getReceipt(orderId): Receipt | null`; `getOrderLines(orderId)`; `listLeftoverRecords(customerId): LeftoverRecord[]`; `recordLeftovers(orderId, entries: Array<{ lineId: string; leftoverQty: number }>): void` (marks checkInDone); `appendAudit(e: Omit<AuditEntry,'id'|'at'>): AuditEntry`; `listAudit(filter: { conversationId?: string; orderId?: string }): AuditEntry[]`; `getClockOffsetDays(): number`; `setClockOffsetDays(n)`; `now(): Date` (real time + offset); `nextOrderId(): string` → `VA-2026-xxxxx`.
- Seed (`npm run seed`, `resetAndSeed()`): customer `helsinki-juhlapalvelu` "Helsinki Juhlapalvelu Oy". 8 past events over the last 18 months (2 weddings, Midsummer party, 3 corporate lunches, Christmas party, a buffet), each with 4–7 lines using REAL product ids found by grepping `data/raw/products.json` (chicken breast fillet, chicken thigh, rice (jasmine/basmati/parboiled), potatoes, cream, salad, bread, coffee). Leftovers: rice/grains about +10% on average, poultry +10–12%, one wedding with rice −5% (short), and no records at all for desserts. Each seeded order also gets a receipt and audit entries.
- [ ] Tests: insert/list orders round-trip; `recordLeftovers` sets `checkInDone`; `listLeftoverRecords` returns the seeded categories; `now()` honours the offset; `nextOrderId` is unique.
- [ ] `npx vitest run src/db` → PASS; `npm run seed` prints counts.

### Task 5: Widget UI (fixture-driven)
**Files:** `src/app/globals.css` (tokens), `src/app/layout.tsx` (Inter), `src/ui/**` (components), `src/ui/i18n.ts`, `src/ui/fixtures.ts`, `src/app/embed/page.tsx`, `src/app/demo-host/page.tsx`, `public/widget.js`, `src/app/page.tsx` (redirect or link to /demo-host).
**Interfaces (Produces):**
- `<Widget conversationId customerId mode="live"|"fixture" />` with internal views: `chat`, `review`, `receipt`, `orders`. In fixture mode it plays a scripted demo from `fixtures.ts` (wedding draft with chicken/rice history notes) so the UI can be judged without a backend.
- Presentational components with props typed from `src/contracts.ts`: `ChatThread`, `Composer`, `SlotChips({intake, missing, onEdit})`, `ChoiceButtons({event: ChoicesEvent, onSubmit(ids, freeText?)})`, `PlanningChecklist({events: ProgressEvent[]})`, `DraftSheet({draft, diff, onChange(change: DraftChange)})`, `DraftRow`, `HistoryNote({line, onChoose})` (style B: soft warm glow), `TotalsFooter({totals, onReview})`, `ReviewSheet({draft, onApprove, onBack})`, `ReceiptView({receipt, onOpenAudit})`, `AuditTimeline({entries})`, `MyOrders({orders, onOpen})`, `CheckInCard({event: CheckInEvent, onSubmit(text)})`, `DemoControls` (visible with `?demo=1`).
- `i18n.ts`: `t(key, lang: UiLang)` for all fixed strings in en/fi/sv; `uiLangFor(lang?: Lang): UiLang`.
- Motion (spec §6.3): checklist pulse → check; rows drop in one by one; prices count up; panel expand spring; changed rows flash `#EAF3FF` for 1.2 s; approve folds into the receipt; `prefers-reduced-motion` respected.
- Layout C: bubble (≈380×600) → expanded (min(1100px, 92vw) × 86vh). Inside the iframe the widget posts `{type:'aimo:resize', state:'bubble'|'chat'|'expanded'|'closed'}` to the parent; `public/widget.js` (vanilla, no deps) injects the launcher + iframe (`/embed?customer=…&demo=…`), animates size, and reads `data-customer`, `data-position`.
- `/demo-host`: a believable FICTIONAL caterer website (not a real company) with the snippet embedded.
- [ ] Verify: `npm run build` passes typecheck; open `/demo-host` → the bubble opens, fixture flow plays, the sheet edits work locally; take screenshots.

## Wave 2 (after Wave 1 merges)

### Task 6: MCP server, tools, specialist agents, orchestrator
**Files:** `src/mcp/aimo-products.ts` (MCPServer: tools `searchProducts`, `getProduct`, `getAlternatives`, `getIngredients`, `checkAllergens`), `src/mcp/client.ts` (MCPClient connecting in-process / stdio), `src/mcp/stdio.ts` (external entry), `src/mastra/tools/*.ts`, `src/mastra/agents/{orchestrator,intake,menu,product,allergen,pricing,history,order}.ts`, `src/mastra/index.ts`, `src/mastra/context.ts` (conversationId/customerId via requestContext).
- Tools emit `data-*` parts per `src/contracts.ts` (`progress`, `choices`, `slots`, `draft`, `receipt`, `checkin`) with `context.writer.custom`, and write `appendAudit` with their agent as the actor.
- Draft state lives in the DB (`saveDraft`/`getDraftByConversation`); tools load, mutate via `applyDraftChange`, and save.
- `submitOrder` requires `approvalToken` that matches the HMAC issued by `/api/order/approve` (env `AIMO_SECRET`). The agent cannot fabricate it.
- Effort: orchestrator/intake/allergen/pricing `low`, menu/product `medium` (Anthropic `providerOptions`).
- [ ] Tests: tools unit-tested with the catalogue/DB/domain (Valio mocked); one live agent smoke script `scripts/agent-smoke.ts` runs the wedding prompt and prints the tool sequence.

### Task 7: API routes and live wiring
**Files:** `src/app/api/chat/route.ts` (`handleChatStream`, version 'v7', agentId orchestrator, requestContext with conversationId/customerId), `src/app/api/draft/route.ts` (GET draft; POST DraftChange → applyDraftChange + re-price), `src/app/api/order/approve/route.ts` (issues token + submits via order tool path, returns Receipt), `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`, `src/app/api/audit/route.ts`, `src/app/api/checkin/route.ts`, `src/app/api/demo/route.ts` (fast-forward, reset). Widget `mode="live"` uses `useChat` and renders the data parts.
- [ ] Verify live: run the spec §9.1 demo script in Chrome end to end.

### Task 8: End-to-end polish
- Run the demo script 3×, fix latency hot spots, check Finnish, check `prefers-reduced-motion`, update README run instructions.
