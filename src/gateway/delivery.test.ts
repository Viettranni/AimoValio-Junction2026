import { describe, expect, it } from 'vitest';
import { deliveryStatus, helsinkiAt, nextStepAt, shortfall, summarizeDelivery, unitHash, type DeliveryOrder, type DeliveryOrderLine } from './delivery';

const line = (lineId: string, over: Partial<DeliveryOrderLine> = {}): DeliveryOrderLine => ({
  lineId, productId: `p-${lineId}`, productName: `Product ${lineId}`, packs: 10, quantity: 50, unit: 'kg', logisticModel: 'Stock', reliability: 0.97, ...over,
});
const order = (over: Partial<DeliveryOrder> = {}): DeliveryOrder => ({
  orderId: 'VA-2026-00001', submittedAt: '2026-11-14T10:00:00Z', deliveryDate: '2026-12-06', cutoff: '2026-12-04T10:00:00Z',
  lines: [line('l-1'), line('l-2')], ...over,
});
const at = (iso: string) => new Date(iso);

describe('delivery timeline', () => {
  it('uses Helsinki local time (EET in winter, EEST in summer)', () => {
    expect(new Date(helsinkiAt('2026-12-05', 18)).toISOString()).toBe('2026-12-05T16:00:00.000Z');
    expect(new Date(helsinkiAt('2026-06-05', 18)).toISOString()).toBe('2026-06-05T15:00:00.000Z');
  });

  it('walks received → confirmed → picking → out for delivery → delivered by the clock', () => {
    const o = order();
    const s0 = deliveryStatus(o, at('2026-11-14T10:10:00Z'));
    expect(s0.state).toBe('received');
    const confirmedAt = Date.parse(s0.steps[1].at);
    // About an hour after the order (45–75 min).
    expect(confirmedAt - Date.parse(o.submittedAt)).toBeGreaterThanOrEqual(45 * 60_000);
    expect(confirmedAt - Date.parse(o.submittedAt)).toBeLessThanOrEqual(75 * 60_000);
    expect(deliveryStatus(o, at('2026-11-14T12:00:00Z')).state).toBe('confirmed');
    expect(s0.steps[2].at).toBe('2026-12-05T16:00:00.000Z'); // day before, 18:00 Helsinki
    expect(deliveryStatus(o, at('2026-12-05T16:30:00Z')).state).toBe('picking');
    expect(s0.steps[3].at).toBe('2026-12-06T04:00:00.000Z'); // delivery day, 06:00 Helsinki
    const out = deliveryStatus(o, at('2026-12-06T04:30:00Z'));
    expect(out.state).toBe('out_for_delivery');
    // A 3-hour window starting 07, 08 or 09 Helsinki time; delivered at its end.
    expect(['2026-12-06T05:00:00.000Z', '2026-12-06T06:00:00.000Z', '2026-12-06T07:00:00.000Z']).toContain(out.eta.from);
    expect(Date.parse(out.eta.to) - Date.parse(out.eta.from)).toBe(3 * 3600_000);
    expect(out.steps[4].at).toBe(out.eta.to);
    expect(out.lines.every((l) => l.deliveredQty === null)).toBe(true);
    const done = deliveryStatus(o, at(out.eta.to));
    expect(done).toMatchObject({ state: 'delivered', nextChangeAt: null, cutoffPassed: true });
    expect(done.lines.map((l) => l.deliveredQty)).toEqual([50, 50]);
  });

  it('confirms at the cut-off when that comes before the usual hour', () => {
    const s = deliveryStatus(order({ submittedAt: '2026-12-04T09:40:00Z' }), at('2026-12-04T09:41:00Z'));
    expect(s.steps[1].at).toBe('2026-12-04T10:00:00.000Z');
  });

  it('gives the next main step for the demo clock', () => {
    const o = order();
    expect(nextStepAt(o, at('2026-11-14T10:10:00Z'))).toBe(deliveryStatus(o, at('2026-11-14T10:10:00Z')).steps[1].at);
    expect(nextStepAt(o, at('2026-12-07T00:00:00Z'))).toBeNull();
  });

  it('gives supplier (Terminal) lines their own track before picking', () => {
    const o = order({ lines: [line('l-1'), line('l-2', { logisticModel: 'Terminal' })] });
    const before = deliveryStatus(o, at('2026-11-14T10:10:00Z'));
    expect(before.supplier).toMatchObject({ lineIds: ['l-2'], state: 'waiting' });
    expect(deliveryStatus(o, at('2026-11-20T00:00:00Z')).supplier?.state).toBe('ordered');
    const arrived = Date.parse(before.supplier!.arrivedAt);
    // Arrives at the terminal the day before delivery, 10:00–16:00 Helsinki, before picking starts.
    expect(arrived).toBeGreaterThanOrEqual(helsinkiAt('2026-12-05', 10));
    expect(arrived).toBeLessThanOrEqual(helsinkiAt('2026-12-05', 16));
    expect(arrived).toBeLessThan(Date.parse(before.steps[2].at));
    expect(deliveryStatus(o, new Date(arrived)).supplier?.state).toBe('arrived');
    expect(deliveryStatus(order(), at('2026-11-20T00:00:00Z')).supplier).toBeNull();
  });

  it('delivers unreliable lines short deterministically, with probability 1 − reliability', () => {
    const l = line('l-9', { reliability: 0.5 });
    // Same order and line → same answer, every time.
    expect(shortfall('VA-1', l)).toEqual(shortfall('VA-1', l));
    // Reliable lines are never short.
    expect(shortfall('VA-1', line('l-9', { reliability: 0.95 }))).toBeNull();
    expect(shortfall('VA-1', line('l-9', { reliability: null }))).toBeNull();
    let shorts = 0;
    for (let i = 0; i < 2000; i++) {
      const s = shortfall(`VA-${i}`, l);
      if (s) {
        shorts++;
        expect(s.deliveredPacks).toBeLessThan(l.packs);
        expect(s.deliveredPacks).toBeGreaterThanOrEqual(0);
      }
    }
    expect(shorts / 2000).toBeGreaterThan(0.45);
    expect(shorts / 2000).toBeLessThan(0.55);
  });

  it('reports a short line only once delivered, with the reason', () => {
    // Find an order id whose line is short (deterministic search).
    const unreliable = line('l-1', { reliability: 0.6, packs: 5, quantity: 22 });
    const id = Array.from({ length: 100 }, (_, i) => `VA-2026-${i}`).find((x) => shortfall(x, unreliable))!;
    const o = order({ orderId: id, lines: [unreliable, line('l-2')] });
    expect(deliveryStatus(o, at('2026-12-06T04:30:00Z')).lines[0]).toMatchObject({ short: false, deliveredQty: null });
    const done = deliveryStatus(o, at('2026-12-07T00:00:00Z'));
    const { deliveredPacks } = shortfall(id, unreliable)!;
    expect(done.lines[0]).toMatchObject({ short: true, reason: 'supplier delivered short', deliveredPacks, deliveredQty: deliveredPacks * 4.4 });
    expect(done.lines[1]).toMatchObject({ short: false, deliveredQty: 50 });
    expect(done.notes.join(' ')).toMatch(/supplier delivered short/);
    expect(summarizeDelivery(done)).toMatchObject({ state: 'delivered', shortLines: 1 });
  });

  it('flags a late risk when ordered within 2 h of the cut-off', () => {
    expect(deliveryStatus(order({ submittedAt: '2026-12-04T08:30:00Z' }), at('2026-12-04T08:31:00Z')).lateRisk?.reason).toMatch(/90 min before the order cut-off/);
    expect(deliveryStatus(order(), at('2026-11-14T10:10:00Z')).lateRisk).toBeNull();
    expect(deliveryStatus(order({ cutoff: null }), at('2026-11-14T10:10:00Z')).lateRisk).toBeNull();
  });

  it('hashes to [0, 1)', () => {
    for (const s of ['', 'a', 'VA-2026-00001:eta']) {
      expect(unitHash(s)).toBeGreaterThanOrEqual(0);
      expect(unitHash(s)).toBeLessThan(1);
    }
  });
});
