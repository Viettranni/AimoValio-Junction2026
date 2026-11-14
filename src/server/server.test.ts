// The old widget-only submit path is gone: every order goes through the gateway's placeOrder / decideApproval
// (src/gateway/widget.test.ts and gateway tests cover what approveAndSubmit used to: fresh Valio re-check,
// undeliverable lines, cut-off, stale and missing prices, allergen conflicts and confirmations, double submit).
import { beforeEach, describe, expect, it } from 'vitest';
import type { Receipt } from '@/contracts';
import { createDb, type Db } from '@/db/client';
import { listLeftoverRecords, now, storeOrder, upsertCustomer } from '@/db/repo';
import { minutesSaved } from '@/gateway/orders';
import { submitCheckIn } from './checkin';
import { fastForward } from './demo';

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  orderId: 'VA-2026-00042', simulated: true, customerId: 'helsinki-juhlapalvelu', eventName: 'Wedding', eventType: 'wedding', deliveryDate: '2026-12-06', guests: 50,
  lines: [
    { lineId: 'l-1', productId: 'p1', productName: 'Product l-1', packs: 2, quantity: 10, unit: 'kg', unitPrice: 10, unitPriceWithTax: 11.4, lineTotal: 20, lineTotalWithTax: 22.8 },
    { lineId: 'l-2', productId: 'p2', productName: 'Product l-2', packs: 2, quantity: 10, unit: 'kg', unitPrice: 10, unitPriceWithTax: 11.4, lineTotal: 20, lineTotalWithTax: 22.8 },
  ],
  total: 40, totalWithTax: 45.6, vat: 5.6, co2Kg: null, minutesSaved: 11, submittedAt: '2026-11-14T10:00:00Z', ...over,
});

let db: Db;
beforeEach(() => {
  db = createDb(':memory:');
  upsertCustomer({ id: 'helsinki-juhlapalvelu', name: 'C' }, db);
  storeOrder(receipt(), new Map([['l-1', 'poultry_main'], ['l-2', 'grain_side']]), db);
});

describe('minutesSaved', () => {
  it('is 5 + 3 per line, capped at 60', () => {
    expect(minutesSaved(4)).toBe(17);
    expect(minutesSaved(30)).toBe(60);
  });
});

describe('check-in and fast-forward', () => {
  it('fills 0 for unmentioned lines', () => {
    submitCheckIn('VA-2026-00042', [{ lineId: 'l-1', leftoverQty: 3 }], db);
    const recs = listLeftoverRecords('helsinki-juhlapalvelu', db);
    expect(recs.map((r) => [r.lineId, r.leftoverQty])).toEqual([['l-1', 3], ['l-2', 0]]);
    expect(() => submitCheckIn('VA-2026-00042', [{ lineId: 'nope', leftoverQty: 1 }], db)).toThrow();
  });

  it('moves the clock to the day after delivery and returns ordered quantities', () => {
    const ev = fastForward('conv', db);
    expect(ev).toMatchObject({ orderId: 'VA-2026-00042', eventName: 'Wedding', lines: [{ lineId: 'l-1', quantity: 10 }, { lineId: 'l-2', quantity: 10 }] });
    // Nothing delivered short: no prefill, the buyer answers in free text.
    expect(ev.lines[0]).not.toHaveProperty('leftoverQty');
    expect(now(db).getTime()).toBeGreaterThanOrEqual(Date.parse('2026-12-07'));
    expect(now(db).getTime()).toBeLessThan(Date.parse('2026-12-09'));
  });
});
