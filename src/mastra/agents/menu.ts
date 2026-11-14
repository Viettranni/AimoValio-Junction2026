import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { Intake } from '@/contracts';
import { allergenSchema, dietFlagSchema, portionCategorySchema } from '@/mcp/schemas';
import { MODEL, cachedSystem, effort } from './model';

export const menuAgent = new Agent({
  id: 'menu',
  name: 'Menu',
  description: 'Turns the requested menu into components with portion categories, cooking needs, add-ons and diet variants.',
  instructions: cachedSystem(`You plan the components of a catering order for Valio Aimo, a Finnish food-service wholesaler.
Given the event intake and the add-ons the buyer switched on, list the components to source.
- One component per requested dish (origin "requested"). Pick the portion category that fits (chicken → poultry_main, rice → grain_side, potatoes → potato_side, cream sauce → sauce, ...).
- Add only what is needed to cook the requested dishes (cooking fat, sauce base, seasoning) with origin "needed_for_cooking". Keep these few: 0–3.
- One component per add-on the buyer chose, origin "addon". Never add other extras.
- If the menu is "you suggest", propose a classic menu for the event type: one main and two sides.
- Diet variants: for each diet need, add a variant of every requested component that the diet affects (a gluten-free bread, a lactose-free sauce). Set dietVariantOf to the base id, guests to the diet's guest count, requiredDiet (diet flags) and/or excludeAllergens (allergy). Reduce the base component's guests by the variant guests. Skip variants for components that naturally meet the diet (plain rice is gluten-free) and set the constraint on the base component instead only if ALL guests have it.
- guests: how many guests the component serves (total guests unless it is a variant).
- id: short stable slug "c-<word>", unique. label: in the buyer's language (lang). searchTerms: the product to search for, in Finnish (fi) and English (en), as a wholesale catalogue would name it ("broileri rintafilee" / "chicken breast fillet").`),
  model: MODEL,
  defaultOptions: effort('medium'),
});

export const menuPlanSchema = z.object({
  components: z.array(z.object({
    id: z.string(),
    label: z.string(),
    searchTerms: z.object({ fi: z.string(), en: z.string() }),
    category: portionCategorySchema,
    origin: z.enum(['requested', 'needed_for_cooking', 'addon']),
    guests: z.number().int(),
    dietVariantOf: z.string().nullable(),
    requiredDiet: z.array(dietFlagSchema).nullable(),
    excludeAllergens: z.array(allergenSchema).nullable(),
  })),
});
export type MenuComponentPlan = z.infer<typeof menuPlanSchema>['components'][number];

export async function planMenu({ intake, addons }: { intake: Intake; addons: string[] }): Promise<MenuComponentPlan[]> {
  const prompt = `Intake: ${JSON.stringify(intake)}\nAdd-ons chosen: ${addons.length ? addons.join(', ') : 'none'}`;
  const res = await menuAgent.generate(prompt, { structuredOutput: { schema: menuPlanSchema } });
  return res.object.components;
}
