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
  const cutoff = '2026-11-19T14:00:00+0200'; // for delivery on Friday 20 Nov
  it('moves to the first date whose cut-off is still ahead', () => {
    expect(nextOrderableDate('2026-11-20', cutoff, new Date('2026-11-20T07:00:00Z'))).toBe('2026-11-21');
  });
  it('skips Sundays and dates whose shifted cut-off has passed too', () => {
    // Saturday 21 Nov 10:00Z: Saturday's cut-off (Fri 12:00Z) has passed; Sunday's would not have, but Sunday is skipped.
    expect(nextOrderableDate('2026-11-20', cutoff, new Date('2026-11-21T10:00:00Z'))).toBe('2026-11-23');
  });
  it('is null without a cut-off', () => {
    expect(nextOrderableDate('2026-11-20', null, new Date())).toBeNull();
  });
});
