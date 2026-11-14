import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.AIMO_DB_PATH = ':memory:'; });

import type { AimoDataPart, ChoicesEvent, Draft, Intake } from '@/contracts';
import { getDraftByConversation, listAudit, saveDraft } from '@/db/repo';
import { computeTotals } from '@/domain/totals';
import type { Specialists } from '../specialists';
import { dietChoices, parseDietPick, runAskDiets } from './ask-diets';
import { missingSlots, quickDietAnswer, runUnderstandRequest } from './understand-request';

describe('parseDietPick', () => {
  it('maps quick-pick labels back to diets', () => {
    expect(parseDietPick('Gluten-free, Vegan')).toEqual({ named: ['gluten_free', 'vegan'] });
    expect(parseDietPick('Pähkinäallergia, Laktoositon')).toEqual({ named: ['nuts', 'lactose_free'] });
    expect(parseDietPick('Vegetarisk')).toEqual({ named: ['vegetarian'] });
  });

  it('reads "No allergies" as none (the fast path)', () => {
    expect(parseDietPick('No allergies')).toEqual({ none: true });
    expect(parseDietPick('Ei allergioita')).toEqual({ none: true });
    expect(parseDietPick('Inga allergier')).toEqual({ none: true });
  });

  it('returns null when anything is not a known label', () => {
    expect(parseDietPick('Gluten-free, shellfish')).toBeNull();
    expect(parseDietPick('No allergies, Vegan')).toBeNull();
    expect(parseDietPick('12 gluten-free')).toBeNull();
    expect(parseDietPick('')).toBeNull();
  });
});

describe('dietChoices', () => {
  it('asks how many guests have the first pending diet, in the buyer\'s language', () => {
    const c = dietChoices({ guests: 120, dietsPending: ['gluten_free', 'vegan'], lang: 'en' })!;
    expect(c).toMatchObject({ kind: 'count', diet: 'gluten_free' });
    expect(c.event).toMatchObject({ question: 'Gluten-free: how many guests?', multi: false, allowFreeText: true });
    expect(c.event.options.map((o) => o.label)).toEqual(['5 guests', '10 guests', '20 guests', 'About 10% (12)', 'All 120']);
    const fi = dietChoices({ guests: 120, dietsPending: ['vegan'], lang: 'fi' })!;
    expect(fi.event.question).toBe('Vegaani: montako vierasta?');
    expect(fi.event.options.at(-1)!.label).toBe('Kaikki 120');
  });

  it('offers common allergies (multi, "No allergies" exclusive) when none are named', () => {
    const c = dietChoices({ guests: 120, lang: 'sv' })!;
    expect(c.kind).toBe('pick');
    expect(c.event).toMatchObject({ question: 'Allergier eller specialkost?', multi: true, allowFreeText: true });
    expect(c.event.options.map((o) => o.id)).toEqual(['gluten_free', 'lactose_free', 'nuts', 'vegetarian', 'vegan', 'none']);
  });

  it('has nothing to ask once diets are known, or without a guest count for a pending diet', () => {
    expect(dietChoices({ guests: 120, diets: 'none' })).toBeNull();
    expect(dietChoices({ guests: 120, diets: [{ diet: 'vegan', guests: 3 }] })).toBeNull();
    expect(dietChoices({ dietsPending: ['vegan'] })).toBeNull();
  });

  it('every button label reads back without the intake agent', () => {
    const intake: Intake = { guests: 120, dietsPending: ['gluten_free'], lang: 'fi' };
    for (const o of dietChoices(intake)!.event.options) {
      expect(quickDietAnswer(o.label, intake)?.diets).toEqual([{ diet: 'gluten_free', guests: Number(o.label.match(/\d+(?=\)$)|\d+/g)!.at(-1)) }]);
    }
    const none: Intake = { guests: 120, lang: 'fi' };
    expect(quickDietAnswer('Ei allergioita', none)?.diets).toBe('none');
    expect(quickDietAnswer('Gluteeniton, Vegaani', none)?.dietsWithoutCount).toEqual(['gluten_free', 'vegan']);
  });
});

describe('diet headcount flow', () => {
  const ctx = { conversationId: 'conv-diets', customerId: 'helsinki-juhlapalvelu' };
  const draft: Draft = {
    id: 'd-diets', conversationId: ctx.conversationId, customerId: ctx.customerId,
    intake: { deliveryDate: '2026-12-06', guests: 120, menu: ['chicken', 'rice'], budget: 'none', lang: 'en' },
    components: [], lines: [], totals: computeTotals([], 'none'), cutoff: null, status: 'building', updatedAt: '2026-11-14T00:00:00Z',
  };
  const nothing = { deliveryDate: null, guests: null, menu: null, budget: null, diets: null, dietsWithoutCount: null, eventType: null, eventName: null };

  it('a diet named without a count is asked for, answered by a tap, and then planning can start', async () => {
    saveDraft(draft);
    const extractIntake = vi.fn(async () => ({ ...nothing, lang: 'en', dietsWithoutCount: ['gluten_free' as const, 'vegan' as const] }));
    const deps = { specialists: { extractIntake } as unknown as Specialists, emit: async () => {} };

    const first = await runUnderstandRequest({ ctx, message: 'some are gluten free and a few vegans' }, deps);
    expect(first.intake.dietsPending).toEqual(['gluten_free', 'vegan']);
    expect(first.missing).toEqual(['diets']);

    const parts: AimoDataPart[] = [];
    const asked = await runAskDiets({ ctx }, { emit: async (p) => { parts.push(p); } });
    expect(asked).toMatchObject({ asked: 'count', diet: 'gluten_free' });
    const event = parts[0].data as ChoicesEvent;
    expect(event.options.map((o) => o.label)).toContain('About 10% (12)');

    // The tap's label goes back through understandRequest without calling the intake agent.
    const second = await runUnderstandRequest({ ctx, message: 'About 10% (12)' }, deps);
    expect(extractIntake).toHaveBeenCalledTimes(1);
    expect(second.intake).toMatchObject({ diets: [{ diet: 'gluten_free', guests: 12 }], dietsPending: ['vegan'] });
    expect(second.missing).toEqual(['diets']);

    const third = await runUnderstandRequest({ ctx, message: '5 guests' }, deps);
    expect(third.intake.diets).toEqual([{ diet: 'gluten_free', guests: 12 }, { diet: 'vegan', guests: 5 }]);
    expect(third.intake.dietsPending).toBeUndefined();
    expect(third.missing).toEqual([]);
    expect(missingSlots(getDraftByConversation(ctx.conversationId)!.intake)).toEqual([]);
    expect(await runAskDiets({ ctx }, { emit: async () => {} })).toEqual({ asked: null });
    expect(listAudit({ conversationId: ctx.conversationId }).filter((a) => a.action === 'askDiets')).toHaveLength(1);
  });

  it('"No allergies" stays a one-tap answer', async () => {
    const c2 = { ...ctx, conversationId: 'conv-diets-none' };
    saveDraft({ ...draft, id: 'd-none', conversationId: c2.conversationId });
    const extractIntake = vi.fn();
    const res = await runUnderstandRequest({ ctx: c2, message: 'No allergies' }, { specialists: { extractIntake } as unknown as Specialists, emit: async () => {} });
    expect(extractIntake).not.toHaveBeenCalled();
    expect(res.intake.diets).toBe('none');
    expect(res.missing).toEqual([]);
  });
});
