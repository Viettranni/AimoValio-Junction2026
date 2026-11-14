import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { Draft } from '@/contracts';
import { portionCategorySchema } from '@/mcp/schemas';
import { neededAmount } from '../pipeline/build-draft';
import { MODEL, cachedSystem, effort } from './model';

export const orderAgent = new Agent({
  id: 'order',
  name: 'Order',
  description: 'Turns edit requests into draft changes, keeps the budget in view. Never submits orders.',
  instructions: cachedSystem(`You turn a buyer's edit request for a catering order draft into a list of change intents.
Kinds:
- setPacks {lineId, packs}: an absolute pack count. "+3 kg chicken" → convert to packs with the line's pack size and round up.
- removeLine {lineId}
- scaleGuests {guests}: a new total guest count ("make it 320 guests").
- historyChoice {lineId, choice: "history" | "suggested"}: apply or keep a history note ("use last time's amounts" → history on every line with a pending note).
- swap {lineId, searchFi, searchEn, reason}: replace a line's product ("swap to basmati", "cheaper chicken"). searchFi/searchEn: the product to search for in Finnish and English. reason: a few words in the buyer's language (lang), shown on the line, e.g. "Basmati at your request" / "Basmati toiveesta".
- topUp {lineId, searchFi, searchEn}: cover the REST of an existing line's need with another product ("cover the rest", "the missing amount", "add a similar chicken breast for the remainder", typically after a line was capped by stock). lineId: the short line. searchFi/searchEn: the product to look for, or null for the same kind as the line. Never use add for this: add sizes for every guest again.
- add {searchFi, searchEn, category, label, reason}: a genuinely new item that is not on the draft yet. label in the buyer's language.
Only use line ids from the draft. Leave unused fields null. Return an empty list if the request is not an edit.
You never submit or send the order; only the buyer's Approve button does that.`),
  model: MODEL,
  defaultOptions: effort('low'),
});

export const editIntentSchema = z.object({
  kind: z.enum(['setPacks', 'removeLine', 'scaleGuests', 'historyChoice', 'swap', 'topUp', 'add']),
  lineId: z.string().nullable(),
  packs: z.number().int().nullable(),
  guests: z.number().int().nullable(),
  choice: z.enum(['history', 'suggested']).nullable(),
  searchFi: z.string().nullable(),
  searchEn: z.string().nullable(),
  category: portionCategorySchema.nullable(),
  label: z.string().nullable(),
  reason: z.string().nullable(),
});
export type EditIntent = z.infer<typeof editIntentSchema>;

/** The component's portion-rule need, so the agent can see a line that falls short (e.g. capped by stock). */
function neededFor(draft: Draft, line: Draft['lines'][number]): string | undefined {
  const c = draft.components.find((x) => x.id === line.componentId);
  if (!c) return undefined;
  const amount = neededAmount(c, draft.intake.eventType ?? 'other');
  return `${Math.round(amount * 100) / 100} ${c.requiredUnit} for component ${c.id}`;
}

export async function interpretEdit({ instruction, draft }: { instruction: string; draft: Draft }): Promise<EditIntent[]> {
  const view = {
    guests: draft.intake.guests,
    lang: draft.intake.lang,
    lines: draft.lines.map((l) => ({
      lineId: l.id, product: l.productName, group: l.group, packs: l.packs, pack: l.packDescription,
      quantity: `${l.quantity} ${l.unit}`, needed: neededFor(draft, l), historyNote: l.history?.choice === 'pending' ? 'pending' : undefined,
    })),
  };
  const prompt = `Draft: ${JSON.stringify(view)}\nBuyer request:\n${instruction}`;
  const res = await orderAgent.generate(prompt, {
    structuredOutput: { schema: z.object({ intents: z.array(editIntentSchema) }) },
  });
  return res.object.intents;
}
