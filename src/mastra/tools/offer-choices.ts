import { randomUUID } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ONE_QUESTION_NOTE, getAimoContext, markQuestionAsked, questionAsked } from '../context';
import { audit, emitterFor } from '../events';

export const offerChoicesTool = createTool({
  id: 'offerChoices',
  description:
    'Show the buyer 2–6 tappable buttons (plus an optional free-text field) under your message: quick replies for missing slots, ' +
    'optional add-ons before planning (all off by default), alternative menus, or substitution choices. Their tap arrives as the next user message.',
  inputSchema: z.object({
    question: z.string().describe("Short question in the buyer's language"),
    options: z.array(z.object({ id: z.string(), label: z.string().describe("In the buyer's language") })).min(1).max(6),
    multi: z.boolean().describe('True when several options can be chosen (add-ons)'),
    allowFreeText: z.boolean().describe('Show a "Something else…" field'),
  }),
  outputSchema: z.object({ shown: z.boolean(), note: z.string().optional() }),
  execute: async (input, context) => {
    const { conversationId } = getAimoContext(context.requestContext);
    if (questionAsked(context.requestContext)) return { shown: false, note: ONE_QUESTION_NOTE };
    markQuestionAsked(context.requestContext);
    await emitterFor(context.writer)({ type: 'data-choices', data: { id: randomUUID(), ...input } });
    audit(conversationId, 'orchestrator', 'offerChoices', `Asked: ${input.question} (${input.options.map((o) => o.label).join(' / ')})`);
    return { shown: true };
  },
});
