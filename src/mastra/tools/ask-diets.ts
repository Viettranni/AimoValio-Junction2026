import { randomUUID } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ChoicesEvent, DietKind, Intake, UiLang } from '@/contracts';
import { getDraftByConversation } from '@/db/repo';
import { dietCountOptions } from '@/domain/diets';
import { dietLabel, t, uiLangFor, type UiKey } from '@/ui/i18n';
import { getAimoContext, type AimoContext } from '../context';
import { audit, emitterFor, type Emit } from '../events';

const UI_LANGS: UiLang[] = ['en', 'fi', 'sv'];
/** The common diets offered when the buyer has named none; "none" is exclusive in ChoiceButtons. */
const PICKS = ['gluten_free', 'lactose_free', 'nuts', 'vegetarian', 'vegan'] as const satisfies readonly DietKind[];
const SHARE_PERCENT = 10;

const pickKey = (id: (typeof PICKS)[number] | 'none') => `dietPick.${id}` as UiKey;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Quick-pick labels ("Gluten-free, Vegan", "No allergies") in any UI language back to diets; null if any part is not one. */
export function parseDietPick(text: string): { named: DietKind[] } | { none: true } | null {
  const parts = text.split(',').map(norm).filter(Boolean);
  if (!parts.length) return null;
  const byLabel = new Map<string, DietKind | 'none'>();
  for (const lang of UI_LANGS) {
    for (const id of [...PICKS, 'none' as const]) byLabel.set(norm(t(pickKey(id), lang)), id);
  }
  const ids = parts.map((p) => byLabel.get(p));
  if (ids.some((id) => id === undefined)) return null;
  if (ids.includes('none')) return ids.length === 1 ? { none: true } : null;
  return { named: [...new Set(ids as DietKind[])] };
}

export type DietChoices =
  | { kind: 'count'; diet: DietKind; event: Omit<ChoicesEvent, 'id'> }
  | { kind: 'pick'; event: Omit<ChoicesEvent, 'id'> };

/**
 * What to ask about diets next: how many guests have the first diet named without a count (5 / 10 / 20 /
 * about 10 % / everyone, plus free entry), or common diets to pick from when none are named yet.
 */
export function dietChoices(intake: Intake): DietChoices | null {
  const lang = uiLangFor(intake.lang);
  const pending = intake.dietsPending ?? [];
  if (pending.length) {
    if (!intake.guests || intake.guests < 1) return null;
    const diet = pending[0];
    const options = dietCountOptions(intake.guests).map((o) => ({
      id: `${o.kind}-${o.guests}`,
      label: o.kind === 'all' ? t('dietCount.all', lang, { n: o.guests })
        : o.kind === 'share' ? t('dietCount.share', lang, { p: SHARE_PERCENT, n: o.guests })
        : t('dietCount.count', lang, { n: o.guests }),
    }));
    return {
      kind: 'count', diet,
      event: { question: t('dietCount.question', lang, { diet: capitalise(dietLabel(diet, lang)) }), options, multi: false, allowFreeText: true },
    };
  }
  if (intake.diets !== undefined) return null;
  return {
    kind: 'pick',
    event: {
      question: t('dietPick.question', lang),
      options: [...PICKS, 'none' as const].map((id) => ({ id, label: t(pickKey(id), lang) })),
      multi: true, allowFreeText: true,
    },
  };
}

/** Shows the next diet question as choice buttons; the buyer's tap comes back as a message for understandRequest. */
export async function runAskDiets({ ctx }: { ctx: AimoContext }, { emit }: { emit: Emit }) {
  const draft = getDraftByConversation(ctx.conversationId);
  const choices = draft && draft.status === 'building' ? dietChoices(draft.intake) : null;
  if (!choices) return { asked: null };
  await emit({ type: 'data-choices', data: { id: randomUUID(), ...choices.event } });
  audit(ctx.conversationId, 'intake', 'askDiets',
    `Asked: ${choices.event.question} (${choices.event.options.map((o) => o.label).join(' / ')})`,
    { kind: choices.kind, ...(choices.kind === 'count' ? { diet: choices.diet } : {}) });
  return choices.kind === 'count'
    ? { asked: 'count' as const, diet: choices.diet, options: choices.event.options.map((o) => o.label) }
    : { asked: 'pick' as const };
}

export const askDietsTool = createTool({
  id: 'askDiets',
  description:
    'Intake specialist. Shows buttons for the diets slot under your message: when diets were named without a count (intake.dietsPending), ' +
    'how many guests have the first one (5 / 10 / 20 / about 10% / everyone, plus free entry); when no diets are known yet, common allergies to pick from ' +
    '(Gluten-free, Lactose-free, Nut allergy, Vegetarian, Vegan, No allergies). Use it instead of offerChoices for allergies and diets. ' +
    'The tap arrives as the next user message; pass it to understandRequest. Returns asked: null when there is nothing to ask.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    asked: z.enum(['count', 'pick']).nullable(),
    diet: z.string().optional(),
    options: z.array(z.string()).optional(),
  }),
  execute: async (_input, context) =>
    runAskDiets({ ctx: getAimoContext(context.requestContext) }, { emit: emitterFor(context.writer) }),
});
