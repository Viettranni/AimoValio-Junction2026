import { describe, expect, it } from 'vitest';
import { adjustment, line } from './fixtures.test-util';
import { computeTotals } from './totals';

describe('computeTotals', () => {
  it('skips unpriced lines', () => {
    const t = computeTotals([line({ packs: 2, unitPrice: 10, unitPriceWithTax: 12 }), line({ id: 'l-2', unitPrice: null, unitPriceWithTax: null })], 'none');
    expect(t.low).toBe(20);
    expect(t.lowWithTax).toBe(24);
    expect(t.budget).toBeNull();
  });
  it('adds a safety pack to requested staple lines without history', () => {
    const t = computeTotals([line({ packs: 2 })], undefined);
    expect([t.low, t.high]).toEqual([20, 30]);
    const addon = computeTotals([line({ packs: 2, tags: ['addon'] })], undefined);
    expect([addon.low, addon.high]).toEqual([20, 20]);
    const sauce = computeTotals([line({ packs: 2, group: 'sauce' })], undefined);
    expect(sauce.high).toBe(20);
  });
  it('pending history spans min..max and is not collapsed', () => {
    const history = { adjustment: adjustment(), historyPacks: 8, suggestedPacks: 9, choice: 'pending' as const };
    const t = computeTotals([line({ packs: 9, history })], 'none');
    expect([t.low, t.high, t.collapsed]).toEqual([80, 90, false]);
  });
  it('range collapses after history choices', () => {
    const history = { adjustment: adjustment(), historyPacks: 8, suggestedPacks: 9, choice: 'history' as const };
    const t = computeTotals([line({ packs: 8, history })], 'none');
    expect([t.low, t.high, t.collapsed]).toEqual([80, 80, true]);
  });
  it('flags over budget when high exceeds budget', () => {
    expect(computeTotals([line({ packs: 2 })], 25).overBudget).toBe(true);
    expect(computeTotals([line({ packs: 2 })], 30).overBudget).toBe(false);
  });
});
