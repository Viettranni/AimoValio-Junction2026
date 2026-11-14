import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityInfo, Draft, DraftLine } from '@/contracts';
import { createDb, type Db } from '@/db/client';
import { getDraftByConversation, getReceipt, listAudit, listOrders, listLeftoverRecords, now, saveDraft, setClockOffsetDays } from '@/db/repo';
import { upsertCustomer } from '@/db/repo';
import { submitCheckIn } from './checkin';
import { fastForward } from './demo';
import { approveAndSubmit, minutesSaved } from './orders';

const getAvailability = vi.fn();
vi.mock('@/valio/client', () => ({ getAvailability: (...a: unknown[]) => getAvailability(...a) }));
vi.mock('@/catalog', () => ({ getProduct: (id: string) => (id === 'p1' ? { co2PerKg: 2 } : id === 'p3' ? { salesUnit: 'KG', packSize: 4.4 } : undefined) }));

const line = (id: string, over: Partial<DraftLine> = {}): DraftLine => ({
  id, componentId: `c-${id}`, group: 'poultry_main', productId: `p${id.slice(2)}`, productName: `Product ${id}`,
  packDescription: '5 kg', packs: 2, quantity: 10, unit: 'kg', unitPrice: 10, unitPriceWithTax: 11.4, tags: [],
  allergen: { productId: 'x', verdict: 'pass', conflicts: [], unmetDiets: [] }, alternatives: [], ...over,
});
const draft = (lines: DraftLine[]): Draft => ({
  id: 'd1', conversationId: 'conv', customerId: 'cust', intake: { deliveryDate: '2026-12-06', guests: 50, eventName: 'Wedding', eventType: 'wedding' },
  components: [], lines, totals: {} as Draft['totals'], cutoff: null, status: 'ready', updatedAt: '2026-11-14T10:00:00Z',
});
const avail = (id: string, over: Partial<AvailabilityInfo> = {}): AvailabilityInfo => ({
  productId: id, deliverable: true, salesBlock: false, logisticModel: 'Stock', availableAmount: 100,
  availableDate: '2026-12-06', closingTime: '2099-01-01T00:00:00Z', fetchedAt: '2026-11-14T10:00:00Z', ...over,
});
const mockAvail = (over: Record<string, Partial<AvailabilityInfo>> = {}) =>
  getAvailability.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, avail(id, over[id])])));

let db: Db;
beforeEach(() => { db = createDb(':memory:'); upsertCustomer({ id: 'cust', name: 'C' }, db); getAvailability.mockReset(); });

describe('minutesSaved', () => {
  it('is 5 + 3 per line, capped at 60', () => {
    expect(minutesSaved(4)).toBe(17);
    expect(minutesSaved(30)).toBe(60);
  });
});

describe('approveAndSubmit', () => {
  it('submits a receipt when everything is deliverable', async () => {
    saveDraft(draft([line('l-1'), line('l-2')]), db);
    mockAvail();
    const r = await approveAndSubmit('conv', db);
    expect(r.problems).toBeUndefined();
    expect(r.receipt).toMatchObject({ total: 40, totalWithTax: 45.6, vat: 5.6, minutesSaved: 11, co2Kg: 20, guests: 50 });
    expect(r.receipt!.lines[0]).toMatchObject({ lineTotal: 20, lineTotalWithTax: 22.8 });
    expect(getReceipt(r.receipt!.orderId, db)).toEqual(r.receipt);
    expect(getDraftByConversation('conv', db)?.status).toBe('submitted');
    expect(listAudit({ conversationId: 'conv' }, db).map((a) => a.actor)).toEqual(['buyer', 'order']);
  });

  it('returns problems and submits nothing when a line turns undeliverable', async () => {
    saveDraft(draft([line('l-1'), line('l-2')]), db);
    mockAvail({ p2: { deliverable: false } });
    const r = await approveAndSubmit('conv', db);
    expect(r.receipt).toBeUndefined();
    expect(r.problems).toEqual([{ lineId: 'l-2', reason: expect.stringContaining('deliverable') }]);
    expect(getDraftByConversation('conv', db)?.status).toBe('ready');
  });

  it('blocks a passed cut-off relative to the demo clock, and a missing price', async () => {
    saveDraft(draft([line('l-1'), line('l-2', { unitPrice: null, unitPriceWithTax: null })]), db);
    mockAvail({ p1: { closingTime: '2026-11-20T00:00:00Z' } });
    setClockOffsetDays(30, db);
    expect(now(db).getTime()).toBeGreaterThan(Date.parse('2026-11-20'));
    const r = await approveAndSubmit('conv', db);
    expect(r.problems).toEqual([
      { lineId: 'l-1', reason: 'order cut-off has passed' },
      { lineId: 'l-2', reason: 'price unavailable' },
    ]);
  });
});

describe('availability units and double submit', () => {
  const kgLine = line('l-3', { packs: 5, quantity: 22 });
  it('compares KG products in kg', async () => {
    saveDraft(draft([kgLine]), db);
    mockAvail({ p3: { availableAmount: 20 } });
    expect((await approveAndSubmit('conv', db)).problems).toEqual([{ lineId: 'l-3', reason: 'only 20 kg available' }]);
    mockAvail({ p3: { availableAmount: 22 } });
    expect((await approveAndSubmit('conv', db)).receipt).toBeDefined();
  });

  it('does not block when availableAmount is null (Terminal)', async () => {
    saveDraft(draft([kgLine]), db);
    mockAvail({ p3: { availableAmount: null } });
    expect((await approveAndSubmit('conv', db)).receipt).toBeDefined();
  });

  it('submits once for concurrent approvals and returns the same receipt', async () => {
    saveDraft(draft([line('l-1')]), db);
    mockAvail();
    const [a, b] = await Promise.all([approveAndSubmit('conv', db), approveAndSubmit('conv', db)]);
    expect(a.receipt!.orderId).toBe(b.receipt!.orderId);
    expect(listOrders('cust', db)).toHaveLength(1);
  });
});

describe('check-in and fast-forward', () => {
  it('fills 0 for unmentioned lines', async () => {
    saveDraft(draft([line('l-1'), line('l-2')]), db);
    mockAvail();
    const { receipt } = await approveAndSubmit('conv', db);
    submitCheckIn(receipt!.orderId, [{ lineId: 'l-1', leftoverQty: 3 }], db);
    const recs = listLeftoverRecords('cust', db);
    expect(recs.map((r) => [r.lineId, r.leftoverQty])).toEqual([['l-1', 3], ['l-2', 0]]);
    expect(() => submitCheckIn(receipt!.orderId, [{ lineId: 'nope', leftoverQty: 1 }], db)).toThrow();
  });

  it('moves the clock to the day after delivery and returns ordered quantities', async () => {
    saveDraft(draft([line('l-1')]), db);
    mockAvail();
    const { receipt } = await approveAndSubmit('conv', db);
    const ev = fastForward('conv', db);
    expect(ev).toMatchObject({ orderId: receipt!.orderId, eventName: 'Wedding', lines: [{ lineId: 'l-1', quantity: 10 }] });
    expect(ev.lines[0]).not.toHaveProperty('leftoverQty');
    expect(now(db).getTime()).toBeGreaterThanOrEqual(Date.parse('2026-12-07'));
    expect(now(db).getTime()).toBeLessThan(Date.parse('2026-12-09'));
  });
});
