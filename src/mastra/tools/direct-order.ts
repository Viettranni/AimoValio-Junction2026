// Direct orders in the chat widget: the buyer already knows what they need ("1,000 litres of lactose-free milk by
// Monday"), so there is no menu to plan. The orchestrator finds the product with lookupProducts, then this tool puts
// the chosen products and amounts on a draft. From there it is the same path as an event draft: the sheet,
// Review (a fixed-price gateway offer) and Approve (the gateway's placeOrder with the customer's authority policy).
import { randomUUID } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { CatalogProduct, Draft, DraftLine, MenuComponent, PortionCategory } from '@/contracts';
import { checkAllergens, getProduct } from '@/catalog';
import { getDraftByConversation, now, saveDraft } from '@/db/repo';
import { deliverableOn } from '@/domain/cutoff';
import { computeTotals } from '@/domain/totals';
import { pendingOfferFor } from '@/gateway/store';
import { fetchValio } from '@/gateway/lookup';
import { policyFor } from '@/gateway/policies';
import { allergenSchema, dietFlagSchema } from '@/mcp/schemas';
import { earliestCutoff, productName, toLine } from '../pipeline/build-draft';
import { availablePacks } from '../pipeline/reprice';
import { getAimoContext, type AimoContext } from '../context';
import { audit, emitterFor, type Emit } from '../events';
import { validateIntake } from './understand-request';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const directOrderInputSchema = z.object({
  deliveryDate: z.string().describe('YYYY-MM-DD'),
  items: z.array(z.object({
    productId: z.string().describe('A productId from lookupProducts'),
    quantity: z.number().positive(),
    unit: z.enum(['packs', 'kg', 'l', 'pcs']).describe('"packs", or the product\'s own unit (kg, l, pcs) to have it rounded up to whole packs'),
  })).min(1).max(30),
  requireDiet: z.array(dietFlagSchema).optional().describe('Diets every item must meet, e.g. ["lactose_free"]'),
  excludeAllergens: z.array(allergenSchema).optional(),
  title: z.string().optional().describe('Short order title in the buyer\'s language, e.g. "Lactose-free milk"'),
  lang: z.string().describe("Language of the buyer's latest message (fi, en, sv, ...)"),
  replaceExisting: z.boolean().optional().describe('True only when the buyer wants this instead of the open draft'),
});
export type DirectOrderInput = z.infer<typeof directOrderInputSchema>;

/** Portion category for order history; a direct order has no menu, so it is inferred roughly from the product. */
function groupOf(p: CatalogProduct): PortionCategory {
  if (p.allergens !== 'unknown' && p.allergens.includes('milk')) return 'dairy';
  return p.packUnit === 'l' ? 'beverage' : 'veg_side';
}

export async function runDirectOrder(input: DirectOrderInput, ctx: AimoContext, emit: Emit) {
  const existing = getDraftByConversation(ctx.conversationId);
  if (existing?.status === 'ready') {
    if (pendingOfferFor(existing)) throw new Error('The open draft is waiting for the purchasing manager\'s approval; it cannot be replaced until they decide.');
    if (!input.replaceExisting) {
      throw new Error('An order draft is already open. To add these products to it use editDraft; to start a separate order instead, ask the buyer and call again with replaceExisting true.');
    }
  }
  const today = now();
  const { intake: checked, warnings } = validateIntake({ deliveryDate: input.deliveryDate }, today, null);
  if (!checked.deliveryDate) throw new Error(warnings.join(' '));
  const date = checked.deliveryDate;
  const lang = input.lang || 'en';
  const constraints = { excludeAllergens: input.excludeAllergens, requireDiet: input.requireDiet };

  const problems: string[] = [];
  const picked: Array<{ product: CatalogProduct; amount: number }> = [];
  for (const item of input.items) {
    const p = getProduct(item.productId);
    if (!p) { problems.push(`Unknown product ${item.productId}; look it up again`); continue; }
    if (item.unit !== 'packs' && item.unit !== p.packUnit) {
      problems.push(`${productName(p, lang)} is sold in ${p.packDescription}; give the amount in packs or ${p.packUnit}`);
      continue;
    }
    const lot = Math.max(1, p.allowedLotSize);
    const amount = item.unit === 'packs' ? Math.ceil(item.quantity / lot - 1e-9) * lot * p.packSize : item.quantity;
    picked.push({ product: p, amount });
  }
  if (!picked.length) throw new Error(`Nothing could be put on the draft: ${problems.join('; ')}`);

  const { prices, avail } = await fetchValio(picked.map((x) => x.product.id), date);
  const sourced = { prices, availability: avail };
  const components: MenuComponent[] = [];
  const lines: DraftLine[] = [];
  picked.forEach(({ product: p, amount }, i) => {
    const allergen = checkAllergens([p.id], constraints)[0];
    const name = productName(p, lang);
    if (allergen.verdict === 'fail') {
      problems.push(`${name} does not meet the requirements (${allergen.evidence ?? [...allergen.conflicts, ...allergen.unmetDiets].join(', ')}); left out`);
      return;
    }
    const component: MenuComponent = {
      id: `c-item-${i + 1}`, label: name, searchTerms: { fi: p.nameFi, en: p.nameEn }, category: groupOf(p), origin: 'requested',
      guests: 0, requiredAmount: amount, requiredUnit: p.packUnit,
      ...(input.requireDiet?.length ? { requiredDiet: input.requireDiet } : {}),
      ...(input.excludeAllergens?.length ? { excludeAllergens: input.excludeAllergens } : {}),
    };
    const line = toLine({ component, product: p, allergen, reason: 'Chosen by the buyer', alternatives: [] }, `l-${lines.length + 1}`, lang, sourced, date);
    components.push(component);
    lines.push(line);
    const a = avail.get(p.id);
    if (!prices.get(p.id)?.ok) problems.push(`${name}: Valio gives no price for it`);
    if (!a || !deliverableOn(a, date)) {
      problems.push(`${name}: not deliverable on ${date}${a?.availableDate ? ` (earliest ${a.availableDate})` : ''}; offer another date or product`);
    } else if (a.logisticModel === 'Stock') {
      const stock = availablePacks(p, a);
      if (stock !== null && stock < line.packs) problems.push(`${name}: only ${stock} of ${line.packs} packs in stock for ${date}; offer a second product for the rest or a smaller amount`);
    }
    if (allergen.verdict === 'unknown' && (input.requireDiet?.length || input.excludeAllergens?.length)) {
      problems.push(`${name}: allergens can't be verified (${allergen.evidence ?? 'no ingredient data'}); the buyer must confirm the line in Review`);
    }
  });
  if (!lines.length) throw new Error(`Nothing could be put on the draft: ${problems.join('; ')}`);

  const intake = {
    deliveryDate: date, lang, budget: 'none' as const, diets: 'none' as const, eventType: 'other' as const,
    eventName: input.title?.trim() || lines.map((l) => l.productName).slice(0, 2).join(', '),
    menu: lines.map((l) => l.productName),
  };
  const draft: Draft = {
    id: randomUUID(), conversationId: ctx.conversationId, customerId: ctx.customerId, intake, components, lines,
    totals: computeTotals(lines, 'none'), cutoff: earliestCutoff(lines, date), status: 'ready', updatedAt: today.toISOString(),
  };
  saveDraft(draft);
  await emit({ type: 'data-draft', data: { draft } });
  audit(ctx.conversationId, 'order', 'directOrder',
    `Direct order draft for ${date}: ${lines.map((l) => `${l.packs} × ${l.productName}`).join(', ')}, €${round2(draft.totals.low)} excl. VAT`,
    { draftId: draft.id, items: input.items, problems });

  const policy = policyFor(ctx.customerId);
  const cutoffPassed = !!draft.cutoff && Date.parse(draft.cutoff) < today.getTime();
  if (cutoffPassed) problems.push(`The order cut-off for ${date} has passed (${draft.cutoff}); offer the next possible date`);
  return {
    lines: lines.map((l) => ({
      product: l.productName, packs: l.packs, pack: l.packDescription, quantity: `${round2(l.quantity)} ${l.unit}`,
      lineTotal: l.unitPrice === null ? null : round2(l.packs * l.unitPrice),
    })),
    total: round2(draft.totals.low),
    totalWithTax: round2(draft.totals.lowWithTax),
    cutoff: draft.cutoff,
    problems,
    authority: draft.totals.low > policy.autoApproveLimitEur
      ? `Above the €${policy.autoApproveLimitEur} limit: after the buyer approves in Review it goes to ${policy.approver.name} (${policy.approver.role}) for sign-off.`
      : `Within the €${policy.autoApproveLimitEur} limit: it is ordered when the buyer approves in Review.`,
  };
}

export function createDirectOrderTool() {
  return createTool({
    id: 'draftDirectOrder',
    description:
      'Puts products the buyer asked for directly (no event or menu to plan, e.g. "1,000 l lactose-free milk by Monday") on an order draft, ' +
      'with live prices and stock for the date. Use productIds from lookupProducts. The sheet opens by itself; the buyer reviews and approves there ' +
      '(the Valio Aimo gateway applies the authority policy). Never submits. Returns the lines, total excl. VAT, cut-off, problems and what approval it needs.',
    inputSchema: directOrderInputSchema,
    execute: async (input, context) => runDirectOrder(input, getAimoContext(context.requestContext), emitterFor(context.writer)),
  });
}
