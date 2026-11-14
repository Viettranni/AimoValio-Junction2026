import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.AIMO_DB_PATH = ':memory:'; });

import type { Receipt } from '@/contracts';
import { getReceipt, listOrders } from '@/db/repo';
import { resetAndSeed } from '@/db/seed';
import { findPastOrders, reorderAmounts } from './history';

const ctx = { customerId: 'helsinki-juhlapalvelu' };
beforeAll(() => { resetAndSeed(); });

describe('order history in the chat', () => {
  it('finds a past order by its date (± 1 day), with its lines and leftovers', () => {
    const target = listOrders(ctx.customerId)[2];
    const r = findPastOrders({ date: target.eventDate }, ctx);
    const hit = r.orders.find((o) => o.orderId === target.orderId)!;
    expect(hit).toMatchObject({ eventName: target.eventName, guests: target.guests });
    expect(hit.lines?.length).toBeGreaterThan(0);
    expect(hit.lines?.some((l) => 'afterEvent' in l)).toBe(true);
  });

  it('finds by name words, and says so when nothing matches', () => {
    const r = findPastOrders({ query: 'wedding' }, ctx);
    expect(r.orders.length).toBeGreaterThan(0);
    expect(r.orders.every((o) => /wedding/i.test(o.eventName))).toBe(true);
    expect(findPastOrders({ query: 'zzzz-nothing' }, ctx)).toMatchObject({ orders: [], note: expect.any(String) });
    expect(findPastOrders({}, { customerId: 'someone-else' }).orders).toEqual([]);
  });

  it('scales to the new guest count and corrects by last time\'s leftovers and shortfalls', () => {
    const receipt = {
      guests: 100,
      lines: [
        { lineId: 'l-1', productId: 'a', productName: 'Rice', quantity: 20, unit: 'kg' },
        { lineId: 'l-2', productId: 'b', productName: 'Chicken', quantity: 30, unit: 'kg' },
        { lineId: 'l-3', productId: 'c', productName: 'Cream', quantity: 10, unit: 'l' },
      ],
    } as unknown as Receipt;
    const left = new Map([['l-1', 4], ['l-2', -3]]);
    expect(reorderAmounts(receipt, 150, left, true).map((l) => [l.now, l.why])).toEqual([
      [24, '100 → 150 guests; 4 kg was left over'],
      [49.5, '100 → 150 guests; ran 3 kg short'],
      [15, '100 → 150 guests'],
    ]);
    expect(reorderAmounts(receipt, 100, left, false).map((l) => [l.now, l.why])).toEqual([[20, null], [30, null], [10, null]]);
  });

  it('never cuts a line below a quarter of last time', () => {
    const receipt = { guests: 10, lines: [{ lineId: 'l-1', productId: 'a', productName: 'Rice', quantity: 8, unit: 'kg' }] } as unknown as Receipt;
    expect(reorderAmounts(receipt, 10, new Map([['l-1', 8]]), true)[0].now).toBe(2);
  });

  it('seeded receipts can be read back for a reorder', () => {
    const o = listOrders(ctx.customerId)[0];
    expect(getReceipt(o.orderId)?.lines.length).toBeGreaterThan(0);
  });
});
