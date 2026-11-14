import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { ISODate, Intake } from '@/contracts';
import { allergenSchema, dietFlagSchema, eventTypeSchema } from '@/mcp/schemas';
import { MODEL, cachedSystem, effort } from './model';

export const intakeAgent = new Agent({
  id: 'intake',
  name: 'Intake',
  description: 'Extracts the five order slots (delivery date, guests, menu, budget, diets) from free text in any language.',
  instructions: cachedSystem(`You extract catering order details from a buyer's message for Valio Aimo, a Finnish food-service wholesaler.
Return only what the message (plus the current slots) states. Use null for anything not stated; never guess numbers.
- lang: language of THIS message as a short code (fi, en, sv, et, de, ...).
- deliveryDate: YYYY-MM-DD. Resolve relative dates ("next Friday", "6.12.", "lauantaina") against today's date given in the prompt; a date without a year is the next upcoming one.
- guests: total head count.
- menu: dishes or foods named, as short phrases in the buyer's words (e.g. ["chicken", "rice"]). If the buyer asks you to suggest the menu, return ["you suggest"].
- budget: total in EUR excluding VAT, or "none" if the buyer says no limit / skip.
- diets: per-diet guest counts this message states, e.g. "12 gluten-free, 4 lactose-free" → [{diet:"gluten_free",guests:12},{diet:"lactose_free",guests:4}]. An allergy is the allergen name ("no nuts for 3" → {diet:"nuts",guests:3}; "nut allergy" → "nuts"). "Everyone"/"all of them" = the total guest count. "No allergies" → "none". A diet the buyer withdraws ("actually no vegans") → guests 0. Earlier diets are kept, so list only what this message says; null if it says nothing about diets.
- dietsWithoutCount: diets named WITHOUT a count ("some are gluten free", "a few vegans", "Gluten-free, Vegan") → ["gluten_free","vegan"], never guessing a number; the buyer is asked how many. Otherwise null.
- Current slots may list dietsPending: diets still waiting for a count, in order. A reply that is only a count or share ("12", "about 10%", "all of them") is the count for the FIRST pending diet; a reply naming a diet with a count fills that diet.
- eventType and eventName: infer from words like wedding/häät/bröllop; eventName is a short title in the buyer's language ("Häät", "Wedding").`),
  model: MODEL,
  defaultOptions: effort('low'),
});

export const intakeExtractionSchema = z.object({
  lang: z.string(),
  deliveryDate: z.string().nullable(),
  guests: z.number().int().nullable(),
  menu: z.array(z.string()).nullable(),
  budget: z.union([z.number(), z.literal('none')]).nullable(),
  diets: z.union([
    z.array(z.object({ diet: z.union([dietFlagSchema, allergenSchema]), guests: z.number().int() })),
    z.literal('none'),
  ]).nullable(),
  dietsWithoutCount: z.array(z.union([dietFlagSchema, allergenSchema])).nullable(),
  eventType: eventTypeSchema.nullable(),
  eventName: z.string().nullable(),
});
export type IntakeExtraction = z.infer<typeof intakeExtractionSchema>;

export interface ExtractIntakeInput { message: string; current: Intake; today: ISODate }

export async function extractIntake({ message, current, today }: ExtractIntakeInput): Promise<IntakeExtraction> {
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const prompt = `Today is ${weekday} ${today}.\nCurrent slots: ${JSON.stringify(current)}\nBuyer message:\n${message}`;
  const res = await intakeAgent.generate(prompt, { structuredOutput: { schema: intakeExtractionSchema } });
  return res.object;
}
