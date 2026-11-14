import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Draft, DraftChange, DraftDiff, DraftLine, LineTag } from '@/contracts';
import { getProduct } from '@/catalog';
import { getDraftByConversation, now, saveDraft } from '@/db/repo';
import { applyDraftChange } from '@/domain/draft';
import { computeTotals } from '@/domain/totals';
import type { EditIntent } from '../agents/order';
import { getAimoContext, type AimoContext } from '../context';
import { audit, emitterFor, type Emit } from '../events';
import {
  attachHistory, earliestCutoff, productName, sourceComponents, toComponent, toLine,
} from '../pipeline/build-draft';
import { reasonText } from '../pipeline/reasons';
import { availablePacks, repriceLine } from '../pipeline/reprice';
import { defaultSpecialists, type Specialists } from '../specialists';

const MAX_GUESTS = 5000;
const catalog = { getProduct };

interface Deps { specialists: Specialists; emit: Emit }
type Planned = { change: DraftChange; draft: Draft; after?: (d: Draft) => Draft; problems?: string[] } | { note: string };

function nextLineId(draft: Draft): string {
  const max = Math.max(0, ...draft.lines.map((l) => Number(l.id.replace(/^l-/, '')) || 0));
  return `l-${max + 1}`;
}

const queryOf = (i: EditIntent) => ({ fi: i.searchFi ?? i.searchEn ?? '', en: i.searchEn ?? i.searchFi ?? '' });

/** Turns one order-agent intent into a DraftChange, sourcing products (product → allergen → pricing) for swaps and adds. */
async function plan(
  intent: EditIntent, draft: Draft, ctx: AimoContext, specialists: Specialists, instruction: string,
): Promise<Planned> {
  const lang = draft.intake.lang ?? 'en';
  const date = draft.intake.deliveryDate ?? '';
  const line = draft.lines.find((l) => l.id === intent.lineId);
  switch (intent.kind) {
    case 'setPacks':
      if (!line || intent.packs === null || intent.packs < 0) return { note: 'Could not tell which line or how many packs' };
      return { change: { kind: 'setPacks', lineId: line.id, packs: intent.packs }, draft };
    case 'removeLine':
      if (!line) return { note: 'Could not tell which line to remove' };
      return { change: { kind: 'removeLine', lineId: line.id }, draft };
    case 'historyChoice':
      if (!line?.history || !intent.choice) return { note: 'No history note on that line' };
      return { change: { kind: 'historyChoice', lineId: line.id, choice: intent.choice }, draft };
    case 'scaleGuests':
      if (intent.guests === null || intent.guests < 1 || intent.guests > MAX_GUESTS) return { note: `Guest count ${intent.guests} needs confirming` };
      return { change: { kind: 'scaleGuests', guests: intent.guests }, draft };
    case 'swap': {
      const component = line && draft.components.find((c) => c.id === line.componentId);
      const searchTerms = queryOf(intent);
      if (!line || !component || !searchTerms.en) return { note: 'Could not tell which line to swap or what to' };
      const sourced = await sourceComponents([{ ...component, searchTerms }], draft.intake, {
        specialists, ctx, request: instruction, priceCandidates: true,
      });
      const sel = sourced.selections[0];
      if (!sel) return { note: `No product found for "${searchTerms.en}"` };
      if (sel.product.id === line.productId) return { note: `${line.productName} is already the best match` };
      // If the requested product itself had to be substituted, that reason is what the buyer must see.
      const substituteFor = sel.substituteFor;
      const price = sourced.prices.get(sel.product.id);
      const availability = sourced.availability.get(sel.product.id);
      return {
        change: { kind: 'swapProduct', lineId: line.id, product: sel.product, price, availability, allergen: sel.allergen, reason: intent.reason ?? reasonText({ kind: 'buyerAsked' }, lang) },
        draft,
        // applyDraftChange names the product in English and takes Valio's raw price; localise and price per pack.
        after: (d) => ({
          ...d,
          lines: d.lines.map((l) => {
            if (l.id !== line.id) return l;
            const tags: LineTag[] = l.tags.filter((t) => t !== 'allergens_unknown');
            if (sel.allergen.verdict === 'unknown') tags.push('allergens_unknown');
            const named = { ...l, productName: productName(sel.product, lang), alternatives: sel.alternatives, tags, ...(substituteFor ? { substituteFor } : {}) };
            return repriceLine(named, sel.product, price, availability, date);
          }),
        }),
        problems: sourced.exceptions,
      };
    }
    case 'add': {
      const searchTerms = queryOf(intent);
      if (!searchTerms.en) return { note: 'Could not tell what to add' };
      const eventType = draft.intake.eventType ?? 'other';
      const id = `c-add-${draft.components.length + 1}`;
      const component = toComponent({
        id, label: intent.label ?? searchTerms.en, searchTerms, category: intent.category ?? 'salad', origin: 'addon',
        guests: draft.intake.guests ?? 0, dietVariantOf: null, requiredDiet: null, excludeAllergens: null,
      }, id, eventType);
      const sourced = await sourceComponents([component], draft.intake, { specialists, ctx, request: instruction, priceCandidates: true });
      const sel = sourced.selections[0];
      if (!sel) return { note: `No product found for "${searchTerms.en}"` };
      const [newLine] = attachHistory([toLine(sel, nextLineId(draft), lang, sourced, date)], [component], eventType, ctx.customerId, date);
      return {
        change: { kind: 'addLine', line: newLine },
        draft: { ...draft, components: [...draft.components, component] },
        problems: sourced.exceptions,
      };
    }
  }
}

function describe(before: Draft, after: Draft, diff: DraftDiff): string[] {
  const parts: string[] = [];
  const old = new Map(before.lines.map((l) => [l.id, l]));
  const cur = new Map(after.lines.map((l) => [l.id, l]));
  if (before.intake.guests !== after.intake.guests) parts.push(`guests ${before.intake.guests} → ${after.intake.guests}`);
  for (const id of diff.changedLineIds) {
    const a = old.get(id);
    const b = cur.get(id);
    if (!a || !b) continue;
    if (a.productId !== b.productId) parts.push(`${a.productName} → ${b.productName} (${b.packs} packs)`);
    else if (a.packs !== b.packs) parts.push(`${b.productName} ${a.packs} → ${b.packs} packs`);
  }
  for (const id of diff.removedLineIds) parts.push(`removed ${old.get(id)?.productName ?? id}`);
  for (const id of diff.addedLineIds) parts.push(`added ${cur.get(id)?.productName ?? id} (${cur.get(id)?.packs} packs)`);
  return parts;
}

export async function runEditDraft({ ctx, instruction }: { ctx: AimoContext; instruction: string }, { specialists, emit }: Deps) {
  const start = getDraftByConversation(ctx.conversationId);
  if (!start || start.status !== 'ready') throw new Error('There is no order draft to edit yet.');
  const intents = await specialists.interpretEdit({ instruction, draft: start });

  let draft = start;
  const changed = new Set<string>();
  const removed = new Set<string>();
  const added = new Set<string>();
  const notes: string[] = [];
  const problems: string[] = [];
  for (const intent of intents) {
    const planned = await plan(intent, draft, ctx, specialists, instruction);
    if ('note' in planned) { notes.push(planned.note); continue; }
    problems.push(...(planned.problems ?? []));
    const result = applyDraftChange(planned.draft, planned.change, catalog);
    draft = planned.after ? planned.after(result.draft) : result.draft;
    result.diff.changedLineIds.forEach((id) => changed.add(id));
    result.diff.removedLineIds.forEach((id) => { removed.add(id); changed.delete(id); added.delete(id); });
    result.diff.addedLineIds.forEach((id) => added.add(id));
    audit(ctx.conversationId, 'order', planned.change.kind, `Applied ${planned.change.kind}`, { change: planned.change, diff: result.diff });
  }

  const diff: DraftDiff = { changedLineIds: [...changed].filter((id) => !added.has(id)), removedLineIds: [...removed], addedLineIds: [...added] };
  // Each applyDraftChange only flags its own lines; flag every line touched by this edit,
  // and re-derive its stock tags from the stored Valio data since pack counts changed.
  const touched = new Set([...changed, ...added]);
  const date = draft.intake.deliveryDate ?? '';
  const lines: DraftLine[] = draft.lines.map((l) => {
    const tags = l.tags.filter((t) => t !== 'updated');
    if (!touched.has(l.id)) return { ...l, tags };
    const product = getProduct(l.productId);
    const repriced = product ? repriceLine(l, product, l.price, l.availability, date) : l;
    return { ...repriced, tags: [...repriced.tags.filter((t) => t !== 'updated'), 'updated'] };
  });
  for (const l of lines) {
    const product = touched.has(l.id) ? getProduct(l.productId) : undefined;
    const inStock = product && l.availability?.logisticModel === 'Stock' ? availablePacks(product, l.availability) : null;
    if (inStock !== null && inStock < l.packs) problems.push(`${l.productName}: only ${inStock} packs in stock (needs ${l.packs}); offer to lower it or add a similar product`);
  }
  draft = {
    ...draft, lines, totals: computeTotals(lines, draft.intake.budget), cutoff: earliestCutoff(lines, date), updatedAt: now().toISOString(),
  };
  // The specialist calls above take seconds; never overwrite a change the buyer made meanwhile.
  const latest = getDraftByConversation(ctx.conversationId);
  if (!latest || latest.status !== 'ready' || latest.updatedAt !== start.updatedAt) {
    audit(ctx.conversationId, 'order', 'editDraftConflict', 'Edit dropped: the draft changed while it was being prepared', { instruction });
    throw new Error('The draft changed while this edit was being prepared, so nothing was changed. Ask the buyer to repeat the request.');
  }
  saveDraft(draft);
  await emit({ type: 'data-draft', data: { draft, diff } });

  const summary = [...describe(start, draft, diff), ...notes].join('; ') || 'No change made';
  audit(ctx.conversationId, 'order', 'editDraft', summary, { instruction, diff });
  return {
    summary,
    problems,
    total: { low: Math.round(draft.totals.low * 100) / 100, high: Math.round(draft.totals.high * 100) / 100 },
    overBudget: draft.totals.overBudget,
  };
}

export function createEditDraftTool(specialists: Specialists = defaultSpecialists) {
  return createTool({
    id: 'editDraft',
    description:
      'Order specialist. Changes the existing draft from the buyer\'s words: guest count, packs, removing or adding items, swapping products ("swap to basmati", "cheaper chicken"), applying history notes. ' +
      'Only affected rows change and flash in the sheet. Returns a one-line change summary for you to confirm in ONE short sentence, and problems (no price, not deliverable, unknown allergens) you must tell the buyer about.',
    inputSchema: z.object({ instruction: z.string().describe("The buyer's edit request, verbatim") }),
    outputSchema: z.object({
      summary: z.string(),
      problems: z.array(z.string()),
      total: z.object({ low: z.number(), high: z.number() }),
      overBudget: z.boolean(),
    }),
    execute: async ({ instruction }, context) =>
      runEditDraft({ ctx: getAimoContext(context.requestContext), instruction }, { specialists, emit: emitterFor(context.writer) }),
  });
}
