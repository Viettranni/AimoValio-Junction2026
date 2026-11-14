import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityInfo, PriceInfo } from '@/contracts';
import { createDb, type Db } from '@/db/client';
import { getReceipt, listAudit, listOrders } from '@/db/repo';

vi.mock('@/catalog/load', async () => {
  const { products } = await import('@/mastra/fixtures.test-util');
  return { loadCatalog: () => products };
});

const getPrices = vi.fn();
const getAvailability = vi.fn();
vi.mock('@/valio/client', () => ({
  getPrices: (...a: unknown[]) => getPrices(...a),
  getAvailability: (...a: unknown[]) => getAvailability(...a),
}));

import { DATE, fakeAvailability, fakePrices } from '@/mastra/fixtures.test-util';
import { AuthError, resolveAgent } from './agents';
import { decideApproval, listApprovals } from './approvals';
import { getPriceAndAvailability } from './lookup';
import { requestOffer } from './offers';
import { getOrderStatus, placeOrder } from './orders';
import { POLICIES } from './policies';
import { describePolicy, evaluatePolicy } from './policy';
import type { AgentIdentity, GatewayContext, Offer } from './types';

const NOW = new Date('2026-11-14T10:00:00Z');
const agent: AgentIdentity = { agentId: 'bot-1', customerId: 'helsinki-juhlapalvelu', displayName: 'Test bot' };
const otherAgent: AgentIdentity = { agentId: 'bot-2', customerId: 'other-customer', displayName: 'Other bot' };

let db: Db;
let ctx: GatewayContext;
let priceOver: Record<string, Partial<PriceInfo>>;
let availOver: Record<string, Partial<AvailabilityInfo>>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = createDb(':memory:');
  ctx = { agent, db };
  priceOver = {};
  availOver = {};
  // Fresh fetchedAt on every call, like the real client after a refresh.
  getPrices.mockImplementation(async (ids: string[]) => new Map([...fakePrices(ids)].map(([id, p]) =>
    [id, { ...p, fetchedAt: new Date().toISOString(), ...priceOver[id] }])));
  getAvailability.mockImplementation(async (ids: string[]) => new Map([...fakeAvailability(ids)].map(([id, a]) =>
    [id, { ...a, ...availOver[id] }])));
});
afterEach(() => vi.useRealTimers());

const advance = (minutes: number) => vi.setSystemTime(new Date(Date.now() + minutes * 60_000));

describe('identity', () => {
  it('maps API keys to agents and customers, and rejects unknown keys', () => {
    const env = { AIMO_AGENT_KEYS: JSON.stringify({ 'key-aaaaaaaa': agent, 'key-bbbbbbbb': otherAgent }) };
    expect(resolveAgent('key-bbbbbbbb', env)).toEqual(otherAgent);
    expect(() => resolveAgent('nope', env)).toThrow(AuthError);
    expect(() => resolveAgent(undefined, env)).toThrow(AuthError);
    expect(resolveAgent('aimo-demo-agent-key', {}).customerId).toBe('helsinki-juhlapalvelu');
  });

  it('fails closed when AIMO_AGENT_KEYS is set but invalid: no key works, not even the demo key', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveAgent('aimo-demo-agent-key', { AIMO_AGENT_KEYS: '{not json' })).toThrow(AuthError);
    expect(() => resolveAgent('aimo-demo-agent-key', { AIMO_AGENT_KEYS: JSON.stringify({ short: agent }) })).toThrow(AuthError);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("never shows or places another customer's offer", async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 2 }] }, ctx);
    const other = { agent: otherAgent, db };
    await expect(placeOrder({ offerId: offer.offerId }, other)).rejects.toThrow(/No offer/);
    expect(() => getOrderStatus(offer.offerId, other)).toThrow(/No order, approval or offer/);
    expect(offer.customerId).toBe('helsinki-juhlapalvelu');
  });
});

describe('getPriceAndAvailability', () => {
  it('prices KG products per kg and per pack, and reports cut-off and stock per product', async () => {
    const { quotes } = await getPriceAndAvailability(['chk', 'jas', 'nope'], DATE, { db, requirements: { requireDiet: ['gluten_free'] } });
    const [chk, jas, nope] = quotes;
    expect(chk.pricing).toMatchObject({ basis: 'per_kg', pricePerKg: 8.5, pricePerPack: 37.4, pricePerPackWithTax: 42.46 });
    expect(chk.availability).toMatchObject({ deliverableOnDate: true, availableAmountUnit: 'kg', availablePacks: 113, cutoff: '2026-12-04T10:00:00Z' });
    expect(chk.allergenCheck?.verdict).toBe('pass');
    expect(jas.availability).toMatchObject({ deliverableOnDate: false, reason: 'not deliverable' });
    expect(nope.found).toBe(false);
  });
});

describe('requestOffer', () => {
  it('quotes fixed prices, rounds net amounts up to packs and holds the price 15 min', async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'chk', quantity: 20, unit: 'kg' }, { productId: 'bas', quantity: 3 }] }, ctx);
    expect(offer.lines[0]).toMatchObject({ packs: 5, quantity: 22, unitPrice: 37.4, priceBasis: 'per_kg', valioPrice: 8.5, lineTotal: 187, available: true });
    expect(offer.lines[1]).toMatchObject({ packs: 3, unitPrice: 13.4, lineTotal: 40.2 });
    expect(offer.totals).toMatchObject({ total: 227.2, orderableLines: 2, excludedLines: 0 });
    expect(offer.cutoff).toBe('2026-12-03T10:00:00Z');
    expect(offer.validUntil).toBe('2026-11-14T10:15:00.000Z');
    expect(offer.status).toBe('open');
    expect(listAudit({ conversationId: offer.offerId }, db).map((a) => a.actor)).toEqual(['agent:bot-1']);
  });

  it('never holds a price past the cut-off', async () => {
    availOver = { bas: { closingTime: '2026-11-14T10:05:00Z' } };
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 1 }] }, ctx);
    expect(offer.validUntil).toBe('2026-11-14T10:05:00.000Z');
  });

  it('keeps undeliverable and short lines with a reason and suggests same-kind alternatives without swapping', async () => {
    const one = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'jas', quantity: 4 }] }, ctx);
    expect(one.lines[0]).toMatchObject({ productId: 'jas', status: 'unavailable', available: false, reason: 'not deliverable' });
    expect(one.lines[0].alternatives).toEqual([expect.objectContaining({ productId: 'bas', unitPrice: 13.4, reason: expect.stringContaining('4 packs deliverable') })]);

    availOver = { bas: { availableAmount: 2 } };
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'jas', quantity: 4 }, { productId: 'bas', quantity: 4 }, { productId: 'chk', quantity: 3, unit: 'l' }] }, ctx);
    const [jas, bas, chk] = offer.lines;
    expect(jas.alternatives).toBeUndefined(); // basmati can't cover 4 packs either
    expect(bas).toMatchObject({ productId: 'bas', status: 'partial', available: false, reason: 'only 2 of 4 packs available for 2026-12-06' });
    expect(chk).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('give the quantity in packs or kg') });
    expect(offer.totals).toMatchObject({ total: 0, orderableLines: 0, excludedLines: 3 });
  });

  it('rejects past dates and empty or non-positive lines', async () => {
    await expect(requestOffer({ deliveryDate: '2026-11-14', lines: [{ productId: 'bas', quantity: 1 }] }, ctx)).rejects.toThrow(/after today/);
    await expect(requestOffer({ deliveryDate: DATE, lines: [] }, ctx)).rejects.toThrow(/1 to 100 lines/);
    await expect(requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 0 }] }, ctx)).rejects.toThrow(/positive/);
  });
});

describe('evaluatePolicy', () => {
  const policy = POLICIES['helsinki-juhlapalvelu'];
  const offer = (over: Partial<Offer> = {}, line: Partial<Offer['lines'][number]> = {}): Offer => ({
    offerId: 'OF-1', customerId: 'helsinki-juhlapalvelu', agentId: 'bot-1', deliveryDate: DATE, createdAt: NOW.toISOString(),
    validUntil: NOW.toISOString(), status: 'open', pricing: '', request: { deliveryDate: DATE, lines: [] }, cutoff: '2026-12-04T10:00:00Z',
    totals: { currency: 'EUR', total: 500, totalWithTax: 567, vat: 67, orderableLines: 1, excludedLines: 0 },
    lines: [{
      lineId: 'L1', productId: 'bas', productName: 'Basmati', packDescription: '', requested: { quantity: 1, unit: 'packs' }, packs: 1, quantity: 5,
      unit: 'kg', unitPrice: 500, unitPriceWithTax: 567, priceBasis: 'per_pack', valioPrice: 500, lineTotal: 500, lineTotalWithTax: 567,
      status: 'available', available: true, availablePacks: null, availableDate: DATE, cutoff: '2026-12-04T10:00:00Z', ...line,
    }],
    ...over,
  });
  const rules = (o: Offer, prefs = {}) => evaluatePolicy(o, { policy, preferences: prefs, now: NOW }).reasons.map((r) => r.rule);

  it('auto-approves a clean order within the limit', () => {
    expect(evaluatePolicy(offer(), { policy, now: NOW })).toEqual({ decision: 'auto', reasons: [] });
  });

  it('routes each rule breach to a human', () => {
    expect(rules(offer({ totals: { ...offer().totals, total: 1000.01 } }))).toEqual(['total_over_limit']);
    expect(rules(offer({}, { allergen: { productId: 'bas', verdict: 'unknown', conflicts: [], unmetDiets: ['vegan'] } }))).toEqual(['allergen_unverified']);
    expect(rules(offer({}, { substituteFor: 'jas' }))).toEqual(['substitution_outside_preferences']);
    expect(rules(offer({}, { substituteFor: 'jas' }), { allowSubstitutes: true })).toEqual([]);
    expect(rules(offer(), { latestDeliveryDate: '2026-12-05' })).toEqual(['late_delivery']);
    expect(rules(offer({ cutoff: '2026-11-14T10:30:00Z' }))).toEqual(['cutoff_risk']);
    expect(rules(offer({}, { status: 'partial', available: false, reason: 'only 2 of 4 packs' }))).toEqual(['unavailable_lines']);
    expect(evaluatePolicy(offer(), { policy: { ...policy, allowedCategories: ['999'] }, now: NOW }).reasons.map((r) => r.rule)).toEqual(['category_not_allowed']);
  });

  it('is published as readable JSON with the approver', () => {
    expect(describePolicy('helsinki-juhlapalvelu')).toMatchObject({ autoApproveLimitEur: 1000, approver: { name: 'Anna Virtanen', role: 'Purchasing manager' }, negotiation: false });
  });
});

describe('customer defaults', () => {
  it("applies the customer's default requirements even when the agent states none", async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 1 }, { productId: 'gfb1', quantity: 1 }] }, ctx);
    expect(offer.requirements).toEqual({ excludeAllergens: ['peanut'] });
    expect(offer.lines.map((l) => l.allergen?.verdict)).toEqual(['pass', 'unknown']);
    const r = await placeOrder({ offerId: offer.offerId }, ctx);
    expect(r).toMatchObject({ status: 'pending_approval', reasons: [{ rule: 'allergen_unverified', lineIds: ['L2'] }] });
  });

  it('only accepts substitutes of the same kind', async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 1, substituteFor: 'jas' }, { productId: 'pizza', quantity: 1, substituteFor: 'jas' }] }, ctx);
    expect(offer.lines[0]).toMatchObject({ available: true, substituteFor: 'jas' });
    expect(offer.lines[1]).toMatchObject({ available: false, reason: expect.stringContaining('same kind') });
  });
});

describe('placeOrder', () => {
  it('returns not_orderable for an offer with nothing deliverable, without asking a human', async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'jas', quantity: 2 }] }, ctx);
    const r = await placeOrder({ offerId: offer.offerId }, ctx);
    expect(r).toMatchObject({ status: 'not_orderable', reasons: [expect.stringContaining('not deliverable')] });
    expect(listApprovals({}, db)).toHaveLength(0);
  });

  it('counts orders already placed or pending today for the same date against the limit (no splitting)', async () => {
    const first = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 60 }] }, ctx); // €804
    expect(await placeOrder({ offerId: first.offerId }, ctx)).toMatchObject({ status: 'ordered' });
    const second = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 20 }] }, ctx); // €268
    const r = await placeOrder({ offerId: second.offerId }, ctx);
    expect(r).toMatchObject({ status: 'pending_approval', reasons: [{ rule: 'total_over_limit', message: expect.stringContaining('€804.00 already ordered') }] });
    const otherDay = await requestOffer({ deliveryDate: '2026-12-07', lines: [{ productId: 'bas', quantity: 20 }] }, ctx);
    expect(await placeOrder({ offerId: otherDay.offerId }, ctx)).toMatchObject({ status: 'ordered' });
  });

  it('orders within authority with a simulated receipt and is idempotent', async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 3 }] }, ctx);
    const r = await placeOrder({ offerId: offer.offerId }, ctx);
    expect(r.status).toBe('ordered');
    if (r.status !== 'ordered') return;
    expect(r.receipt).toMatchObject({ simulated: true, customerId: 'helsinki-juhlapalvelu', total: 40.2, deliveryDate: DATE });
    expect(getReceipt(r.receipt.orderId, db)).toEqual(r.receipt);
    expect(listOrders('helsinki-juhlapalvelu', db)).toHaveLength(1);
    const again = await placeOrder({ offerId: offer.offerId }, ctx);
    expect(again).toMatchObject({ status: 'ordered', receipt: { orderId: r.receipt.orderId } });
    expect(listOrders('helsinki-juhlapalvelu', db)).toHaveLength(1);
    expect(listAudit({ conversationId: offer.offerId }, db).map((a) => `${a.actor} ${a.action}`))
      .toEqual(['agent:bot-1 requestOffer', 'gateway evaluatePolicy', 'agent:bot-1 submitOrder']);
    expect(getOrderStatus(r.receipt.orderId, ctx)).toMatchObject({ status: 'ordered', offer: { offerId: offer.offerId } });
  });

  it('re-quotes an expired offer instead of ordering', async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 3 }] }, ctx);
    advance(16);
    const r = await placeOrder({ offerId: offer.offerId }, ctx);
    expect(r.status).toBe('requote');
    if (r.status !== 'requote') return;
    expect(r.changes.map((c) => c.field)).toEqual(['expired']);
    expect(r.newOffer).toMatchObject({ replaces: offer.offerId, status: 'open' });
    expect(listOrders('helsinki-juhlapalvelu', db)).toHaveLength(0);
    expect(await placeOrder({ offerId: offer.offerId }, ctx)).toMatchObject({ status: 'requote', newOffer: { offerId: r.newOffer.offerId } });
    expect(await placeOrder({ offerId: r.newOffer.offerId }, ctx)).toMatchObject({ status: 'ordered' });
  });

  it('never orders at a changed price or availability', async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 3 }, { productId: 'chk', quantity: 2 }] }, ctx);
    priceOver = { bas: { price: 13.9 } };
    availOver = { chk: { availableAmount: 4 } };
    const r = await placeOrder({ offerId: offer.offerId }, ctx);
    expect(r.status).toBe('requote');
    if (r.status !== 'requote') return;
    expect(r.changes.map((c) => [c.lineId, c.field, c.from, c.to])).toEqual([['L1', 'price', 13.4, 13.9], ['L2', 'availability', 'available', 'partial']]);
    expect(r.newOffer.lines[0].unitPrice).toBe(13.9);
    expect(listOrders('helsinki-juhlapalvelu', db)).toHaveLength(0);
  });

  it('routes an order over the limit to the approver', async () => {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 80 }] }, ctx);
    const r = await placeOrder({ offerId: offer.offerId }, ctx);
    expect(r).toMatchObject({ status: 'pending_approval', approver: { name: 'Anna Virtanen', role: 'Purchasing manager' }, reasons: [{ rule: 'total_over_limit' }] });
    expect(listOrders('helsinki-juhlapalvelu', db)).toHaveLength(0);
    expect(listApprovals({ status: 'pending' }, db)).toHaveLength(1);
  });
});

describe('decideApproval', () => {
  async function pending() {
    const offer = await requestOffer({ deliveryDate: DATE, lines: [{ productId: 'bas', quantity: 80 }, { productId: 'jas', quantity: 2 }] }, ctx);
    const r = await placeOrder({ offerId: offer.offerId }, ctx);
    if (r.status !== 'pending_approval') throw new Error(`expected pending, got ${r.status}`);
    expect(r.reasons.map((x) => x.rule)).toEqual(['total_over_limit', 'unavailable_lines']);
    return { offer, approvalId: r.approvalId };
  }

  it('orders the deliverable lines after approval, even after the 15 min hold, and audits every step', async () => {
    const { offer, approvalId } = await pending();
    advance(45);
    const d = await decideApproval(approvalId, { decision: 'approve', approverName: 'Anna Virtanen', note: 'ok for the gala' }, db);
    expect(d.status).toBe('ordered');
    if (d.status !== 'ordered') return;
    expect(d.receipt.lines.map((l) => l.productId)).toEqual(['bas']);
    expect(d.receipt.total).toBe(1072);
    expect(getOrderStatus(approvalId, ctx)).toMatchObject({ status: 'ordered', receipt: { orderId: d.receipt.orderId }, approval: { status: 'approved', decidedBy: 'Anna Virtanen' } });
    expect(listAudit({ conversationId: offer.offerId }, db).map((a) => `${a.actor} ${a.action}`)).toEqual([
      'agent:bot-1 requestOffer', 'gateway evaluatePolicy', 'agent:bot-1 requestApproval', 'approver:Anna Virtanen approve', 'approver:Anna Virtanen submitOrder',
    ]);
    await expect(decideApproval(approvalId, { decision: 'approve', approverName: 'Anna Virtanen' }, db)).rejects.toThrow(/already approved/);
  });

  it('re-quotes instead of ordering when the price changed while waiting', async () => {
    const { approvalId } = await pending();
    priceOver = { bas: { price: 14 } };
    const d = await decideApproval(approvalId, { decision: 'approve', approverName: 'Anna Virtanen' }, db);
    expect(d).toMatchObject({ status: 'requote', approval: { status: 'requoted' }, changes: [{ field: 'price', from: 13.4, to: 14 }] });
    expect(listOrders('helsinki-juhlapalvelu', db)).toHaveLength(0);
    expect(getOrderStatus(approvalId, ctx)).toMatchObject({ status: 'requote' });
  });

  it('rejects and tells the agent', async () => {
    const { offer, approvalId } = await pending();
    const d = await decideApproval(approvalId, { decision: 'reject', approverName: 'Anna Virtanen', note: 'too much' }, db);
    expect(d.status).toBe('rejected');
    expect(await placeOrder({ offerId: offer.offerId }, ctx)).toMatchObject({ status: 'rejected' });
    expect(getOrderStatus(approvalId, ctx)).toMatchObject({ status: 'rejected', approval: { note: 'too much' } });
  });
});
