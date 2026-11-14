// Read-only lookups for the orchestrator, so it can answer the buyer's questions from data instead of guessing:
// lookupProducts (catalogue + live Valio price/stock for the delivery date) and readDraft (the order sheet in detail).
// Valio is queried only for the handful of products a lookup returns, never for the catalogue.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { CatalogProduct, Draft, ISODate, SearchHit } from '@/contracts';
import { getProduct, searchProducts } from '@/catalog';
import { getDraftByConversation, now } from '@/db/repo';
import { neededAmount, productName } from '../pipeline/build-draft';
import { availabilityFor, fetchValio, pricingFor } from '@/gateway/lookup';
import { allergenSchema, dietFlagSchema } from '@/mcp/schemas';
import { getAimoContext, type AimoContext } from '../context';
import { audit } from '../events';

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The next weekday after today (demo clock): the default date for a price check without a draft. */
export function nextDeliveryDay(today: Date): ISODate {
  let d = new Date(today.getTime() + DAY_MS);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + DAY_MS);
  return isoDay(d);
}

const allergensOf = (p: CatalogProduct) =>
  p.allergens === 'unknown' ? 'unknown (no ingredient data)' : p.allergens.length ? p.allergens : 'none of the 14 EU allergens';

export const lookupInputSchema = z.object({
  searches: z.array(z.object({
    en: z.string().describe('What to look for, in English, e.g. "basmati rice"'),
    fi: z.string().describe('The same in Finnish, e.g. "basmatiriisi"'),
  })).min(1).max(4).describe('One entry per product kind; several to compare (e.g. jasmine vs basmati rice)'),
  deliveryDate: z.string().optional().describe('YYYY-MM-DD; defaults to the draft\'s delivery date, else the next weekday'),
  requireDiet: z.array(dietFlagSchema).optional().describe('Only products verified to meet these diets'),
  excludeAllergens: z.array(allergenSchema).optional().describe('Only products verified free of these allergens'),
  perSearch: z.number().int().min(1).max(6).optional().describe('Products per search, default 4'),
});
export type LookupInput = z.infer<typeof lookupInputSchema>;

function hitsFor(s: { en: string; fi: string }, input: LookupInput, limit: number): CatalogProduct[] {
  const best = new Map<string, SearchHit>();
  for (const query of [...new Set([s.en, s.fi].filter(Boolean))]) {
    for (const hit of searchProducts({ query, excludeAllergens: input.excludeAllergens, requireDiet: input.requireDiet, limit: limit * 2 })) {
      const prev = best.get(hit.product.id);
      if (!prev || hit.score > prev.score) best.set(hit.product.id, hit);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((h) => h.product);
}

export async function runLookupProducts(input: LookupInput, ctx: AimoContext) {
  const draft = getDraftByConversation(ctx.conversationId);
  const today = now();
  const date = input.deliveryDate ?? (draft?.status !== 'submitted' ? draft?.intake.deliveryDate : undefined) ?? nextDeliveryDay(today);
  const lang = draft?.intake.lang ?? 'en';
  const limit = input.perSearch ?? 4;
  const groups = input.searches.map((s) => ({ search: s.en, products: hitsFor(s, input, limit) }));
  const ids = [...new Set(groups.flatMap((g) => g.products.map((p) => p.id)))];
  let valio: Awaited<ReturnType<typeof fetchValio>> | null = null;
  let priceError: string | undefined;
  if (ids.length) {
    try {
      valio = await fetchValio(ids, date);
    } catch (e) {
      priceError = `Valio prices and stock are unavailable right now (${(e as Error).message})`;
    }
  }
  const results = groups.map((g) => ({
    search: g.search,
    products: g.products.map((p) => {
      const pricing = valio ? pricingFor(p, valio.prices.get(p.id)) : null;
      const a = valio ? availabilityFor(p, valio.avail.get(p.id), date, today.getTime()) : null;
      return {
        productId: p.id,
        name: productName(p, lang),
        pack: p.packDescription,
        pricePerPack: pricing?.pricePerPack ?? null,
        comparisonPrice: pricing?.comparisonPrice != null ? `${pricing.comparisonPrice} €/${(pricing.comparisonUnit ?? p.packUnit).toLowerCase()}` : null,
        stock: !a ? 'unknown'
          : !a.deliverableOnDate ? `not deliverable on ${date}${a.reason ? ` (${a.reason})` : ''}`
          : a.logisticModel === 'Terminal' ? 'supplier-delivered, stock not guaranteed'
          : a.availablePacks !== null ? `${a.availablePacks} packs in stock` : 'in stock',
        cutoff: a?.cutoff ?? null,
        allergens: allergensOf(p),
        diets: p.dietFlags,
        deliveryReliability: p.reliability,
        co2KgPerKg: p.co2PerKg,
      };
    }),
  }));
  audit(ctx.conversationId, 'product', 'lookupProducts',
    `Looked up ${input.searches.map((s) => s.en).join(', ')} for ${date}: ${ids.length} products`, { input, ids });
  return {
    deliveryDate: date,
    ...(priceError ? { priceError } : {}),
    note: 'Prices are Valio list prices excl. VAT per pack; comparisonPrice is per kg or litre. Only these products were priced.',
    results,
  };
}

export function createLookupProductsTool() {
  return createTool({
    id: 'lookupProducts',
    description:
      'Read-only catalogue lookup: finds Valio Aimo products and returns their pack, live price per pack and per kg/l, stock and cut-off for the delivery date, ' +
      'allergens, diet flags, delivery reliability and CO2. Use it to answer product questions ("what\'s cheaper, jasmine or basmati?", "do you have lactose-free cream?") ' +
      'and to find products for a direct order. Changes nothing.',
    inputSchema: lookupInputSchema,
    execute: async (input, context) => runLookupProducts(input, getAimoContext(context.requestContext)),
  });
}

// ── The order sheet in detail ──

function perGuest(draft: Draft, line: Draft['lines'][number]): string | null {
  const c = draft.components.find((x) => x.id === line.componentId);
  const guests = line.dietGuests ?? c?.guests ?? draft.intake.guests;
  if (!c || !guests) return null;
  // The whole dish (a split line's share counts with its sibling) against the dish's guests.
  const root = c.id.replace(/-more$/, '');
  const family = draft.components.filter((x) => x.id === root || x.id === `${root}-more`);
  const familyGuests = family.reduce((s, x) => s + x.guests, 0) || guests;
  const total = draft.lines.filter((l) => family.some((x) => x.id === l.componentId) && l.unit === line.unit)
    .reduce((s, l) => s + l.quantity, 0) || line.quantity;
  const per = total / familyGuests;
  if (line.unit === 'kg') return `${Math.round(per * 1000)} g per guest (${round2(total)} kg for ${familyGuests} guests)`;
  if (line.unit === 'l') return `${Math.round(per * 1000)} ml per guest (${round2(total)} l for ${familyGuests} guests)`;
  return `${round2(per)} pcs per guest`;
}

export function draftDetails(draft: Draft) {
  const eventType = draft.intake.eventType ?? 'other';
  return {
    status: draft.status === 'submitted' ? 'ordered (the order card shows its status)' : draft.status,
    event: draft.intake,
    cutoff: draft.cutoff,
    totals: {
      low: round2(draft.totals.low), high: round2(draft.totals.high), lowWithTax: round2(draft.totals.lowWithTax),
      highWithTax: round2(draft.totals.highWithTax), budget: draft.totals.budget, overBudget: draft.totals.overBudget,
      note: 'EUR excl. VAT unless "WithTax"; low and high differ while history notes are pending',
    },
    lines: draft.lines.map((l) => {
      const p = getProduct(l.productId);
      const c = draft.components.find((x) => x.id === l.componentId);
      return {
        lineId: l.id,
        dish: c?.label ?? null,
        product: l.productName,
        group: l.group,
        packs: l.packs,
        pack: l.packDescription,
        quantity: `${round2(l.quantity)} ${l.unit}`,
        perGuest: perGuest(draft, l),
        portionRuleNeed: c ? `${round2(neededAmount(c, eventType))} ${c.requiredUnit}` : null,
        pricePerPack: l.unitPrice,
        lineTotal: l.unitPrice === null ? null : round2(l.packs * l.unitPrice),
        tags: l.tags.filter((t) => t !== 'updated'),
        allergens: p ? allergensOf(p) : 'unknown',
        diets: p?.dietFlags ?? [],
        checkedFor: c?.requiredDiet?.length || c?.excludeAllergens?.length
          ? { requireDiet: c.requiredDiet ?? [], excludeAllergens: c.excludeAllergens ?? [], verdict: l.allergen.verdict, evidence: l.allergen.evidence ?? null }
          : 'no diet constraint on this line',
        ...(l.dietGuests ? { forDietGuests: l.dietGuests } : {}),
        ...(l.substituteFor ? { replaces: l.substituteFor.productName, why: l.substituteFor.reason } : {}),
        ...(l.history ? {
          historyNote: {
            choice: l.history.choice, suggestedPacks: l.history.suggestedPacks, historyPacks: l.history.historyPacks,
            basis: l.history.adjustment.basis, leftoverRatio: round2(l.history.adjustment.ratio),
          },
        } : {}),
      };
    }),
  };
}

export function createReadDraftTool() {
  return createTool({
    id: 'readDraft',
    description:
      'Read-only: the current order draft in detail (every line with product, packs, quantity, amount per guest, price, stock tags, allergens, ' +
      'diet checks, substitutions and history notes; totals, budget and order cut-off). Use it to answer questions about the draft ' +
      '("is this gluten-free?", "how much rice per person?", "why this product?"). Changes nothing.',
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = getAimoContext(context.requestContext);
      const draft = getDraftByConversation(ctx.conversationId);
      if (!draft || draft.status === 'building') return { draft: null, note: 'No order draft yet.' };
      return { draft: draftDetails(draft) };
    },
  });
}
