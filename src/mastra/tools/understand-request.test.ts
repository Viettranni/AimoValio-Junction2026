import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.AIMO_DB_PATH = ':memory:'; });

import type { Draft } from '@/contracts';
import { getDraftByConversation, saveDraft } from '@/db/repo';
import { computeTotals } from '@/domain/totals';
import type { IntakeExtraction } from '../agents/intake';
import type { Specialists } from '../specialists';
import { mergeIntake, runUnderstandRequest, validateIntake } from './understand-request';

const today = new Date('2026-11-14T09:00:00Z');

describe('validateIntake', () => {
  it('drops a delivery date before tomorrow and asks again', () => {
    const { intake, warnings } = validateIntake({ deliveryDate: '2026-11-14' }, today, null);
    expect(intake.deliveryDate).toBeUndefined();
    expect(warnings[0]).toMatch(/too soon.*2026-11-15/);
    expect(validateIntake({ deliveryDate: '2026-11-15' }, today, null)).toEqual({ intake: { deliveryDate: '2026-11-15' }, warnings: [] });
  });

  it('drops an invalid date', () => {
    for (const d of ['6.12.', '2026-13-45']) {
      const { intake, warnings } = validateIntake({ deliveryDate: d }, today, null);
      expect(intake.deliveryDate).toBeUndefined();
      expect(warnings[0]).toMatch(/not a valid date/);
    }
  });

  it('keeps an unusual guest count but asks to confirm it', () => {
    for (const guests of [0, 50000]) {
      const { intake, warnings } = validateIntake({ guests }, today, null);
      expect(intake.guests).toBe(guests);
      expect(warnings[0]).toMatch(/unusual/);
    }
    expect(validateIntake({ guests: 1 }, today, null).warnings).toEqual([]);
    expect(validateIntake({ guests: 5000 }, today, null).warnings).toEqual([]);
  });

  it('warns when a known cut-off has passed', () => {
    expect(validateIntake({ deliveryDate: '2026-12-06' }, today, '2026-11-13T10:00:00Z').warnings[0]).toMatch(/cut-off/);
    expect(validateIntake({ deliveryDate: '2026-12-06' }, today, '2026-12-04T10:00:00Z').warnings).toEqual([]);
  });
});

describe('runUnderstandRequest', () => {
  const empty: IntakeExtraction = {
    lang: 'en', deliveryDate: null, guests: null, menu: null, budget: null, diets: null, eventType: null, eventName: null,
  };
  const ctx = { conversationId: 'conv-intake', customerId: 'helsinki-juhlapalvelu' };
  const building: Draft = {
    id: 'd-intake', conversationId: ctx.conversationId, customerId: ctx.customerId,
    intake: { deliveryDate: '2026-12-06', guests: 100 }, components: [], lines: [],
    totals: computeTotals([], undefined), cutoff: '2026-01-01T10:00:00Z', status: 'building', updatedAt: '2026-11-14T00:00:00Z',
  };
  const run = (x: Partial<IntakeExtraction>) => runUnderstandRequest(
    { ctx, message: 'msg' },
    { specialists: { extractIntake: vi.fn(async () => ({ ...empty, ...x })) } as unknown as Specialists, emit: async () => {} },
  );

  it('uses the stored cut-off only while the delivery date is unchanged', async () => {
    saveDraft(building);
    expect((await run({ guests: 120 })).warnings.join(' ')).toMatch(/cut-off/);
    expect(getDraftByConversation(ctx.conversationId)!.intake.guests).toBe(120);
    const res = await run({ deliveryDate: '2026-12-12' });
    expect(res.warnings).toEqual([]);
    expect(res.draftReady).toBe(false);
  });

  it('mergeIntake keeps earlier slots the message does not mention', () => {
    expect(mergeIntake({ guests: 100, budget: 'none' }, { ...empty, lang: 'fi', menu: ['kana'] }))
      .toEqual({ guests: 100, budget: 'none', lang: 'fi', menu: ['kana'] });
  });
});
