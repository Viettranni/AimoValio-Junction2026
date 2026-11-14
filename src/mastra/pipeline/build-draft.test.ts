import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AimoDataPart, Draft, MenuComponent, Receipt } from '@/contracts';

vi.hoisted(() => { process.env.AIMO_DB_PATH = ':memory:'; });
vi.mock('@/catalog/load', async () => {
  const { products } = await import('../fixtures.test-util');
  return { loadCatalog: () => products };
});
vi.mock('@/valio/client', async () => {
  const f = await import('../fixtures.test-util');
  return {
    getPrices: vi.fn(async (ids: string[]) => f.fakePrices(ids)),
    getAvailability: vi.fn(async (ids: string[]) => f.fakeAvailability(ids)),
    ValioUnavailableError: class extends Error {},
  };
});

import { computeTotals } from '@/domain/totals';
import { getDraftByConversation, listAudit, recordLeftovers, saveDraft, storeOrder } from '@/db/repo';
import type { MenuComponentPlan } from '../agents/menu';
import type { EditIntent } from '../agents/order';
import type { PickProductsInput } from '../agents/product';
import { DATE, products } from '../fixtures.test-util';
import type { Specialists } from '../specialists';
import { getAvailability, getPrices } from '@/valio/client';
import { runEditDraft } from '../tools/edit-draft';
import { runPlanOrder } from '../tools/plan-order';
import { runUnderstandRequest } from '../tools/understand-request';
import { applyDietRules, buildDraft, byGranularity } from './build-draft';

const ctx = { conversationId: 'conv-plan', customerId: 'helsinki-juhlapalvelu' };

const component = (o: Partial<MenuComponentPlan> & Pick<MenuComponentPlan, 'id' | 'category'>): MenuComponentPlan => ({
  label: o.id, searchTerms: { fi: '', en: '' }, origin: 'requested', guests: 100,
  dietVariantOf: null, requiredDiet: null, excludeAllergens: null, ...o,
});

const menu: MenuComponentPlan[] = [
  component({ id: 'c-chicken', label: 'Kana', category: 'poultry_main', searchTerms: { fi: 'broileri rintafilee', en: 'chicken' } }),
  component({ id: 'c-rice', label: 'Riisi', category: 'grain_side', searchTerms: { fi: 'riisi', en: 'rice' } }),
  component({ id: 'c-bread', label: 'Leipä', category: 'bread', guests: 90, origin: 'addon', searchTerms: { fi: 'leipä', en: 'bread' } }),
  component({
    id: 'c-bread-gf', label: 'Gluteeniton leipä', category: 'bread', guests: 10, origin: 'addon', dietVariantOf: 'c-bread',
    requiredDiet: ['gluten_free'], excludeAllergens: ['gluten'], searchTerms: { fi: 'leipä', en: 'bread' },
  }),
];

const PICKS: Record<string, string> = { 'c-chicken': 'chk', 'c-rice': 'jas', 'c-bread': 'bread', 'c-bread-gf': 'gfb1' };

const specialists: Specialists = {
  extractIntake: vi.fn(),
  planMenu: vi.fn(async () => menu),
  pickProducts: vi.fn(async ({ components, candidates }: PickProductsInput) => components.map((c) => ({
    componentId: c.id,
    productId: PICKS[c.id] ?? candidates.get(c.id)![0].id,
    alternatives: candidates.get(c.id)!.map((p) => p.id).filter((id) => id !== PICKS[c.id]).slice(0, 2),
    reason: 'test pick',
  }))),
  chooseUnknownFallback: vi.fn(async () => ({ productId: 'gfb2', note: 'Name says gluten free' })),
  interpretEdit: vi.fn(),
  parseCheckIn: vi.fn(),
};

const intent = (o: Partial<EditIntent> & Pick<EditIntent, 'kind'>): EditIntent => ({
  lineId: null, packs: null, guests: null, choice: null, searchFi: null, searchEn: null, category: null, label: null, reason: null, ...o,
});

function seedHistory() {
  const receipt: Receipt = {
    orderId: 'VA-2026-00001', simulated: true, customerId: ctx.customerId, eventName: 'Häät', eventType: 'wedding',
    deliveryDate: '2026-06-01', guests: 100,
    lines: [
      { lineId: 'l-1', productId: 'chk', productName: 'Chicken', packs: 5, quantity: 22, unit: 'kg', unitPrice: 37.4, unitPriceWithTax: 42.46, lineTotal: 187, lineTotalWithTax: 212.3 },
      { lineId: 'l-2', productId: 'bas', productName: 'Basmati', packs: 2, quantity: 10, unit: 'kg', unitPrice: 13.4, unitPriceWithTax: 15.21, lineTotal: 26.8, lineTotalWithTax: 30.42 },
    ],
    total: 187, totalWithTax: 212.3, vat: 25.3, co2Kg: null, minutesSaved: 20, submittedAt: '2026-05-20T09:00:00Z',
  };
  storeOrder(receipt, new Map([['l-1', 'poultry_main'], ['l-2', 'grain_side']]));
  // Chicken: 30% left over. Basmati: 1% left over, too little to change any pack count.
  recordLeftovers(receipt.orderId, [{ lineId: 'l-1', leftoverQty: 6.6 }, { lineId: 'l-2', leftoverQty: 0.1 }]);
}

const startDraft: Draft = {
  id: 'draft-1', conversationId: ctx.conversationId, customerId: ctx.customerId,
  intake: { deliveryDate: DATE, guests: 100, menu: ['chicken', 'rice'], budget: 2000, diets: [{ diet: 'gluten_free', guests: 10 }], eventType: 'wedding', eventName: 'Häät', lang: 'fi' },
  components: [], lines: [], totals: computeTotals([], 2000), cutoff: null, status: 'building', updatedAt: '2026-11-14T10:00:00Z',
};

describe('buildDraft', () => {
  const parts: AimoDataPart[] = [];
  let draft: Draft;
  const calls: Record<string, number> = {};

  beforeAll(async () => {
    seedHistory();
    saveDraft(startDraft);
    ({ draft } = await buildDraft(
      { draft: startDraft, addons: ['Bread'], ctx },
      { specialists, emit: async (p) => { parts.push(p); } },
    ));
    for (const [name, fn] of Object.entries(specialists)) calls[name] = vi.mocked(fn).mock.calls.length;
  });

  const line = (componentId: string) => draft.lines.find((l) => l.componentId === componentId)!;

  it('makes one LLM pick call for all components', () => {
    expect(calls).toMatchObject({ planMenu: 1, pickProducts: 1 });
  });

  it('prices lines per pack, KG products by piece weight, names in the buyer language', () => {
    const chicken = line('c-chicken');
    expect(chicken.productId).toBe('chk');
    expect(chicken.productName).toBe('Broileri rintafilee n4,4kg');
    expect(chicken.packs).toBe(5); // 100 × 0.20 kg = 20 kg → 5 × 4.4 kg
    expect(chicken.unitPrice).toBe(37.4);
    expect(chicken.unitPriceWithTax).toBe(42.46);
    expect(chicken.tags).toContain('in_stock');
  });

  it('substitutes an undeliverable product with the first deliverable alternative', () => {
    const rice = line('c-rice');
    expect(rice.productId).toBe('bas');
    expect(rice.tags).toContain('substitute');
    expect(rice.substituteFor).toEqual({ productId: 'jas', productName: 'Jasmiiniriisi 5kg', reason: `Not deliverable on ${DATE}` });
    expect(rice.unitPrice).toBe(13.4);
    expect(listAudit({ conversationId: ctx.conversationId }).some((a) => a.actor === 'pricing' && a.action === 'substitute')).toBe(true);
  });

  it('never uses a failing product for a diet variant and tags unknown allergens, asking the allergen agent among several', () => {
    const gf = line('c-bread-gf');
    expect(gf.productId).toBe('gfb2');
    expect(gf.allergen.verdict).toBe('unknown');
    expect(gf.tags).toEqual(expect.arrayContaining(['allergens_unknown', 'diet_variant', 'addon']));
    expect(gf.dietGuests).toBe(10);
    expect(gf.alternatives).not.toContain('bread');
    expect(calls.chooseUnknownFallback).toBe(1);
    expect(line('c-bread').allergen.verdict).toBe('pass');
  });

  it('attaches a pending history note from seeded leftovers', () => {
    const h = line('c-chicken').history!;
    expect(h.choice).toBe('pending');
    expect(h.adjustment.basis).toBe('same_product');
    expect(h.suggestedPacks).toBe(5);
    expect(h.historyPacks).toBe(4); // 20 kg × (1 − 0.3) = 14 kg → 4 pieces
    expect(line('c-rice').history).toBeUndefined(); // basmati history exists but keeps 2 packs → no note
  });

  it('makes shared dishes without a diet variant meet every diet', () => {
    const chicken = draft.components.find((c) => c.id === 'c-chicken')!;
    expect(chicken.requiredDiet).toEqual(['gluten_free']);
    expect(line('c-chicken').allergen.verdict).toBe('pass');
    expect(draft.components.find((c) => c.id === 'c-bread')!.requiredDiet).toBeUndefined(); // has a gluten-free variant
    expect(listAudit({ conversationId: ctx.conversationId }).some((a) => a.action === 'applyDietRules')).toBe(true);
  });

  it('computes totals, cut-off and saves a ready draft', () => {
    expect(draft.totals).toEqual(computeTotals(draft.lines, 2000));
    expect(draft.totals.low).toBeGreaterThan(0);
    expect(draft.totals.collapsed).toBe(false);
    expect(draft.cutoff).toBe('2026-12-03T10:00:00Z');
    expect(draft.status).toBe('ready');
    expect(getDraftByConversation(ctx.conversationId)?.lines).toHaveLength(4);
  });

  it('streams progress for every step and the draft at the end', () => {
    const steps = parts.filter((p) => p.type === 'data-progress').map((p) => `${p.data.step}:${p.data.status}`);
    expect(steps).toEqual(['understand', 'ingredients', 'search', 'allergens', 'prices', 'history', 'draft'].flatMap((s) => [`${s}:start`, `${s}:done`]));
    expect(parts.find((p) => p.type === 'data-progress' && p.data.step === 'search' && p.data.status === 'done')).toMatchObject({ data: { label: 'Haetaan valikoimasta' } });
    expect(parts.at(-2)?.type).toBe('data-draft');
  });

  it('editDraft: a scale intent recomputes packs and reports the change', async () => {
    vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([intent({ kind: 'scaleGuests', guests: 200 })]);
    const emitted: AimoDataPart[] = [];
    const res = await runEditDraft({ ctx, instruction: 'make it 200 guests' }, { specialists, emit: async (p) => { emitted.push(p); } });

    const after = getDraftByConversation(ctx.conversationId)!;
    const chicken = after.lines.find((l) => l.componentId === 'c-chicken')!;
    expect(after.intake.guests).toBe(200);
    expect(chicken.packs).toBe(10); // 200 × 0.20 kg = 40 kg → 10 × 4.4 kg
    expect(chicken.tags).toContain('updated');
    expect(after.lines.find((l) => l.componentId === 'c-bread-gf')!.packs).toBe(line('c-bread-gf').packs); // diet guests unchanged
    expect(res.summary).toMatch(/guests 100 → 200/);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: 'data-draft', data: { diff: { changedLineIds: expect.arrayContaining([chicken.id]) } } });
  });
});

describe('edits and re-plans on a ready draft', () => {
  const ctx2 = { conversationId: 'conv-edit', customerId: 'helsinki-juhlapalvelu' };
  const noEmit = async () => {};
  const deps = { specialists, emit: noEmit };
  const lineOf = (componentId: string) => getDraftByConversation(ctx2.conversationId)!.lines.find((l) => l.componentId === componentId)!;

  beforeAll(async () => {
    const draft = { ...startDraft, id: 'draft-2', conversationId: ctx2.conversationId };
    saveDraft(draft);
    await buildDraft({ draft, addons: ['Bread'], ctx: ctx2 }, deps);
  });

  it('understandRequest leaves a ready draft untouched and points to editDraft', async () => {
    vi.mocked(specialists.extractIntake).mockClear();
    const res = await runUnderstandRequest({ ctx: ctx2, message: 'make it 320 guests' }, deps);
    expect(res).toMatchObject({ draftReady: true, missing: [] });
    expect(res.hint).toMatch(/editDraft/);
    expect(specialists.extractIntake).not.toHaveBeenCalled();
    expect(getDraftByConversation(ctx2.conversationId)!.intake.guests).toBe(100);
  });

  it('setPacks beyond stock re-derives the stock tags', async () => {
    const chicken = lineOf('c-chicken');
    vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([intent({ kind: 'setPacks', lineId: chicken.id, packs: 200 })]);
    await runEditDraft({ ctx: ctx2, instruction: '200 packs of chicken' }, deps);
    // 500 kg in stock = 113 pieces of 4.4 kg
    expect(lineOf('c-chicken').tags).toEqual(expect.arrayContaining(['in_stock', 'may_deliver_short', 'updated']));
  });

  it('a swap prices the candidates first and passes the buyer request to the product agent', async () => {
    const chicken = lineOf('c-chicken');
    vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([
      intent({ kind: 'swap', lineId: chicken.id, searchFi: 'broileri', searchEn: 'chicken', reason: 'Buyer asked for cheaper chicken' }),
    ]);
    await runEditDraft({ ctx: ctx2, instruction: 'cheaper chicken' }, deps);
    const input = vi.mocked(specialists.pickProducts).mock.calls.at(-1)![0];
    expect(input.request).toBe('cheaper chicken');
    expect([...input.prices!.keys()].sort()).toEqual(['chk', 'chk2']);
  });

  it('a swap while Valio is down still applies and reports the missing price', async () => {
    vi.mocked(getPrices).mockRejectedValue(new Error('Valio price request failed'));
    vi.mocked(getAvailability).mockRejectedValue(new Error('Valio availability request failed'));
    try {
      const rice = lineOf('c-rice');
      vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([
        intent({ kind: 'swap', lineId: rice.id, searchFi: 'jasmiiniriisi', searchEn: 'jasmine rice', reason: 'Buyer asked for jasmine' }),
      ]);
      const res = await runEditDraft({ ctx: ctx2, instruction: 'swap to jasmine' }, deps);
      const swapped = lineOf('c-rice');
      expect(swapped.productId).toBe('jas');
      expect(swapped.unitPrice).toBeNull();
      expect(swapped.substituteFor?.reason).toBe('Buyer asked for jasmine');
      expect(res.problems.join(' ')).toMatch(/Valio prices and stock are unavailable/);
    } finally {
      vi.mocked(getPrices).mockImplementation(async (ids) => (await import('../fixtures.test-util')).fakePrices(ids));
      vi.mocked(getAvailability).mockImplementation(async (ids) => (await import('../fixtures.test-util')).fakeAvailability(ids));
    }
  });

  it('planOrder re-plans for a new delivery date and keeps the add-ons', async () => {
    vi.mocked(specialists.planMenu).mockClear();
    await runPlanOrder({ ctx: ctx2, addons: [], deliveryDate: '2026-12-12' }, deps);
    const draft = getDraftByConversation(ctx2.conversationId)!;
    expect(draft.intake.deliveryDate).toBe('2026-12-12');
    expect(draft.status).toBe('ready');
    expect(vi.mocked(specialists.planMenu).mock.calls[0][0].addons).toEqual(['Leipä']);
    expect(vi.mocked(getPrices).mock.calls.at(-1)![1]).toBe('2026-12-12');
  });

  it('planOrder rejects a past delivery date', async () => {
    await expect(runPlanOrder({ ctx: ctx2, addons: [], deliveryDate: '2020-01-01' }, deps)).rejects.toThrow(/too soon/);
  });

  it('substitutes a product that only arrives after the delivery date, and shows the cut-off for the delivery date', async () => {
    vi.mocked(getAvailability).mockImplementationOnce(async (ids) => {
      const f = await import('../fixtures.test-util');
      return new Map([...f.fakeAvailability(ids)].map(([id, a]) => [id, id === 'chk' ? { ...a, availableDate: '2026-12-20' } : a]));
    });
    await runPlanOrder({ ctx: ctx2, addons: [] }, deps);
    const draft = getDraftByConversation(ctx2.conversationId)!;
    const chicken = draft.lines.find((l) => l.componentId === 'c-chicken')!;
    expect(chicken.productId).toBe('chk2');
    expect(chicken.substituteFor?.reason).toBe('Earliest delivery 2026-12-20');
    // basmati: earliest 2026-12-06 with cut-off 2026-12-03 10:00 → 3 days' lead → 2026-12-09 10:00 for 12 Dec
    expect(draft.cutoff).toBe('2026-12-09T10:00:00Z');
  });

  it('flags a passed order cut-off', async () => {
    vi.mocked(getAvailability).mockImplementationOnce(async (ids) => {
      const f = await import('../fixtures.test-util');
      return new Map([...f.fakeAvailability(ids)].map(([id, a]) => [id, { ...a, closingTime: '2026-01-01T10:00:00Z' }]));
    });
    const summary = await runPlanOrder({ ctx: ctx2, addons: [] }, deps);
    expect(summary.exceptions.join(' ')).toMatch(/cut-off has passed for 2026-12-12/);
    expect(listAudit({ conversationId: ctx2.conversationId }).some((a) => a.action === 'cutoffPassed')).toBe(true);
  });
});

describe('applyDietRules', () => {
  const comp = (o: Partial<MenuComponent> & Pick<MenuComponent, 'id'>): MenuComponent => ({
    label: o.id, searchTerms: { fi: '', en: '' }, category: 'sauce', origin: 'requested', guests: 100, requiredAmount: 1, requiredUnit: 'kg', ...o,
  });

  it('constrains shared items by every diet need no variant covers', () => {
    const out = applyDietRules([
      comp({ id: 'c-chicken', category: 'poultry_main' }),
      comp({ id: 'c-chicken-gf', dietVariantOf: 'c-chicken', requiredDiet: ['gluten_free'], guests: 12 }),
      comp({ id: 'c-seasoning', category: 'seasoning', origin: 'needed_for_cooking' }),
    ], [{ diet: 'gluten_free', guests: 12 }, { diet: 'nuts', guests: 3 }]);
    expect(out[0]).toMatchObject({ excludeAllergens: ['nuts'] });
    expect(out[0].requiredDiet).toBeUndefined();
    expect(out[1]).toMatchObject({ requiredDiet: ['gluten_free'] });
    expect(out[1].excludeAllergens).toBeUndefined();
    expect(out[2]).toMatchObject({ requiredDiet: ['gluten_free'], excludeAllergens: ['nuts'] });
  });

  it('leaves components alone without diets', () => {
    const cs = [comp({ id: 'c-a' })];
    expect(applyDietRules(cs, 'none')).toBe(cs);
    expect(applyDietRules(cs, undefined)).toBe(cs);
  });
});

describe('byGranularity', () => {
  it('puts packs between 1/20 and 1/5 of the need first, keeping search order otherwise', () => {
    const sized = (id: string, packSize: number) => ({ ...products[0], id, packSize });
    const order = byGranularity([sized('huge', 15), sized('tiny', 0.5), sized('good', 4), sized('good2', 10)], 60).map((p) => p.id);
    expect(order).toEqual(['good', 'good2', 'huge', 'tiny']);
  });
});
