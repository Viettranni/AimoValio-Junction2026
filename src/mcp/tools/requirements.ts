import { z } from 'zod';
import { allergenSchema, dietFlagSchema } from '../schemas';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const requirementsSchema = z.object({
  excludeAllergens: z.array(allergenSchema).optional().describe('EU allergens the products must not contain'),
  requireDiet: z.array(dietFlagSchema).optional().describe('Diets every product must meet, e.g. ["lactose_free"]'),
}).describe("The buyer's requirements; lines that fail or can't be verified need a human sign-off");
