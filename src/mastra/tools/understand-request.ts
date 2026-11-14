import { randomUUID } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { REQUIRED_SLOTS, type Draft, type Intake, type IntakeSlot } from '@/contracts';
import { getDraftByConversation, now, saveDraft } from '@/db/repo';
import { mergeDiets, parseDietCount } from '@/domain/diets';
import { computeTotals } from '@/domain/totals';
import { allergenSchema, dietFlagSchema } from '@/mcp/schemas';
import { intakeExtractionSchema, type IntakeExtraction } from '../agents/intake';
import { getAimoContext, type AimoContext } from '../context';
import { audit, emitterFor, type Emit } from '../events';
import { defaultSpecialists, type Specialists } from '../specialists';
import { parseDietPick } from './ask-diets';

const MAX_GUESTS = 5000;
const DAY_MS = 86_400_000;
// Intake as returned to the orchestrator: the extraction fields, each optional.
const intakeSchema = intakeExtractionSchema.omit({ dietsWithoutCount: true }).extend({
  lang: z.string().optional(),
  deliveryDate: z.string().optional(),
  guests: z.number().optional(),
  menu: intakeExtractionSchema.shape.menu.unwrap().optional(),
  budget: intakeExtractionSchema.shape.budget.unwrap().optional(),
  diets: intakeExtractionSchema.shape.diets.unwrap().optional(),
  dietsPending: z.array(z.union([dietFlagSchema, allergenSchema])).optional(),
  eventType: intakeExtractionSchema.shape.eventType.unwrap().optional(),
  eventName: z.string().optional(),
});
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function mergeIntake(current: Intake, x: IntakeExtraction): Intake {
  const merged: Intake = { ...current, lang: x.lang || current.lang };
  if (x.deliveryDate !== null) merged.deliveryDate = x.deliveryDate;
  if (x.guests !== null) merged.guests = x.guests;
  if (x.menu !== null && x.menu.length) merged.menu = x.menu;
  if (x.budget !== null) merged.budget = x.budget;
  const diets = mergeDiets(current, { diets: x.diets, named: x.dietsWithoutCount ?? null });
  delete merged.diets;
  delete merged.dietsPending;
  Object.assign(merged, diets);
  if (x.eventType !== null) merged.eventType = x.eventType;
  if (x.eventName !== null) merged.eventName = x.eventName;
  return merged;
}

/** Drops impossible values (so they are asked again) and flags odd ones for confirmation. */
export function validateIntake(intake: Intake, today: Date, cutoff: string | null): { intake: Intake; warnings: string[] } {
  const warnings: string[] = [];
  const next = { ...intake };
  if (next.guests !== undefined && (next.guests < 1 || next.guests > MAX_GUESTS)) {
    warnings.push(`Guest count ${next.guests} looks unusual; confirm it with the buyer before planning.`);
  }
  if (next.deliveryDate !== undefined) {
    const tomorrow = isoDate(new Date(today.getTime() + DAY_MS));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next.deliveryDate) || Number.isNaN(Date.parse(next.deliveryDate))) {
      warnings.push(`"${next.deliveryDate}" is not a valid date; ask for the delivery date again.`);
      delete next.deliveryDate;
    } else if (next.deliveryDate < tomorrow) {
      warnings.push(`Delivery date ${next.deliveryDate} is too soon; the earliest possible delivery is ${tomorrow}.`);
      delete next.deliveryDate;
    } else if (cutoff && Date.parse(cutoff) < today.getTime()) {
      warnings.push(`The order cut-off for ${next.deliveryDate} has passed; offer the next possible date.`);
    }
  }
  if (Array.isArray(next.diets) && next.guests && next.guests >= 1) {
    const total = next.guests;
    const over = next.diets.filter((d) => d.guests > total);
    if (over.length) {
      warnings.push(`Diet counts above the ${total} guests were capped at ${total}: ${over.map((d) => `${d.diet} ${d.guests}`).join(', ')}.`);
      next.diets = next.diets.map((d) => (d.guests > total ? { ...d, guests: total } : d));
    }
  }
  return { intake: next, warnings };
}

const READY_HINT =
  'A draft already exists and was not changed. Use editDraft for guest, quantity or product changes; ' +
  'for a new delivery date call planOrder with deliveryDate (add-ons are kept).';

/** Diets named without a count keep the diets slot missing until each has one. */
export const missingSlots = (intake: Intake): IntakeSlot[] =>
  REQUIRED_SLOTS.filter((s) => intake[s] === undefined || (s === 'diets' && !!intake.dietsPending?.length));

const NOTHING: Omit<IntakeExtraction, 'lang'> = {
  deliveryDate: null, guests: null, menu: null, budget: null, diets: null, dietsWithoutCount: null, eventType: null, eventName: null,
};

/**
 * A tap on the diet buttons (askDiets) read without the intake agent: a bare count answers the first pending
 * diet, and quick-pick labels ("Gluten-free, Vegan", "No allergies") name the diets. Anything else is null.
 */
export function quickDietAnswer(message: string, intake: Intake | undefined): IntakeExtraction | null {
  if (!intake) return null;
  const lang = intake.lang ?? 'en';
  const pending = intake.dietsPending ?? [];
  if (pending.length && intake.guests) {
    const guests = parseDietCount(message, intake.guests);
    if (guests !== null) return { ...NOTHING, lang, diets: [{ diet: pending[0], guests }] };
  }
  if (intake.diets === undefined && !pending.length) {
    const pick = parseDietPick(message);
    if (pick && 'none' in pick) return { ...NOTHING, lang, diets: 'none' };
    if (pick) return { ...NOTHING, lang, dietsWithoutCount: pick.named };
  }
  return null;
}

function newDraft(ctx: AimoContext, intake: Intake, at: string): Draft {
  return {
    id: randomUUID(), conversationId: ctx.conversationId, customerId: ctx.customerId, intake, components: [], lines: [],
    totals: computeTotals([], intake.budget), cutoff: null, status: 'building', updatedAt: at,
  };
}

export async function runUnderstandRequest(
  { ctx, message }: { ctx: AimoContext; message: string },
  { specialists, emit }: { specialists: Specialists; emit: Emit },
) {
  const existing = getDraftByConversation(ctx.conversationId);
  // A planned draft is changed only through editDraft / planOrder, so its lines never go stale.
  if (existing?.status === 'ready') {
    return { intake: existing.intake, missing: [], warnings: [], draftReady: true, hint: READY_HINT };
  }
  const open = existing?.status === 'building' ? existing : null;
  const today = now();
  const quick = quickDietAnswer(message, open?.intake);
  const extraction = quick ?? await specialists.extractIntake({ message, current: open?.intake ?? {}, today: isoDate(today) });
  const merged = mergeIntake(open?.intake ?? {}, extraction);
  // A known cut-off belongs to the date it was fetched for.
  const cutoff = open && merged.deliveryDate === open.intake.deliveryDate ? open.cutoff : null;
  const { intake, warnings } = validateIntake(merged, today, cutoff);
  const missing = missingSlots(intake);

  const at = today.toISOString();
  const draft: Draft = open
    ? { ...open, intake, totals: computeTotals(open.lines, intake.budget), updatedAt: at }
    : newDraft(ctx, intake, at);
  saveDraft(draft);
  await emit({ type: 'data-slots', data: { intake, missing } });
  audit(ctx.conversationId, 'intake', 'understandRequest',
    `Slots: ${REQUIRED_SLOTS.filter((s) => !missing.includes(s)).join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}`,
    { intake, missing, warnings, ...(quick ? { readWithoutModel: true } : {}) });
  return { intake, missing, warnings, draftReady: false };
}

export function createUnderstandRequestTool(specialists: Specialists = defaultSpecialists) {
  return createTool({
    id: 'understandRequest',
    description:
      'Intake specialist. Call with the buyer\'s latest message whenever it may contain event details (date, guests, menu, budget, diets, event type). ' +
      'Returns the merged slots, which required slots are still missing, and warnings to confirm with the buyer. ' +
      'Diets named without a count are listed in intake.dietsPending and keep "diets" missing; then call askDiets to ask how many guests have each. ' +
      'Only for collecting details before a draft exists; once a draft exists it changes nothing (draftReady: true).',
    inputSchema: z.object({ message: z.string().describe("The buyer's latest message, verbatim") }),
    outputSchema: z.object({
      intake: intakeSchema,
      missing: z.array(z.enum(REQUIRED_SLOTS as [IntakeSlot, ...IntakeSlot[]])),
      warnings: z.array(z.string()),
      draftReady: z.boolean(),
      hint: z.string().optional(),
    }),
    execute: async ({ message }, context) =>
      runUnderstandRequest({ ctx: getAimoContext(context.requestContext), message }, { specialists, emit: emitterFor(context.writer) }),
  });
}
