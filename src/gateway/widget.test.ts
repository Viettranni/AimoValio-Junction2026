import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityInfo, PriceInfo, Receipt } from '@/contracts';

vi.hoisted(() => { process.env.AIMO_DB_PATH = ':memory:'; });
vi.mock('@/catalog/load', async () => {
  const { products } = await import('@/mastra/fixtures.test-util');
  return { loadCatalog: () => products };
});
const valio = vi.hoisted(() => ({ priceOver: {} as Record<string, Partial<PriceInfo>>, availOver: {} as Record<string, Partial<AvailabilityInfo>> }));
vi.mock('@/valio/client', async () => {
  const f = await import('@/mastra/fixtures.test-util');
  return {
    getPrices: vi.fn(async (ids: string[]) => new Map([...f.fakePrices(ids)].map(([id, p]) => [id, { ...p, fetchedAt: new Date().toISOString(), ...valio.priceOver[id] }]))),
    getAvailability: vi.fn(async (ids: string[]) => new Map([...f.fakeAvailability(ids)].map(([id, a]) => [id, { ...a, ...valio.availOver[id] }]))),
    ValioUnavailableError: class extends Error {},
  };
});
vi.mock('@/mcp/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/mcp/client')>();
  const { checkAllergens } = await import('@/catalog');
  return { ...actual, getProductTools: vi.fn(async () => ({})), checkAllergensViaMcp: vi.fn(async (ids: string[], c: object) => checkAllergens(ids, c)) };
});

import { getDraftById, getReceipt, listAudit, now, saveDraft, setClockOffsetDays, storeOrder } from '@/db/repo';
import type { MenuComponentPlan } from '@/mastra/agents/menu';
import type { PickProductsInput } from '@/mastra/agents/product';
import type { Specialists } from '@/mastra/specialists';
import { submitCheckIn } from '@/server/checkin';
import { fastForward, nextDeliveryStep } from '@/server/demo';
import { agentKeys, resolveAgent, WIDGET_AGENT } from './agents';
import { decideApproval } from './approvals';
import { getDeliveryStatus } from './deliveries';
import { shortfall } from './delivery';
import { getDraft, getOrder, listAgentOrders, planEvent, quoteDraft, updateDraft } from './drafts';
import { getOrderStatus, placeOrder } from './orders';
import { getOffer } from './store';
import type { AgentIdentity, GatewayContext } from './types';
import { widgetContext, widgetOffer, widgetOrderStatus, widgetPlaceOrder } from './widget';

const external: GatewayContext = { agent: { agentId: 'bot-1', customerId: 'helsinki-juhlapalvelu', displayName: 'Test bot' } };
const widget = widgetContext();

const plan = (o: Partial<MenuComponentPlan> & Pick<MenuComponentPlan, 'id' | 'category'>, guests: number): MenuComponentPlan => ({
  label: o.id, searchTerms: { fi: '', en: '' }, origin: 'requested', guests, dietVariantOf: null, requiredDiet: null, excludeAllergens: null, ...o,
});
const PICKS: Record<string, string> = { 'c-chicken': 'chk', 'c-rice': 'bas' };
const specialists: Specialists = {
  extractIntake: vi.fn(),
  planMenu: vi.fn(async ({ intake }) => [
    plan({ id: 'c-chicken', label: 'Chicken', category: 'poultry_main', searchTerms: { fi: 'broileri rintafilee', en: 'chicken' } }, intake.guests ?? 0),
    plan({ id: 'c-rice', label: 'Rice', category: 'grain_side', searchTerms: { fi: 'riisi', en: 'rice' } }, intake.guests ?? 0),
  ]),
  pickProducts: vi.fn(async ({ components, candidates }: PickProductsInput) => components.map((c) => ({
    componentId: c.id, productId: PICKS[c.id] ?? candidates.get(c.id)![0].id,
    alternatives: candidates.get(c.id)!.map((p) => p.id).filter((id) => id !== PICKS[c.id]).slice(0, 2), reason: 'test pick',
  }))),
  chooseUnknownFallback: vi.fn(async () => ({ productId: 'gfb2', note: '' })),
  interpretEdit: vi.fn(),
  parseCheckIn: vi.fn(),
};

let n = 0;
/** A planned draft that lives in a widget chat conversation (no `mcp:` prefix), as the chat pipeline makes them. */
async function widgetDraft(guests: number, date: string, diets?: Array<{ diet: 'vegan'; guests: number }>) {
  const d = await planEvent({ deliveryDate: date, guests, menu: ['chicken', 'rice'], eventType: 'wedding', eventName: 'Wedding', ...(diets ? { diets } : {}) }, external, { specialists });
  const conversationId = `widget-conv-${++n}`;
  saveDraft({ ...getDraftById(d.draftId)!, conversationId });
  return { draftId: d.draftId, conversationId, lineIds: d.lines.map((l) => l.lineId) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
  setClockOffsetDays(0);
  valio.priceOver = {};
  valio.availOver = {};
});
afterEach(() => vi.useRealTimers());

describe('widget identity', () => {
  it('is a server-side human-in-the-loop agent; no API key can claim that', () => {
    expect(WIDGET_AGENT).toMatchObject({ agentId: 'aimo-widget', customerId: 'helsinki-juhlapalvelu', humanInTheLoop: true });
    const env = { AIMO_AGENT_KEYS: JSON.stringify({ 'sneaky-key-123': { agentId: 'x', customerId: 'helsinki-juhlapalvelu', displayName: 'X', humanInTheLoop: true } }) };
    expect(resolveAgent('sneaky-key-123', env)).not.toHaveProperty('humanInTheLoop');
    expect(Object.values(agentKeys({})).some((a: AgentIdentity) => a.humanInTheLoop)).toBe(false);
  });

  it('owns widget conversations only; external agents never see them, and the widget never sees MCP drafts', async () => {
    const w = await widgetDraft(20, '2026-12-12');
    expect(() => getDraft(w.draftId, external)).toThrow(/No draft/);
    const mcp = await planEvent({ deliveryDate: '2026-12-12', guests: 20, menu: ['chicken'], eventName: 'X' }, external, { specialists });
    expect(() => getDraft(mcp.draftId, widget)).toThrow(/No draft/);
    expect(getDraft(w.draftId, widget).draftId).toBe(w.draftId);
  });
});

describe('Review = an offer (quoteDraft)', () => {
  it('quotes the draft at fixed prices without placing it, and reuses the open offer on reopen', async () => {
    const w = await widgetDraft(20, '2026-12-13');
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    expect(r.offer).toMatchObject({ status: 'open', agentId: 'aimo-widget', draftId: w.draftId, totals: { total: 50.8 } });
    expect(Date.parse(r.offer.validUntil) - Date.parse(r.offer.createdAt)).toBe(15 * 60_000);
    expect(r.changes).toEqual([]);
    expect(r.limitEur).toBe(1000);
    expect(getDraftById(w.draftId)?.status).toBe('ready');
    // Reopening Review shows the same offer while it holds…
    const again = await widgetOffer(w.conversationId);
    expect(again.status === 'offer' && again.offer.offerId).toBe(r.offer.offerId);
    // …but a changed draft or an expired offer gets a fresh quote.
    vi.setSystemTime(new Date('2026-11-14T10:16:00Z'));
    const later = await widgetOffer(w.conversationId);
    expect(later.status === 'offer' && later.offer.offerId).not.toBe(r.offer.offerId);
  });

  it('lists price changes since the draft and re-prices the draft to the offer', async () => {
    const w = await widgetDraft(20, '2026-12-14');
    valio.priceOver = { bas: { price: 14, priceWithTax: 15.89 } };
    const q = await quoteDraft({ draftId: w.draftId }, widget);
    expect(q.changes).toEqual([expect.objectContaining({ productId: 'bas', field: 'price', from: 13.4, to: 14 })]);
    expect(q.offer.status).toBe('open');
    expect(q.draft.lines.find((l) => l.productId === 'bas')?.unitPrice).toBe(14);
    expect(getDraftById(w.draftId)?.lines.find((l) => l.productId === 'bas')?.unitPrice).toBe(14);
  });
});

describe('Approve = placeOrder through the gateway', () => {
  it('orders within authority with the same policy, audited as the widget agent', async () => {
    const w = await widgetDraft(20, '2026-12-15');
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    const placed = await widgetPlaceOrder({ conversationId: w.conversationId, offerId: r.offer.offerId });
    expect(placed).toMatchObject({ status: 'ordered', receipt: { total: 50.8 } });
    expect(getDraftById(w.draftId)?.status).toBe('submitted');
    expect(listAudit({ conversationId: r.offer.offerId }).map((a) => `${a.actor} ${a.action}`)).toEqual(expect.arrayContaining([
      'gateway evaluatePolicy', 'agent:aimo-widget submitOrder',
    ]));
    // Opening Review again shows the order.
    expect(await widgetOffer(w.conversationId)).toMatchObject({ status: 'ordered' });
  });

  it("keeps the buyer's event name on the receipt; the order still resolves to its offer by order id", async () => {
    const w = await widgetDraft(20, '2026-12-16');
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    const placed = await widgetPlaceOrder({ conversationId: w.conversationId, offerId: r.offer.offerId });
    if (placed.status !== 'ordered') throw new Error(placed.status);
    expect(placed.receipt.eventName).toBe('Wedding');
    expect(getOrderStatus(placed.receipt.orderId, widget)).toMatchObject({ status: 'ordered', offer: { offerId: r.offer.offerId } });
  });

  it("counts the buyer's allergen ticks as the sign-off for the widget only; an external agent's are ignored", async () => {
    const w = await widgetDraft(20, '2026-12-16', [{ diet: 'vegan', guests: 2 }]);
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    expect(r.offer.lines.every((l) => l.allergen?.verdict === 'unknown')).toBe(true);

    // External agent, same offer type, same confirmations → still a human sign-off.
    const ext = await planEvent({ deliveryDate: '2026-12-17', guests: 20, menu: ['chicken', 'rice'], diets: [{ diet: 'vegan', guests: 2 }], eventName: 'E' }, external, { specialists });
    const extQuote = await quoteDraft({ draftId: ext.draftId }, external);
    const extResult = await placeOrder({ offerId: extQuote.offer.offerId, preferences: { allowSubstitutes: true }, humanConfirmations: { allergenLineIds: extQuote.offer.lines.map((l) => l.lineId) } }, external);
    expect(extResult).toMatchObject({ status: 'pending_approval', reasons: [expect.objectContaining({ rule: 'allergen_unverified' })] });

    // Widget, ticks on only one of two lines → the other still needs Anna.
    const partial = await widgetPlaceOrder({ conversationId: w.conversationId, offerId: r.offer.offerId, allergenLineIds: [w.lineIds[0]] });
    expect(partial).toMatchObject({ status: 'pending_approval', reasons: [{ rule: 'allergen_unverified', lineIds: [w.lineIds[1]] }] });
    await decideApproval((partial as { approvalId: string }).approvalId, { decision: 'reject', approverName: 'Anna Virtanen' });

    // Widget, every line ticked → ordered, with the confirmation in the audit trail.
    const fresh = await widgetOffer(w.conversationId);
    if (fresh.status !== 'offer') throw new Error(fresh.status);
    const ok = await widgetPlaceOrder({ conversationId: w.conversationId, offerId: fresh.offer.offerId, allergenLineIds: w.lineIds });
    expect(ok.status).toBe('ordered');
    expect(listAudit({ conversationId: fresh.offer.offerId }).find((a) => a.action === 'confirmAllergens')).toMatchObject({ actor: 'buyer' });
  });

  it('still applies the spend limit to the widget: over €1,000 → Anna, poll, approve → receipt', async () => {
    const w = await widgetDraft(1000, '2026-12-18', [{ diet: 'vegan', guests: 2 }]);
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    const placed = await widgetPlaceOrder({ conversationId: w.conversationId, offerId: r.offer.offerId, allergenLineIds: w.lineIds });
    expect(placed).toMatchObject({ status: 'pending_approval', approver: { name: 'Anna Virtanen', role: 'Purchasing manager' }, reasons: [{ rule: 'total_over_limit' }], limitEur: 1000 });
    if (placed.status !== 'pending_approval') return;
    expect(widgetOrderStatus(placed.approvalId)).toMatchObject({ status: 'pending_approval', approver: { name: 'Anna Virtanen' } });
    // Reopening Review while it waits shows the pending card, not a new offer.
    expect(await widgetOffer(w.conversationId)).toMatchObject({ status: 'pending_approval', approvalId: placed.approvalId });
    await expect(updateDraft(w.draftId, [{ kind: 'setPacks', lineId: w.lineIds[0], packs: 1 }], widget)).rejects.toThrow(/waiting for approval/);

    const decided = await decideApproval(placed.approvalId, { decision: 'approve', approverName: 'Anna Virtanen' });
    expect(decided.status).toBe('ordered');
    const after = widgetOrderStatus(placed.approvalId);
    expect(after).toMatchObject({ status: 'ordered', receipt: { orderId: (decided as { receipt: { orderId: string } }).receipt.orderId } });
  });

  it('reports a rejection, and the draft can be reviewed again', async () => {
    const w = await widgetDraft(1000, '2026-12-19');
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    const placed = await widgetPlaceOrder({ conversationId: w.conversationId, offerId: r.offer.offerId });
    if (placed.status !== 'pending_approval') throw new Error(placed.status);
    await decideApproval(placed.approvalId, { decision: 'reject', approverName: 'Anna Virtanen', note: 'Too much' });
    expect(widgetOrderStatus(placed.approvalId)).toEqual({ status: 'rejected', note: 'Too much', decidedBy: 'Anna Virtanen' });
    expect((await widgetOffer(w.conversationId)).status).toBe('offer');
  });

  it('returns a requote with the changes when the price moved after Review opened; nothing is ordered', async () => {
    const w = await widgetDraft(20, '2026-12-20');
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    valio.priceOver = { bas: { price: 14, priceWithTax: 15.89 } };
    const placed = await widgetPlaceOrder({ conversationId: w.conversationId, offerId: r.offer.offerId });
    expect(placed).toMatchObject({ status: 'requote', changes: [{ field: 'price', productId: 'bas', from: 13.4, to: 14 }] });
    if (placed.status !== 'requote') return;
    expect(placed.newOffer).toMatchObject({ status: 'open', draftId: w.draftId, replaces: r.offer.offerId });
    expect(getDraftById(w.draftId)?.status).toBe('ready');
    expect(await widgetPlaceOrder({ conversationId: w.conversationId, offerId: placed.newOffer.offerId })).toMatchObject({ status: 'ordered', receipt: { total: 51.4 } });
  });

  it('orders once for a double click', async () => {
    const w = await widgetDraft(20, '2026-12-21');
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    const [a, b] = await Promise.all([1, 2].map(() => widgetPlaceOrder({ conversationId: w.conversationId, offerId: r.offer.offerId })));
    expect(a.status).toBe('ordered');
    expect(b.status).toBe('ordered');
    expect((a as { receipt: { orderId: string } }).receipt.orderId).toBe((b as { receipt: { orderId: string } }).receipt.orderId);
    expect(getOffer(r.offer.offerId)?.status).toBe('ordered');
  });

  it("refuses another draft's offer", async () => {
    const a = await widgetDraft(20, '2026-12-22');
    const b = await widgetDraft(20, '2026-12-22');
    const offerA = await widgetOffer(a.conversationId);
    if (offerA.status !== 'offer') throw new Error(offerA.status);
    await expect(widgetPlaceOrder({ conversationId: b.conversationId, offerId: offerA.offer.offerId })).rejects.toThrow(/No offer/);
  });
});

describe('simulated delivery over the gateway', () => {
  it('serves the delivery state in getOrder/listOrders/getDeliveryStatus, records delivery once and prefills shorts', async () => {
    const w = await widgetDraft(100, '2026-12-23');
    const r = await widgetOffer(w.conversationId);
    if (r.status !== 'offer') throw new Error(r.status);
    const placed = await widgetPlaceOrder({ conversationId: w.conversationId, offerId: r.offer.offerId });
    if (placed.status !== 'ordered') throw new Error(placed.status);
    const orderId = placed.receipt.orderId;
    expect(placed.receipt.cutoff).toBe(r.offer.cutoff);
    expect(placed.receipt.cutoff).toMatch(/^2026-12-2/);
    expect(placed.receipt.lines.every((l) => l.logisticModel === 'Stock')).toBe(true);

    expect(getDeliveryStatus(orderId, widget).state).toBe('received');
    expect(getOrder(orderId, external).delivery.state).toBe('received');
    expect(listAgentOrders(external).orders.find((o) => o.orderId === orderId)?.delivery).toMatchObject({ state: 'received', shortLines: 0 });
    expect(() => getDeliveryStatus(orderId, { agent: { agentId: 'x', customerId: 'other', displayName: 'X' } })).toThrow(/No order/);

    // "Next delivery step" walks the demo clock through every main state.
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(nextDeliveryStep(w.conversationId).delivery.state);
    expect(seen).toEqual(['confirmed', 'picking', 'out_for_delivery', 'delivered']);
    expect(now().getTime()).toBeGreaterThanOrEqual(Date.parse('2026-12-23T05:00:00Z'));

    const delivered = getDeliveryStatus(orderId, widget);
    expect(delivered.lines.every((l) => l.deliveredQty === l.orderedQty)).toBe(true); // reliability 0.97: never short
    getDeliveryStatus(orderId, widget);
    expect(listAudit({ orderId }).filter((a) => a.action === 'delivered')).toHaveLength(1);
    expect(listAudit({ orderId }).find((a) => a.action === 'delivered')?.actor).toBe('carrier');
    expect(getReceipt(orderId)).toBeTruthy();
    expect(fastForward(w.conversationId).lines.every((l) => l.leftoverQty === undefined)).toBe(true);
  });

  it('prefills a short delivery as a shortfall in the check-in, so history learns from it', () => {
    // chk2 is a Terminal (supplier) product with reliability 0.85: pick an order id where it arrives short.
    const base = { lineId: 'l-1', productId: 'chk2', productName: 'Chicken thigh fillet 2kg', packs: 10, quantity: 20, unit: 'kg' as const };
    const orderId = Array.from({ length: 500 }, (_, i) => `VA-2026-9${String(i).padStart(4, '0')}`).find((id) => shortfall(id, { ...base, reliability: 0.85 }))!;
    const { deliveredPacks } = shortfall(orderId, { ...base, reliability: 0.85 })!;
    const receipt: Receipt = {
      orderId, simulated: true, customerId: 'helsinki-juhlapalvelu', eventName: 'Gala', eventType: 'party', deliveryDate: '2026-12-28', guests: 50,
      lines: [
        { ...base, unitPrice: 10, unitPriceWithTax: 11, lineTotal: 100, lineTotalWithTax: 110, logisticModel: 'Terminal' },
        { lineId: 'l-2', productId: 'bas', productName: 'Basmati rice 5kg', packs: 2, quantity: 10, unit: 'kg', unitPrice: 13.4, unitPriceWithTax: 15.2, lineTotal: 26.8, lineTotalWithTax: 30.4, logisticModel: 'Stock' },
      ],
      total: 126.8, totalWithTax: 140.4, vat: 13.6, co2Kg: null, minutesSaved: 11, submittedAt: '2026-11-14T10:00:05.000Z', cutoff: '2026-12-26T10:00:00Z',
    };
    storeOrder(receipt, new Map([['l-1', 'poultry_main'], ['l-2', 'grain_side']]));
    const before = getDeliveryStatus(orderId, widget);
    expect(before.supplier).toMatchObject({ lineIds: ['l-1'], state: 'waiting' });
    expect(before.lines[0]).toMatchObject({ logisticModel: 'Terminal', short: false, deliveredQty: null });

    const ev = fastForward('no-such-conversation');
    expect(ev.orderId).toBe(orderId);
    const missing = (10 - deliveredPacks) * 2;
    expect(ev.lines[0]).toMatchObject({ leftoverQty: -missing, deliveredShort: { qty: missing, reason: 'supplier delivered short' } });
    expect(ev.lines[1]).toMatchObject({ leftoverQty: 0 });
    expect(getDeliveryStatus(orderId, widget).lines[0]).toMatchObject({ short: true, reason: 'supplier delivered short', deliveredQty: deliveredPacks * 2 });
    expect(listAudit({ orderId }).find((a) => a.action === 'deliveredShort')).toMatchObject({ actor: 'gateway' });

    submitCheckIn(orderId, ev.lines.map((l) => ({ lineId: l.lineId, leftoverQty: l.leftoverQty ?? 0 })));
    expect(getOrder(orderId, widget).leftovers.find((l) => l.lineId === 'l-1')?.leftoverQty).toBe(-missing);
  });
});
