import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Intake } from '@/contracts';
import { getDraftByConversation, now } from '@/db/repo';
import { deliverableOn, nextOrderableDate } from '@/domain/cutoff';
import { pendingOfferFor } from '@/gateway/store';
import { intakeExtractionSchema } from '../agents/intake';
import { getAimoContext, type AimoContext } from '../context';
import { audit, emitterFor, type Emit } from '../events';
import { buildDraft, type PlanSummary } from '../pipeline/build-draft';
import { defaultSpecialists, type Specialists } from '../specialists';
import { missingSlots, validateIntake } from './understand-request';

export async function runPlanOrder(
  { ctx, addons, deliveryDate, diets }: { ctx: AimoContext; addons: string[]; deliveryDate?: string; diets?: Intake['diets'] },
  deps: { specialists: Specialists; emit: Emit },
): Promise<PlanSummary & { nextPossibleDate?: string }> {
  let draft = getDraftByConversation(ctx.conversationId);
  if (!draft || draft.status === 'submitted') throw new Error('No open order request yet; run understandRequest first.');
  if (draft.status === 'ready' && pendingOfferFor(draft)) {
    throw new Error('This order is waiting for the purchasing manager\'s approval, so the draft can\'t change until they decide.');
  }
  if (diets && JSON.stringify(diets) !== JSON.stringify(draft.intake.diets)) {
    audit(ctx.conversationId, 'intake', 'changeDiets', `Diets ${JSON.stringify(draft.intake.diets ?? null)} → ${JSON.stringify(diets)}`);
    draft = { ...draft, intake: { ...draft.intake, diets } };
  }
  if (deliveryDate && deliveryDate !== draft.intake.deliveryDate) {
    const { intake, warnings } = validateIntake({ ...draft.intake, deliveryDate }, now(), null);
    if (!intake.deliveryDate) throw new Error(warnings.join(' '));
    audit(ctx.conversationId, 'intake', 'changeDeliveryDate', `Delivery date ${draft.intake.deliveryDate} → ${deliveryDate}`);
    draft = { ...draft, intake };
  }
  const missing = missingSlots(draft.intake);
  if (missing.length) throw new Error(`Cannot plan yet; still missing: ${missing.join(', ')}.`);
  // Re-planning keeps the add-ons the buyer already chose unless new ones are given.
  const previous = draft.components.filter((c) => c.origin === 'addon' && !c.dietVariantOf).map((c) => c.label);
  const { draft: built, summary } = await buildDraft({ draft, addons: addons.length ? addons : previous, ctx }, deps);
  // A passed cut-off is no dead end: name the first date that can still be ordered, for a one-tap choice.
  const today = now();
  const date = draft.intake.deliveryDate;
  const late = built.lines.some((l) => l.availability && !deliverableOn(l.availability, date ?? ''));
  if (date && (late || (summary.cutoff && Date.parse(summary.cutoff) < today.getTime()))) {
    const next = nextOrderableDate(built.lines.flatMap((l) => (l.availability ? [l.availability] : [])), date, today);
    if (next) {
      return {
        ...summary, nextPossibleDate: next,
        exceptions: [...summary.exceptions, `The earliest delivery that can still be ordered is ${next}: offer it as a one-tap choice with offerChoices (plus "Another date"); on a tap call planOrder with deliveryDate ${next}`],
      };
    }
  }
  return summary;
}

export function createPlanOrderTool(specialists: Specialists = defaultSpecialists) {
  return createTool({
    id: 'planOrder',
    description:
      'Plans the whole order once all five slots are filled and add-ons were offered: menu → products → allergens → prices & stock → history → draft. ' +
      'Also re-plans an existing draft for a new delivery date (pass deliveryDate) or new diets/allergies (pass diets; manual edits are lost). The draft sheet updates by itself. Returns a compact summary (line count, total range excl. VAT, budget, cut-off, exceptions) for you to phrase in at most 3 short sentences, without boilerplate.',
    inputSchema: z.object({
      addons: z.array(z.string()).describe('Add-ons the buyer switched on, e.g. ["Salad", "Coffee & tea"]; empty if none (a re-plan keeps earlier add-ons)'),
      deliveryDate: z.string().optional().describe('New delivery date YYYY-MM-DD, only when the buyer changes the date of an existing draft'),
      diets: intakeExtractionSchema.shape.diets.unwrap().optional()
        .describe('New per-diet guest counts for an existing draft, e.g. [{diet:"gluten_free",guests:80}] for "make it all gluten-free"; "none" for no diets'),
    }),
    outputSchema: z.object({
      lineCount: z.number(),
      total: z.object({ low: z.number(), high: z.number(), lowWithTax: z.number(), highWithTax: z.number() }),
      budget: z.number().nullable(),
      overBudget: z.boolean(),
      cutoff: z.string().nullable(),
      historyNotes: z.number(),
      exceptions: z.array(z.string()),
      nextPossibleDate: z.string().optional(),
    }),
    execute: async ({ addons, deliveryDate, diets }, context) =>
      runPlanOrder({ ctx: getAimoContext(context.requestContext), addons, deliveryDate, diets }, { specialists, emit: emitterFor(context.writer) }),
  });
}
