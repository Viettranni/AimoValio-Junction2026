import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDraftByConversation, now } from '@/db/repo';
import { getAimoContext, type AimoContext } from '../context';
import { audit, emitterFor, type Emit } from '../events';
import { buildDraft, type PlanSummary } from '../pipeline/build-draft';
import { defaultSpecialists, type Specialists } from '../specialists';
import { missingSlots, validateIntake } from './understand-request';

export async function runPlanOrder(
  { ctx, addons, deliveryDate }: { ctx: AimoContext; addons: string[]; deliveryDate?: string },
  deps: { specialists: Specialists; emit: Emit },
): Promise<PlanSummary> {
  let draft = getDraftByConversation(ctx.conversationId);
  if (!draft || draft.status === 'submitted') throw new Error('No open order request yet; run understandRequest first.');
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
  const { summary } = await buildDraft({ draft, addons: addons.length ? addons : previous, ctx }, deps);
  return summary;
}

export function createPlanOrderTool(specialists: Specialists = defaultSpecialists) {
  return createTool({
    id: 'planOrder',
    description:
      'Plans the whole order once all five slots are filled and add-ons were offered: menu → products → allergens → prices & stock → history → draft. ' +
      'Also re-plans an existing draft for a new delivery date (pass deliveryDate). The draft sheet updates by itself. Returns a compact summary (line count, total range excl. VAT, budget, cut-off, exceptions) for you to phrase in at most 3 short sentences, without boilerplate.',
    inputSchema: z.object({
      addons: z.array(z.string()).describe('Add-ons the buyer switched on, e.g. ["Salad", "Coffee & tea"]; empty if none (a re-plan keeps earlier add-ons)'),
      deliveryDate: z.string().optional().describe('New delivery date YYYY-MM-DD, only when the buyer changes the date of an existing draft'),
    }),
    outputSchema: z.object({
      lineCount: z.number(),
      total: z.object({ low: z.number(), high: z.number(), lowWithTax: z.number(), highWithTax: z.number() }),
      budget: z.number().nullable(),
      overBudget: z.boolean(),
      cutoff: z.string().nullable(),
      historyNotes: z.number(),
      exceptions: z.array(z.string()),
    }),
    execute: async ({ addons, deliveryDate }, context) =>
      runPlanOrder({ ctx: getAimoContext(context.requestContext), addons, deliveryDate }, { specialists, emit: emitterFor(context.writer) }),
  });
}
