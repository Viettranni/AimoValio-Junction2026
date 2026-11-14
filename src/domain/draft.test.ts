import { describe, expect, it } from 'vitest';
import { adjustment, draft, line, product } from './fixtures.test-util';
import { applyDraftChange } from './draft';

const ctx = { getProduct: (id: string) => (id === 'p-1' ? product() : undefined) };

describe('applyDraftChange', () => {
  it('setPacks marks only that line updated', () => {
    const d = draft({ lines: [line({ id: 'l-1', tags: ['updated'] }), line({ id: 'l-2', componentId: 'c-2', packs: 3, quantity: 18 })] });
    const r = applyDraftChange(d, { kind: 'setPacks', lineId: 'l-2', packs: 5 }, ctx);
    expect(r.draft.lines[1]).toMatchObject({ packs: 5, quantity: 30 });
    expect(r.draft.lines[1].tags).toContain('updated');
    expect(r.draft.lines[0].tags).not.toContain('updated');
    expect(r.diff.changedLineIds).toEqual(['l-2']);
    expect(d.lines[1].packs).toBe(3);
    expect(r.draft.totals.low).toBe(100 + 50);
  });

  it('historyChoice sets packs and collapses totals', () => {
    const history = { adjustment: adjustment(), historyPacks: 8, suggestedPacks: 9, choice: 'pending' as const };
    const d = draft({ lines: [line({ packs: 9, quantity: 54, history })] });
    const r = applyDraftChange(d, { kind: 'historyChoice', lineId: 'l-1', choice: 'history' }, ctx);
    expect(r.draft.lines[0]).toMatchObject({ packs: 8, quantity: 48 });
    expect(r.draft.lines[0].history?.choice).toBe('history');
    expect(r.draft.totals.collapsed).toBe(true);
  });

  it('removeLine and addLine report the diff', () => {
    const d = draft();
    const removed = applyDraftChange(d, { kind: 'removeLine', lineId: 'l-1' }, ctx);
    expect(removed.draft.lines).toEqual([]);
    expect(removed.diff.removedLineIds).toEqual(['l-1']);
    const added = applyDraftChange(d, { kind: 'addLine', line: line({ id: 'l-9' }) }, ctx);
    expect(added.diff.addedLineIds).toEqual(['l-9']);
    expect(added.draft.lines[1].tags).toContain('updated');
  });

  it('swapProduct replaces the product and re-rounds packs', () => {
    const p = product({ id: 'p-2', nameEn: 'Turkey', packSize: 5, packDescription: '5 kg bag' });
    const r = applyDraftChange(draft(), {
      kind: 'swapProduct', lineId: 'l-1', product: p, reason: 'not deliverable',
      allergen: { productId: 'p-2', verdict: 'pass', conflicts: [], unmetDiets: [] },
      price: { productId: 'p-2', ok: true, price: 20, priceWithTax: 22, currency: 'EUR', fetchedAt: 'x' },
    }, ctx);
    expect(r.draft.lines[0]).toMatchObject({ productId: 'p-2', productName: 'Turkey', packs: 11, quantity: 55, unitPrice: 20, unitPriceWithTax: 22 });
    expect(r.draft.lines[0].tags).toEqual(expect.arrayContaining(['substitute', 'updated']));
    expect(r.draft.lines[0].substituteFor).toMatchObject({ productId: 'p-1', reason: 'not deliverable' });
    expect(r.diff.changedLineIds).toEqual(['l-1']);
  });

  it('scaleGuests 300 -> 320 raises poultry packs', () => {
    const r = applyDraftChange(draft(), { kind: 'scaleGuests', guests: 320 }, ctx);
    expect(r.draft.intake.guests).toBe(320);
    expect(r.draft.components[0]).toMatchObject({ guests: 320 });
    expect(r.draft.components[0].requiredAmount).toBeCloseTo(57.6);
    expect(r.draft.lines[0]).toMatchObject({ packs: 10, quantity: 60 });
    expect(r.diff.changedLineIds).toEqual(['l-1']);
  });

  it('scaleGuests rescales history packs and keeps pending on suggested', () => {
    const history = { adjustment: adjustment(), historyPacks: 8, suggestedPacks: 9, choice: 'pending' as const };
    const d = draft({ lines: [line({ packs: 9, quantity: 54, history })] });
    const r = applyDraftChange(d, { kind: 'scaleGuests', guests: 600 }, ctx);
    const l = r.draft.lines[0];
    expect(l.history).toMatchObject({ suggestedPacks: 18, historyPacks: 17, choice: 'pending' });
    expect(l.packs).toBe(18);
    expect(l.history!.adjustment.adjustedQty).toBeCloseTo(97.2);
  });

  it('scaleGuests keeps diet variants unchanged but capped at the total', () => {
    const d = draft();
    d.components.push({ ...d.components[0], id: 'c-v', dietVariantOf: 'c-1', guests: 12 });
    const r = applyDraftChange(d, { kind: 'scaleGuests', guests: 10 }, ctx);
    expect(r.draft.components[1].guests).toBe(10);
  });

  it('setPacks on pending history wins, collapses, and moves totals', () => {
    const history = { adjustment: adjustment(), historyPacks: 8, suggestedPacks: 9, choice: 'pending' as const };
    const d = draft({ lines: [line({ packs: 9, quantity: 54, history })] });
    const r = applyDraftChange(d, { kind: 'setPacks', lineId: 'l-1', packs: 12 }, ctx);
    expect(r.draft.lines[0].packs).toBe(12);
    expect(r.draft.lines[0].history?.choice).toBe('suggested');
    expect(r.draft.totals).toMatchObject({ collapsed: true, low: 120, high: 120 });
  });

  it('setPacks clamps at zero and rounds up to the lot size', () => {
    const lotCtx = { getProduct: () => product({ allowedLotSize: 4 }) };
    expect(applyDraftChange(draft(), { kind: 'setPacks', lineId: 'l-1', packs: 5 }, lotCtx).draft.lines[0].packs).toBe(8);
    expect(applyDraftChange(draft(), { kind: 'setPacks', lineId: 'l-1', packs: -3 }, ctx).draft.lines[0].packs).toBe(0);
  });

  it('scaleGuests still rescales a line whose product is missing', () => {
    const r = applyDraftChange(draft(), { kind: 'scaleGuests', guests: 320 }, { getProduct: () => undefined });
    expect(r.draft.lines[0]).toMatchObject({ packs: 10, quantity: 60 });
  });
});
