import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityInfo, PriceInfo } from '@/contracts';

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

import { getDraftById, setClockOffsetDays } from '@/db/repo';
import type { MenuComponentPlan } from '@/mastra/agents/menu';
import type { PickProductsInput } from '@/mastra/agents/product';
import { DATE } from '@/mastra/fixtures.test-util';
import type { Specialists } from '@/mastra/specialists';
import { decideApproval } from './approvals';
import { checkoutDraft, getDraft, getOrder, listAgentOrders, planEvent, reportLeftovers, updateDraft } from './drafts';
import type { AgentIdentity, GatewayContext } from './types';

const agent: AgentIdentity = { agentId: 'bot-1', customerId: 'helsinki-juhlapalvelu', displayName: 'Test bot' };
const ctx: GatewayContext = { agent };
const other: GatewayContext = { agent: { agentId: 'bot-2', customerId: 'other-customer', displayName: 'Other bot' } };

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

const event = (guests: number, date = DATE) => planEvent(
  { deliveryDate: date, guests, menu: ['chicken', 'rice'], eventType: 'wedding', eventName: 'Wedding' }, ctx, { specialists },
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
  setClockOffsetDays(0);
  valio.priceOver = {};
  valio.availOver = {};
});
afterEach(() => vi.useRealTimers());

describe('event flow over the gateway', () => {
  it('plans, edits and checks out within authority; the draft is then submitted', async () => {
    const d = await event(20);
    expect(d.lines.map((l) => [l.productId, l.packs, l.unitPrice])).toEqual([['chk', 1, 37.4], ['bas', 1, 13.4]]);
    const chicken = d.lines[0].lineId;

    const u = await updateDraft(d.draftId, [{ kind: 'setPacks', lineId: chicken, packs: 2 }], ctx);
    expect(u.lines[0]).toMatchObject({ packs: 2, lineTotal: 74.8 });
    expect(u.diff.changedLineIds).toEqual([chicken]);
    await expect(updateDraft(d.draftId, [{ kind: 'swapProduct', lineId: chicken, productId: 'pizza' }], ctx)).rejects.toThrow(/not the same kind/);

    const r = await checkoutDraft({ draftId: d.draftId }, ctx);
    expect(r).toMatchObject({ status: 'ordered', draftId: d.draftId });
    if (r.status !== 'ordered') return;
    expect(r.receipt).toMatchObject({ total: 88.2, guests: 20, eventType: 'wedding', lines: [{ lineId: chicken, packs: 2 }, { packs: 1 }] });
    expect(getDraftById(d.draftId)?.status).toBe('submitted');
    await expect(checkoutDraft({ draftId: d.draftId }, ctx)).rejects.toThrow(/already ordered/);
    expect(listAgentOrders(ctx).orders.map((o) => o.orderId)).toContain(r.receipt.orderId);
  });

  it('routes a large event to the approver, and the approval orders it', async () => {
    const d = await event(1000);
    const r = await checkoutDraft({ draftId: d.draftId }, ctx);
    expect(r).toMatchObject({ status: 'pending_approval', approver: { name: 'Anna Virtanen' }, reasons: [{ rule: 'total_over_limit' }] });
    if (r.status !== 'pending_approval') return;
    expect(listAgentOrders(ctx).pendingApprovals.map((p) => p.approvalId)).toContain(r.approvalId);
    expect(await checkoutDraft({ draftId: d.draftId }, ctx)).toMatchObject({ status: 'pending_approval', approvalId: r.approvalId });

    const decided = await decideApproval(r.approvalId, { decision: 'approve', approverName: 'Anna Virtanen' });
    expect(decided.status).toBe('ordered');
    expect(getDraftById(d.draftId)?.status).toBe('submitted');
  });

  it('never checks out at a price that moved since the draft: requote, draft re-priced, then ordered', async () => {
    // Own delivery dates per test: the split-order guard sums today's orders per delivery date.
    const d = await event(20, '2026-12-07');
    valio.priceOver = { bas: { price: 14, priceWithTax: 15.89 } };
    const r = await checkoutDraft({ draftId: d.draftId }, ctx);
    expect(r).toMatchObject({ status: 'requote', changes: [{ productId: 'bas', field: 'price', from: 13.4, to: 14 }] });
    expect(getDraft(d.draftId, ctx).lines[1].unitPrice).toBe(14);
    expect(await checkoutDraft({ draftId: d.draftId }, ctx)).toMatchObject({ status: 'ordered', receipt: { total: 51.4 } });
  });

  it("keeps drafts and orders to the agent's own customer", async () => {
    const d = await event(20, '2026-12-08');
    expect(() => getDraft(d.draftId, other)).toThrow(/No draft/);
    await expect(updateDraft(d.draftId, [{ kind: 'removeLine', lineId: d.lines[0].lineId }], other)).rejects.toThrow(/No draft/);
    await expect(checkoutDraft({ draftId: d.draftId }, other)).rejects.toThrow(/No draft/);
    const r = await checkoutDraft({ draftId: d.draftId }, ctx);
    if (r.status !== 'ordered') throw new Error(r.status);
    expect(() => getOrder(r.receipt.orderId, other)).toThrow(/No order/);
    expect(listAgentOrders(other).orders).toEqual([]);
  });

  it('records leftovers after the event, and the next plan carries a history note', async () => {
    const d = await event(100, '2026-12-09');
    const r = await checkoutDraft({ draftId: d.draftId }, ctx);
    if (r.status !== 'ordered') throw new Error(r.status);
    const chicken = r.receipt.lines.find((l) => l.productId === 'chk')!;
    expect(() => reportLeftovers({ orderId: r.receipt.orderId, entries: [{ lineId: chicken.lineId, leftoverQty: 6 }] }, ctx)).toThrow(/after the event/);

    setClockOffsetDays(26); // the day after the 9 Dec event
    const o = reportLeftovers({ orderId: r.receipt.orderId, entries: [{ lineId: chicken.lineId, leftoverQty: chicken.quantity * 0.3 }] }, ctx);
    expect(o.checkInDone).toBe(true);
    expect(o.leftovers.find((l) => l.lineId === chicken.lineId)?.leftoverQty).toBeCloseTo(chicken.quantity * 0.3);

    const next = await event(100, '2026-12-20');
    const line = next.lines.find((l) => l.productId === 'chk')!;
    expect(line.history).toMatchObject({ choice: 'pending', basis: 'same_product' });
    expect(line.history!.historyPacks).toBeLessThan(line.history!.suggestedPacks);
    const accepted = await updateDraft(next.draftId, [{ kind: 'historyChoice', lineId: line.lineId, choice: 'history' }], ctx);
    expect(accepted.lines.find((l) => l.lineId === line.lineId)?.packs).toBe(line.history!.historyPacks);
  });
});
