import { describe, expect, it } from 'vitest';
import type { LeftoverRecord } from '@/contracts';
import { computeHistoryAdjustment } from './history';

const now = new Date('2026-11-14T00:00:00Z');
const rec = (o: Partial<LeftoverRecord>): LeftoverRecord => ({
  orderId: 'o1', lineId: 'l1', productId: 'p1', category: 'grain_side', eventType: 'wedding',
  eventName: 'Wedding', eventDate: '2026-05-14', orderedQty: 500, leftoverQty: 50, unit: 'kg', ...o,
});
const input = { productId: 'p1', category: 'grain_side' as const, eventType: 'wedding' as const, suggestedQty: 50, unit: 'kg' as const, now };

describe('computeHistoryAdjustment', () => {
  it('needs evidence: one record of a different product gives null', () => {
    expect(computeHistoryAdjustment({ ...input, records: [rec({ productId: 'other' })] })).toBeNull();
  });
  it('one same-product same-event record is enough: 500/50 -> 0.10, 50 -> 45', () => {
    const r = computeHistoryAdjustment({ ...input, records: [rec({})] })!;
    expect(r.basis).toBe('same_product');
    expect(r.ratio).toBeCloseTo(0.1);
    expect(r.adjustedQty).toBeCloseTo(45);
    expect(r.sampleSize).toBe(1);
    expect(r.last?.eventName).toBe('Wedding');
  });
  it('shortfall gives negative ratio', () => {
    const r = computeHistoryAdjustment({ ...input, records: [rec({ orderedQty: 400, leftoverQty: -20 })] })!;
    expect(r.ratio).toBeCloseTo(-0.05);
    expect(r.adjustedQty).toBeCloseTo(52.5);
  });
  it('same product with a different event type needs two records', () => {
    const one = rec({ eventType: 'party' });
    expect(computeHistoryAdjustment({ ...input, records: [one] })).toBeNull();
    expect(computeHistoryAdjustment({ ...input, records: [one, rec({ eventType: 'party', eventDate: '2026-01-01' })] })?.basis).toBe('same_product');
  });
  it('falls back to same_category_event then same_category', () => {
    const a = rec({ productId: 'x', orderId: 'a' });
    const b = rec({ productId: 'y', orderId: 'b', eventDate: '2026-02-01' });
    expect(computeHistoryAdjustment({ ...input, records: [a, b] })?.basis).toBe('same_category_event');
    const c = rec({ productId: 'x', eventType: 'party' });
    const d = rec({ productId: 'y', eventType: 'school', eventDate: '2026-02-01' });
    expect(computeHistoryAdjustment({ ...input, records: [c, d] })?.basis).toBe('same_category');
  });
  it('recency weighting favours newer records', () => {
    const newer = rec({ orderId: 'n', eventDate: '2026-11-01', leftoverQty: 100 }); // 0.20
    const older = rec({ orderId: 'o', eventDate: '2025-05-01', leftoverQty: 0 });   // 0.00
    const r = computeHistoryAdjustment({ ...input, records: [newer, older] })!;
    expect(r.ratio).toBeGreaterThan(0.1);
    expect(r.last?.eventDate).toBe('2026-11-01');
  });
  it('ignores records in another unit', () => {
    expect(computeHistoryAdjustment({ ...input, records: [rec({ unit: 'l' })] })).toBeNull();
  });
});
