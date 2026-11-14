import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry, Draft, DraftLine, Receipt } from '@/contracts';
import { createDb, type Db } from './client';
import {
  appendAudit, getClockOffsetDays, getDraftByConversation, getOrderLines, getReceipt,
  insertOrder, listAudit, listLeftoverRecords, listOrders, nextOrderId, now,
  recordLeftovers, saveDraft, setClockOffsetDays,
} from './repo';
import { resetAndSeed } from './seed';

let db: Db;
beforeEach(() => { db = createDb(':memory:'); });

function line(id: string, group: DraftLine['group'], packs: number, packSize: number): DraftLine {
  return {
    id, componentId: `c-${id}`, group, productId: `p-${id}`, productName: `Product ${id}`,
    packDescription: `${packSize} kg`, packs, quantity: packs * packSize, unit: 'kg',
    unitPrice: 10, unitPriceWithTax: 11.4, tags: [],
    allergen: { productId: `p-${id}`, verdict: 'pass', conflicts: [], unmetDiets: [] }, alternatives: [],
  };
}

function fixture(orderId = 'VA-2026-00001') {
  const lines = [line('l-1', 'poultry_main', 10, 4), line('l-2', 'grain_side', 4, 5)];
  const draft = {
    id: 'd1', conversationId: 'conv-1', customerId: 'helsinki-juhlapalvelu', lines, status: 'submitted',
    updatedAt: '2026-11-01T10:00:00Z',
  } as unknown as Draft;
  const receipt: Receipt = {
    orderId, simulated: true, customerId: 'helsinki-juhlapalvelu', eventName: 'Wedding', eventType: 'wedding',
    deliveryDate: '2026-12-05', guests: 100,
    lines: lines.map((l) => ({
      lineId: l.id, productId: l.productId, productName: l.productName, packs: l.packs, quantity: l.quantity,
      unit: l.unit, unitPrice: 10, unitPriceWithTax: 11.4, lineTotal: l.packs * 10, lineTotalWithTax: l.packs * 11.4,
    })),
    total: 140, totalWithTax: 159.6, vat: 19.6, co2Kg: null, minutesSaved: 40, submittedAt: '2026-11-14T09:00:00Z',
  };
  return { draft, receipt };
}

describe('drafts', () => {
  it('upserts and reads back the latest draft per conversation', () => {
    const { draft } = fixture();
    saveDraft(draft, db);
    saveDraft({ ...draft, status: 'ready', updatedAt: '2026-11-02T10:00:00Z' }, db);
    expect(getDraftByConversation('conv-1', db)?.status).toBe('ready');
    expect(getDraftByConversation('nope', db)).toBeNull();
  });
});

describe('orders', () => {
  it('round-trips an order, its lines and receipt', () => {
    const { draft, receipt } = fixture();
    insertOrder(receipt, draft, db);
    const [summary] = listOrders('helsinki-juhlapalvelu', db);
    expect(summary).toMatchObject({
      orderId: receipt.orderId, eventName: 'Wedding', eventDate: '2026-12-05', guests: 100,
      total: 140, leftoverRatio: null, checkInDone: false,
    });
    expect(getReceipt(receipt.orderId, db)).toEqual(receipt);
    expect(getReceipt('missing', db)).toBeNull();
    const lines = getOrderLines(receipt.orderId, db);
    expect(lines.map((l) => [l.id, l.category, l.quantity])).toEqual([
      ['l-1', 'poultry_main', 40], ['l-2', 'grain_side', 20],
    ]);
    expect(listOrders('other-customer', db)).toEqual([]);
  });

  it('recordLeftovers writes records, sets checkInDone and a weighted ratio', () => {
    const { draft, receipt } = fixture();
    insertOrder(receipt, draft, db);
    expect(listLeftoverRecords('helsinki-juhlapalvelu', db)).toEqual([]);
    recordLeftovers(receipt.orderId, [{ lineId: 'l-1', leftoverQty: 4 }, { lineId: 'l-2', leftoverQty: -1 }], db);
    const records = listLeftoverRecords('helsinki-juhlapalvelu', db);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      orderId: receipt.orderId, lineId: 'l-1', category: 'poultry_main', eventType: 'wedding',
      eventName: 'Wedding', eventDate: '2026-12-05', orderedQty: 40, leftoverQty: 4, unit: 'kg',
    });
    const [summary] = listOrders('helsinki-juhlapalvelu', db);
    expect(summary.checkInDone).toBe(true);
    expect(summary.leftoverRatio).toBeCloseTo(3 / 60);
  });

  it('rejects leftovers for an unknown line', () => {
    const { draft, receipt } = fixture();
    insertOrder(receipt, draft, db);
    expect(() => recordLeftovers(receipt.orderId, [{ lineId: 'zzz', leftoverQty: 1 }], db)).toThrow();
  });
});

describe('audit', () => {
  it('appends and filters by conversation and order', () => {
    const a = appendAudit({ conversationId: 'c1', actor: 'intake', action: 'x', summary: 'one', data: { k: 1 } }, db);
    appendAudit({ conversationId: 'c1', orderId: 'o1', actor: 'order', action: 'submit', summary: 'two' }, db);
    appendAudit({ conversationId: 'c2', orderId: 'o2', actor: 'order', action: 'submit', summary: 'three' }, db);
    expect(a.id).toBeTruthy();
    expect(listAudit({ conversationId: 'c1' }, db).map((e: AuditEntry) => e.summary)).toEqual(['one', 'two']);
    expect(listAudit({ orderId: 'o2' }, db).map((e) => e.summary)).toEqual(['three']);
    expect(listAudit({ conversationId: 'c1' }, db)[0].data).toEqual({ k: 1 });
  });
});

describe('clock and ids', () => {
  it('now() honours the offset', () => {
    expect(getClockOffsetDays(db)).toBe(0);
    setClockOffsetDays(3, db);
    expect(getClockOffsetDays(db)).toBe(3);
    const diffDays = (now(db).getTime() - Date.now()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(2.99);
    expect(diffDays).toBeLessThan(3.01);
  });

  it('nextOrderId is unique and well formed', () => {
    const ids = new Set(Array.from({ length: 50 }, () => nextOrderId(db)));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^VA-\d{4}-\d{5}$/);
  });
});

describe('seed', () => {
  it('seeds 8 orders with receipts, audit and leftovers but none for desserts', () => {
    resetAndSeed(db);
    const orders = listOrders('helsinki-juhlapalvelu', db);
    expect(orders).toHaveLength(8);
    expect(orders.every((o) => o.checkInDone && o.guests >= 60 && o.guests <= 300)).toBe(true);
    for (const o of orders) {
      expect(getReceipt(o.orderId, db)?.simulated).toBe(true);
      expect(listAudit({ orderId: o.orderId }, db).length).toBeGreaterThan(0);
      const n = getOrderLines(o.orderId, db).length;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(7);
    }
    const records = listLeftoverRecords('helsinki-juhlapalvelu', db);
    const cats = new Set(records.map((r) => r.category));
    expect(cats.has('poultry_main') && cats.has('grain_side')).toBe(true);
    expect(cats.has('dessert')).toBe(false);
    const rice = records.filter((r) => r.category === 'grain_side');
    expect(rice.some((r) => r.leftoverQty < 0)).toBe(true);
    const wedding = records.filter((r) => r.eventType === 'wedding' && r.category === 'poultry_main');
    expect(wedding.some((r) => r.leftoverQty >= 5 && r.leftoverQty <= 7)).toBe(true);
  });

  it('is repeatable (wipes before seeding)', () => {
    resetAndSeed(db);
    setClockOffsetDays(5, db);
    resetAndSeed(db);
    expect(listOrders('helsinki-juhlapalvelu', db)).toHaveLength(8);
    expect(getClockOffsetDays(db)).toBe(0);
  });
});
