import { describe, expect, it } from 'vitest';
import type { AvailabilityInfo } from '@/contracts';
import { deliverableOn, effectiveCutoff, nextOrderableDate } from './cutoff';

const avail = (o: Partial<AvailabilityInfo>): AvailabilityInfo => ({
  productId: '467238', deliverable: true, salesBlock: false, logisticModel: 'Stock', availableAmount: 100,
  availableDate: '2026-11-16', closingTime: '2026-11-10T14:00:00+0200', fetchedAt: '', ...o,
});

describe('effectiveCutoff', () => {
  it('shifts the earliest cut-off by the lead time for a later delivery (467238)', () => {
    expect(effectiveCutoff(avail({}), '2026-12-06')).toBe('2026-11-30T14:00:00+0200');
  });
  it('is the closing time when the requested date is the earliest date', () => {
    expect(effectiveCutoff(avail({}), '2026-11-16')).toBe('2026-11-10T14:00:00+0200');
  });
  it('is the closing time when the product arrives later than requested, and the line is not deliverable on time', () => {
    const a = avail({ availableDate: '2026-12-10', closingTime: '2026-12-04T14:00:00+0200' });
    expect(effectiveCutoff(a, '2026-12-06')).toBe('2026-12-04T14:00:00+0200');
    expect(deliverableOn(a, '2026-12-06')).toBe(false);
    expect(deliverableOn(avail({}), '2026-12-06')).toBe(true);
  });
  it('is null without a closing time or available date', () => {
    expect(effectiveCutoff(avail({ closingTime: null }), '2026-12-06')).toBeNull();
    expect(effectiveCutoff(avail({ availableDate: null }), '2026-12-06')).toBeNull();
  });
  it('handles month boundaries', () => {
    expect(effectiveCutoff(avail({ availableDate: '2026-11-16', closingTime: '2026-11-14T09:00:00Z' }), '2026-12-01'))
      .toBe('2026-11-29T09:00:00Z');
  });
});

describe('nextOrderableDate', () => {
  // Valio: earliest delivery Mon 16 Nov, ordered by Thu 12 Nov 14:00 (a four-day lead time).
  const a = avail({ availableDate: '2026-11-16', closingTime: '2026-11-12T14:00:00+0200' });
  it('moves to the first date every product can be delivered and still ordered for', () => {
    // Sat 14 Nov 14:22Z: the 18th's cut-off (Sat 14 Nov 12:00Z) has passed, the 19th's (Sun 12:00Z) has not.
    expect(nextOrderableDate([a], '2026-11-15', new Date('2026-11-14T14:22:00Z'))).toBe('2026-11-19');
    expect(nextOrderableDate([a], '2026-11-15', new Date('2026-11-12T10:00:00Z'))).toBe('2026-11-16');
  });
  it('skips Sundays', () => {
    const b = avail({ availableDate: '2026-11-21', closingTime: '2026-11-20T14:00:00+0200' });
    expect(nextOrderableDate([b], '2026-11-21', new Date('2026-11-20T08:00:00Z'))).toBe('2026-11-23');
  });
  it('is null without usable availability', () => {
    expect(nextOrderableDate([], '2026-11-20', new Date())).toBeNull();
  });
});
