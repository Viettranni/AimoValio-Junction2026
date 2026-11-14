import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { CatalogProduct, MenuComponent } from '@/contracts';
import { productToolsFor, toolFreeContext } from '@/mcp/client';
import { MODEL, cachedSystem, effort } from './model';

export const allergenAgent = new Agent({
  id: 'allergen',
  name: 'Allergen',
  description: 'Checks products against diets and the 14 EU allergens; "unknown" is never safe.',
  instructions: cachedSystem(`You check catering products against the buyer's diets and allergies (14 EU allergens plus lactose-free, gluten-free, vegan, vegetarian).
Verdicts come only from the checkAllergens and getIngredients tools of aimo-products; quote ingredient evidence (allergens are in CAPS in the source).
"unknown" (no ingredient data) is never safe. When asked to choose among products that all lack ingredient data, pick the one whose name and description most clearly indicate it meets the constraint (e.g. "gluteeniton", "laktoositon", "gluten free" in the name), and say why in one short English sentence. You never mark it safe.`),
  model: MODEL,
  tools: productToolsFor,
  defaultOptions: effort('low'),
});

const fallbackSchema = z.object({ productId: z.string(), note: z.string() });
export type UnknownFallbackChoice = z.infer<typeof fallbackSchema>;

/** Judgment call, only when no candidate verifiably passes and several have unknown allergens. */
export async function chooseUnknownFallback(
  { component, candidates }: { component: MenuComponent; candidates: CatalogProduct[] },
): Promise<UnknownFallbackChoice> {
  const payload = {
    component: { label: component.label, requiredDiet: component.requiredDiet, excludeAllergens: component.excludeAllergens },
    candidates: candidates.map((p) => ({ id: p.id, name: p.nameEn, nameFi: p.nameFi, pack: p.packDescription })),
  };
  const prompt = `None of these products has ingredient data. Choose the least risky one.\n${JSON.stringify(payload)}`;
  const res = await allergenAgent.generate(prompt, { structuredOutput: { schema: fallbackSchema }, requestContext: toolFreeContext() });
  return res.object;
}
