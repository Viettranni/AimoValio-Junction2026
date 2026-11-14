import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db/client';
import { resetAndSeed } from '@/db/seed';
import { GatewayError } from './offers';
import { getWasteReport, logWaste } from './waste';
import type { AgentIdentity } from './types';

const agent: AgentIdentity = { agentId: 'procurement-agent', customerId: 'helsinki-juhlapalvelu', displayName: 'Test agent' };
let db: Db;

beforeEach(() => {
  db = createDb(':memory:');
  resetAndSeed(db);
});

describe('food waste', () => {
  it('matches names to past orders first and values them at the price paid', () => {
    const r = logWaste({ entries: [{ name: 'basmatiriisi', quantity: 2, unit: 'kg', reason: 'overproduction' }] }, { agent, db });
    expect(r.logged[0]).toMatchObject({ productId: '463624', matchedBy: 'past_orders', quantity: 2, unit: 'kg', reason: 'overproduction' });
    expect(r.logged[0].valueEur).toBeGreaterThan(0);
    expect(r.totals.valueEur).toBe(r.logged[0].valueEur);
    expect(r.unmatched).toEqual([]);
  });

  it('converts packs to the product unit and falls back to the catalogue', () => {
    const r = logWaste({ entries: [{ productId: '464249', quantity: 3, unit: 'packs', reason: 'expired' }] }, { agent, db });
    expect(r.logged[0]).toMatchObject({ quantity: 3, unit: 'l', matchedBy: 'productId' });
    const milk = logWaste({ entries: [{ name: 'laktoositon maito', quantity: 5, unit: 'l', reason: 'expired' }] }, { agent, db });
    expect(['catalog', 'past_orders']).toContain(milk.logged[0].matchedBy);
    expect(milk.logged[0].productId).not.toBeNull();
  });

  it('refuses future dates, empty lists and other customers\' orders', () => {
    const e = [{ name: 'riisi', quantity: 1, unit: 'kg' as const, reason: 'other' as const }];
    expect(() => logWaste({ entries: e, date: '2999-01-01' }, { agent, db })).toThrow(GatewayError);
    expect(() => logWaste({ entries: [] }, { agent, db })).toThrow(GatewayError);
    expect(() => logWaste({ entries: e, orderId: 'VA-NOPE' }, { agent, db })).toThrow(/No order/);
    expect(() => logWaste({ entries: e }, { agent: { ...agent, customerId: 'other' }, db })).not.toThrow();
  });

  it('reports the seeded history with event leftovers and insights', () => {
    const r = getWasteReport({}, { agent, db });
    expect(r.logged.entries).toBe(7);
    expect(r.logged.valueEur).toBeGreaterThan(0);
    expect(r.byReason.map((b) => b.reason)).toEqual(['expired', 'overproduction', 'spoiled', 'plate_waste']);
    expect(r.byReason.find((b) => b.reason === 'overproduction')).toMatchObject({ entries: 3, valueEur: 33.5 });
    expect(r.topProducts[0]).toMatchObject({ times: 2, unit: 'l', valueEur: 46 });
    expect(r.topProducts.find((p) => p.unit === 'kg' && p.times === 3)).toMatchObject({ quantity: 12.5 });
    expect(r.eventLeftovers.events).toBeGreaterThan(0);
    expect(r.insights.some((i) => /thrown away 3 times/.test(i))).toBe(true);
  });

  it('keeps each customer\'s waste to themselves', () => {
    const other = { ...agent, customerId: 'someone-else' };
    expect(getWasteReport({}, { agent: other, db }).logged.entries).toBe(0);
  });
});
