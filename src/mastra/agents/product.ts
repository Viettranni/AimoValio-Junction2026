import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { CatalogProduct, Lang, MenuComponent, PriceInfo } from '@/contracts';
import { packPrice } from '../pipeline/reprice';
import { productToolsFor, toolFreeContext } from '@/mcp/client';
import { MODEL, cachedSystem, effort } from './model';

export const productAgent = new Agent({
  id: 'product',
  name: 'Product',
  description: 'Chooses the best Valio Aimo product and two alternatives for each menu component.',
  instructions: cachedSystem(`You choose wholesale products from the Valio Aimo catalogue for catering menu components.
For each component pick the best candidate and rank two alternatives, judging:
1. It really is the food asked for (fillet for "chicken", plain long-grain rice for "rice"; not a ready meal, snack or seasoning mix unless asked).
2. Food-service pack sizes in the component's unit beat consumer packs.
3. Reliable delivery (reliability ≥ 0.95) and lower CO2 as tie-breakers.
4. Diet variants must meet requiredDiet / excludeAllergens; candidates with unknown allergens are a last resort.
5. If the buyer's request asks for something cheaper, pick the candidate with the lowest comparison price (€ per kg/l) that is still the right food; never pick a pricier one.
Only use product ids from the candidates you are given. reason: one short English sentence.
When you are asked to find products yourself, use the aimo-products tools (searchProducts, getProduct, getAlternatives).`),
  model: MODEL,
  tools: productToolsFor,
  defaultOptions: effort('medium'),
});

export const productPicksSchema = z.object({
  picks: z.array(z.object({
    componentId: z.string(),
    productId: z.string(),
    alternatives: z.array(z.string()),
    reason: z.string(),
  })),
});
export type ProductPick = z.infer<typeof productPicksSchema>['picks'][number];

export interface PickProductsInput {
  lang: Lang;
  components: MenuComponent[];
  candidates: Map<string, CatalogProduct[]>;
  /** Known only for edits, where candidates are priced before the pick. */
  prices?: Map<string, PriceInfo>;
  /** The buyer's own words for an edit, e.g. "cheaper chicken". */
  request?: string;
}

function describe(p: CatalogProduct, price: PriceInfo | undefined) {
  const priced = price?.ok && price.comparisonPrice !== undefined;
  return {
    id: p.id, name: p.nameEn, nameFi: p.nameFi, pack: p.packDescription, packSize: p.packSize, packUnit: p.packUnit,
    allergens: p.allergens, diets: p.dietFlags, reliability: p.reliability, co2PerKg: p.co2PerKg,
    ...(priced ? { comparisonPrice: `${price.comparisonPrice} €/${(price.comparisonUnit ?? p.packUnit).toLowerCase()}`, packPrice: packPrice(p, price).unitPrice } : {}),
  };
}

/** One call for all components: the candidates are already searched, so no tools are needed. */
export async function pickProducts({ lang, components, candidates, prices, request }: PickProductsInput): Promise<ProductPick[]> {
  const payload = components.map((c) => ({
    componentId: c.id, label: c.label, category: c.category, need: `${c.requiredAmount} ${c.requiredUnit}`,
    requiredDiet: c.requiredDiet, excludeAllergens: c.excludeAllergens,
    candidates: (candidates.get(c.id) ?? []).map((p) => describe(p, prices?.get(p.id))),
  }));
  const ask = request ? `Buyer request: ${request}\n` : '';
  const prompt = `Buyer language: ${lang}\n${ask}Components and candidates:\n${JSON.stringify(payload)}`;
  const res = await productAgent.generate(prompt, { structuredOutput: { schema: productPicksSchema }, requestContext: toolFreeContext() });
  return res.object.picks;
}
