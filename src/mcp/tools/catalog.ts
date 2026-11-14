// Catalogue tools: search, product details, alternatives, ingredients, allergen checks. No identity needed.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { checkAllergens, getAlternatives, getProduct, searchProducts } from '@/catalog';
import {
  allergenCheckSchema, allergenSchema as allergen, dietFlagSchema as dietFlag, portionCategorySchema,
  productSchema, temperatureSchema,
} from '../schemas';

const hitsSchema = z.object({
  hits: z.array(z.object({ product: productSchema, score: z.number(), reasons: z.array(z.string()) })),
});
const readOnly = { mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } } };

export const searchProductsTool = createTool({
  id: 'searchProducts',
  description:
    'Search the Valio Aimo catalogue by product name (Finnish and English names are indexed). ' +
    'Optionally drop products containing given allergens or not meeting diets; "allergens unknown" products are only returned when nothing verified matches.',
  inputSchema: z.object({
    query: z.string().describe('Search words in any language, best in Finnish or English'),
    category: portionCategorySchema.optional().describe('What the product is for (hint only)'),
    excludeAllergens: z.array(allergen).optional(),
    requireDiet: z.array(dietFlag).optional(),
    temperature: temperatureSchema.optional(),
    limit: z.number().int().min(1).max(50).optional().describe('Default 8'),
  }),
  outputSchema: hitsSchema,
  ...readOnly,
  execute: async ({ category, ...rest }) => ({ hits: searchProducts({ ...rest, categoryHint: category }) }),
});

export const getProductTool = createTool({
  id: 'getProduct',
  description: 'Get one catalogue product by id (pack size, unit, allergens, diets, reliability, CO2).',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ product: productSchema.nullable() }),
  ...readOnly,
  execute: async ({ id }) => ({ product: getProduct(id) ?? null }),
});

export const getAlternativesTool = createTool({
  id: 'getAlternatives',
  description: 'Products similar to the given one (same category first), for substitutions.',
  inputSchema: z.object({ productId: z.string(), limit: z.number().int().min(1).max(20).optional() }),
  outputSchema: hitsSchema,
  ...readOnly,
  execute: async ({ productId, limit }) => ({ hits: getAlternatives(productId, limit) }),
});

export const getIngredientsTool = createTool({
  id: 'getIngredients',
  description: 'Ingredient text (allergens in CAPS as in the source) and parsed allergens and diet flags for a product.',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({
    productId: z.string(),
    found: z.boolean(),
    ingredientsText: z.string().nullable(),
    allergens: z.union([z.array(allergen), z.literal('unknown')]),
    ingredientData: z.boolean().describe('false: allergens come from the product name only, not an ingredient list'),
    dietFlags: z.array(dietFlag),
  }),
  ...readOnly,
  execute: async ({ id }) => {
    const p = getProduct(id);
    return {
      productId: id,
      found: !!p,
      ingredientsText: p?.keyIngredientsText ?? null,
      allergens: p?.allergens ?? 'unknown',
      ingredientData: p?.ingredientData ?? false,
      dietFlags: p?.dietFlags ?? [],
    };
  },
});

export const checkAllergensTool = createTool({
  id: 'checkAllergens',
  description:
    'Check products against allergens to exclude and diets to meet. Verdict pass / fail / unknown; unknown means no ingredient data and is never safe.',
  inputSchema: z.object({
    ids: z.array(z.string()).min(1),
    excludeAllergens: z.array(allergen).optional(),
    requireDiet: z.array(dietFlag).optional(),
  }),
  outputSchema: z.object({ checks: z.array(allergenCheckSchema) }),
  ...readOnly,
  execute: async ({ ids, ...constraints }) => ({ checks: checkAllergens(ids, constraints) }),
});

export const catalogTools = [searchProductsTool, getProductTool, getAlternativesTool, getIngredientsTool, checkAllergensTool];
