# Build summary

What was built for the Junction 2026 Valio Aimo challenge "Trusted Trade Agents", how it was verified, and the decisions made along the way. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Requirements: [spec.md](spec.md).

## What works end to end (verified live against Claude Opus 5.5 and the Valio API)

1. **Drop-in widget:** one `<script>` tag on a mock, signed-in Valio Aimo page for the customer "Helsinki Juhlapalvelu Oy".
2. **Request in plain language:** "Wedding on 6 Dec, 300 guests, chicken and rice". The date, guest count and menu become chips, and the missing budget and diets are asked for in one message with buttons.
3. **Extras:** optional add-ons are offered as buttons and are off by default.
4. **Planning:** an animated 7-step checklist runs (about 20 s). The order draft then slides out with real Valio products, live prices and stock, and a total range against the budget.
5. **Learning from leftovers:** "Last time you had 6 kg left over. History suggests 27 kg." Use or Keep, per line.
6. **Stock and substitutions:** shortfalls are split onto a similar product, or offered as choices, and every substitution shows its reason.
7. **Edits:** + / − and remove buttons, or typed changes ("make it 320 guests", "swap to basmati", "cheaper chicken"). Changed rows flash and a one-line note appears in chat.
8. **Review and approve:** diets covered, substitutions, the order cut-off, totals excluding and including VAT. Approval is the buyer's click only. The receipt shows a simulated order number, VAT, a CO₂ estimate, time saved and the decision log.
9. **Check-in:** the demo fast-forward jumps to the day after the event. The buyer replies "about 5 kg chicken left, rice ran out" and gets an editable left/short table, which is saved and used for the next order.
10. **My orders:** past orders with receipts, recorded leftovers and "Reorder as new draft".
11. **Languages:** replies come in the buyer's language; fixed UI text is translated for English, Finnish and Swedish.

Quality gates: 180 automated tests and a clean type check. Every task was reviewed independently and fixed until approved, followed by a final whole-branch review and fix wave.

## Bugs caught by review and live runs (all fixed)

- Fish products marked allergen-free because their "ingredient" text was a sales note.
- Case sizes off by 6–12× (12 × 0.45 l read as 0.45 l).
- 225 kg of chicken for 300 guests, because the minimum order step for kilo-sold products was read as packs.
- A false "order deadline has passed" warning (the cut-off was misread).
- Lactose-free counted as safe for a milk allergy.
- Silly substitutions: mud cake became 38 kg of mint chocolate bars.
- A possible double order on a double-click.
- "Make it 320 guests" not changing the sheet.
- Draft total differing from the Review total.
- Reasoning text leaking into chat; replies running to 8 sentences.

## Decisions made on the team's behalf

| Decision | Why | Cost if wrong |
|---|---|---|
| Specialists call the model only where judgment is needed; allergen, pricing and history steps run as code under the specialist's name | About 20 s per plan, and every number comes from data | Less "agentic" under the hood than a pitch might imply |
| Only the buyer's Approve click submits; no agent tool can | Stronger than the spec's token-gated tool | none |
| The allergen check goes through the `aimo-products` MCP server; product search stays in-process | Real MCP use without slowing search | Don't claim the whole pipeline is MCP |
| Brand colours measured from valioaimo.fi (petrol `#005670`, lime `#C0E021`); Barlow Condensed stands in for their font; original robot icon, not their logo; host page marked as a prototype | Feels like Valio Aimo without copying trademark artwork | Swap in official assets if Valio allows |
| Sold-by-kg products are priced per kg × piece weight; lot sizes are normalised to packs | Matches Valio's data | Prices off if the reading is wrong |
| Cut-off for the requested date = requested date − Valio's lead time | `closingTime` refers to the earliest available date | Deadline a few days off |
| Shared items must satisfy every diet; diet coverage is one-way; unknown allergens need an explicit tick | Allergen safety over model judgment | Fewer product choices |
| History notes appear only when they change the amount; finer pack sizes are preferred | Meaningful notes, less waste | More packs per line |
| The 11 MB product index is committed | Nobody needs the 87 MB raw file | Repo size |
| The chat is persisted in the browser session (sessionStorage) | No new storage dependency | The transcript doesn't follow the buyer across devices |
| Order submission and history are simulated or seeded | Valio exposes no order or history API | n/a |

## Known limits

- Changing the delivery date rebuilds the draft and loses manual edits.
- The demo reset and fast-forward have no auth. Fine locally; protect them before any public deploy.
- The cut-off can be an hour off across a daylight-saving change.
- Finnish search for very short words ("kana") is noisy; the product agent picks among the candidates.
- Allergen data is derived from ingredient text by rules, which is conservative but not certified.
