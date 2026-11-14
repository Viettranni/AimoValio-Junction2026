import { z } from 'zod';
import { EU_ALLERGENS } from '@/contracts';

// Zod mirrors of the enums in src/contracts.ts, shared by the MCP tools and the agents.
export const allergenSchema = z.enum(EU_ALLERGENS);
export const dietFlagSchema = z.enum(['lactose_free', 'gluten_free', 'vegan', 'vegetarian']);
export const temperatureSchema = z.enum(['frozen', 'chilled', 'ambient', 'unknown']);
export const measureUnitSchema = z.enum(['kg', 'l', 'pcs']);
export const eventTypeSchema = z.enum(['wedding', 'corporate_lunch', 'party', 'buffet', 'school', 'other']);
export const portionCategorySchema = z.enum([
  'poultry_main', 'meat_main', 'fish_main', 'veg_main', 'grain_side', 'potato_side', 'veg_side', 'salad',
  'sauce', 'bread', 'dessert', 'dairy', 'beverage', 'cooking_fat', 'seasoning',
]);

export const productSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameFi: z.string(),
  nameSv: z.string().optional(),
  category: z.string(),
  salesUnit: z.string(),
  salesUnitLabel: z.object({ en: z.string(), fi: z.string(), sv: z.string() }),
  packSize: z.number(),
  packUnit: measureUnitSchema,
  packDescription: z.string(),
  allowedLotSize: z.number(),
  temperature: temperatureSchema,
  vendor: z.string(),
  allergens: z.union([z.array(allergenSchema), z.literal('unknown')]),
  dietFlags: z.array(dietFlagSchema),
  keyIngredientsText: z.string().optional(),
  reliability: z.number().nullable(),
  co2PerKg: z.number().nullable(),
});

export const allergenCheckSchema = z.object({
  productId: z.string(),
  verdict: z.enum(['pass', 'fail', 'unknown']),
  conflicts: z.array(allergenSchema),
  unmetDiets: z.array(dietFlagSchema),
  evidence: z.string().optional(),
});
