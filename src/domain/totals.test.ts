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
  it('adds a safety pack to requested staple lines while history choices are pending', () => {
    const pending = line({ id: 'l-9', group: 'sauce', packs: 1, history: { adjustment: adjustment(), historyPacks: 1, suggestedPacks: 1, choice: 'pending' as const } });
    const t = computeTotals([line({ packs: 2 }), pending], undefined);
    expect([t.low, t.high]).toEqual([30, 40]);
    const addon = computeTotals([line({ packs: 2, tags: ['addon'] }), pending], undefined);
    expect([addon.low, addon.high]).toEqual([30, 30]);
    const sauce = computeTotals([line({ packs: 2, group: 'sauce' }), pending], undefined);
    expect(sauce.high).toBe(30);
  });
  it('shows a single figure (high = low) when collapsed', () => {
    const t = computeTotals([line({ packs: 2, unitPrice: 10, unitPriceWithTax: 12 })], undefined);
    expect([t.low, t.high, t.lowWithTax, t.highWithTax, t.collapsed]).toEqual([20, 20, 24, 24, true]);
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
  it('flags over budget from the displayed figure', () => {
    expect(computeTotals([line({ packs: 2 })], 19).overBudget).toBe(true);
    // Collapsed: the shown total is 20, so a 25 budget is not exceeded (no safety pack).
    expect(computeTotals([line({ packs: 2 })], 25).overBudget).toBe(false);
    const history = { adjustment: adjustment(), historyPacks: 8, suggestedPacks: 9, choice: 'pending' as const };
    expect(computeTotals([line({ packs: 9, history })], 85).overBudget).toBe(true);
  });
});
