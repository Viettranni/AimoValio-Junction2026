import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AimoDataPart, AvailabilityInfo, DietNeed, Draft, MenuComponent, Receipt } from '@/contracts';

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

vi.mock('@/mcp/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/mcp/client')>();
  const { checkAllergens } = await import('@/catalog');
  return { ...actual, getProductTools: vi.fn(async () => ({})), checkAllergensViaMcp: vi.fn(async (ids: string[], c: object) => checkAllergens(ids, c)) };
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
import { checkAllergensViaMcp } from '@/mcp/client';
import { applyDietRules, buildDraft, byGranularity, toComponents } from './build-draft';
import { reasonText } from './reasons';

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
    expect(rice.substituteFor).toEqual({ productId: 'jas', productName: 'Jasmiiniriisi 5kg', reason: 'Ei toimitettavissa su 6.12.' });
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

  it('sizes the gluten-free portion by the buyer\'s count, checks it against gluten-free, and logs why', async () => {
    // The menu agent guessed 30 gluten-free guests; the buyer said 10, so code corrects it.
    const c4 = { conversationId: 'conv-split', customerId: ctx.customerId };
    vi.mocked(specialists.planMenu).mockResolvedValueOnce([
      menu[0], menu[1],
      { ...menu[2], guests: 70 },
      { ...menu[3], guests: 30 },
    ]);
    vi.mocked(checkAllergensViaMcp).mockClear();
    const d = { ...startDraft, id: 'draft-split', conversationId: c4.conversationId };
    saveDraft(d);
    const { draft: split } = await buildDraft({ draft: d, addons: ['Bread'], ctx: c4 }, { specialists, emit: async () => {} });
    const comp = (id: string) => split.components.find((c) => c.id === id)!;
    expect([comp('c-bread').guests, comp('c-bread-gf').guests]).toEqual([90, 10]);
    const gfLine = split.lines.find((l) => l.componentId === 'c-bread-gf')!;
    expect(gfLine.dietGuests).toBe(10);
    expect(gfLine.allergen.verdict).not.toBe('pass'); // no ingredient data: never safe
    const gfChecks = vi.mocked(checkAllergensViaMcp).mock.calls.filter(([ids]) => ids.includes(gfLine.productId));
    expect(gfChecks.some(([, c]) => (c as { requireDiet?: string[] }).requireDiet?.includes('gluten_free'))).toBe(true);
    const why = listAudit({ conversationId: c4.conversationId }).find((a) => a.action === 'fitDietSplit')!;
    expect(why.summary).toBe("Portions sized by the buyer's diet counts: Leipä 90 + Gluteeniton leipä 10 (gluten_free, no gluten).");
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

  it('drops an agent edit when the buyer changed the draft meanwhile', async () => {
    const chicken = lineOf('c-chicken');
    vi.mocked(specialists.interpretEdit).mockImplementationOnce(async () => {
      const d = getDraftByConversation(ctx2.conversationId)!;
      saveDraft({ ...d, lines: d.lines.map((l) => (l.id === chicken.id ? { ...l, packs: 7 } : l)), updatedAt: '2099-01-01T00:00:00.000Z' });
      return [intent({ kind: 'setPacks', lineId: chicken.id, packs: 3 })];
    });
    await expect(runEditDraft({ ctx: ctx2, instruction: '3 packs of chicken' }, deps)).rejects.toThrow(/changed/);
    expect(lineOf('c-chicken').packs).toBe(7);
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
    expect(chicken.substituteFor?.reason).toBe('Aikaisintaan toimitettavissa su 20.12.'); // in the buyer's language (fi)
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

  // One base plus one variant; true when the variant covers the need (base left unconstrained).
  const covers = (variant: Partial<MenuComponent>, need: DietNeed['diet']) => {
    const base = comp({ id: 'c-base' });
    return applyDietRules([base, comp({ id: 'c-var', dietVariantOf: 'c-base', ...variant })], [{ diet: need, guests: 3 }])[0] === base;
  };

  it('excluding gluten covers gluten-free; excluding milk covers lactose-free', () => {
    expect(covers({ excludeAllergens: ['gluten'] }, 'gluten_free')).toBe(true);
    expect(covers({ excludeAllergens: ['milk'] }, 'lactose_free')).toBe(true);
  });

  it('excluded allergens never cover vegetarian or vegan', () => {
    expect(covers({ excludeAllergens: ['fish', 'crustaceans', 'molluscs'] }, 'vegetarian')).toBe(false);
    expect(covers({ excludeAllergens: ['milk', 'egg', 'fish', 'crustaceans', 'molluscs'] }, 'vegan')).toBe(false);
  });

  it('lactose-free does not cover a milk allergy; vegan covers milk, lactose-free and vegetarian', () => {
    expect(covers({ requiredDiet: ['lactose_free'] }, 'milk')).toBe(false);
    expect(covers({ requiredDiet: ['vegan'] }, 'milk')).toBe(true);
    expect(covers({ requiredDiet: ['vegan'] }, 'lactose_free')).toBe(true);
    expect(covers({ requiredDiet: ['vegan'] }, 'vegetarian')).toBe(true);
  });

  it('gluten-free covers a gluten allergy and vegetarian covers fish; not the other way round', () => {
    expect(covers({ requiredDiet: ['gluten_free'] }, 'gluten')).toBe(true);
    expect(covers({ requiredDiet: ['vegetarian'] }, 'fish')).toBe(true);
    expect(covers({ requiredDiet: ['vegetarian'] }, 'vegan')).toBe(false);
    expect(covers({ requiredDiet: ['lactose_free'] }, 'vegan')).toBe(false);
  });

  it('an uncovered need constrains the base', () => {
    const out = applyDietRules([comp({ id: 'c-a' }), comp({ id: 'c-a-v', dietVariantOf: 'c-a', excludeAllergens: ['milk', 'egg'] })], [{ diet: 'vegan', guests: 3 }]);
    expect(out[0].requiredDiet).toEqual(['vegan']);
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

describe('toComponents', () => {
  it('drops a diet variant whose base component does not exist', () => {
    const { components, dropped } = toComponents([
      component({ id: 'c-chicken', category: 'poultry_main' }),
      component({ id: 'c-rice-gf', category: 'grain_side', guests: 12, dietVariantOf: 'c-rice', requiredDiet: ['gluten_free'] }),
    ], 'wedding');
    expect(components.map((c) => c.id)).toEqual(['c-chicken']);
    expect(dropped.map((p) => p.id)).toEqual(['c-rice-gf']);
  });

  it('buildDraft audits the dropped variant', async () => {
    const c3 = { conversationId: 'conv-orphan', customerId: ctx.customerId };
    vi.mocked(specialists.planMenu).mockResolvedValueOnce([
      component({ id: 'c-chicken', label: 'Kana', category: 'poultry_main', searchTerms: { fi: 'broileri', en: 'chicken' } }),
      component({ id: 'c-x-gf', label: 'Orpo', category: 'bread', guests: 10, dietVariantOf: 'c-missing', requiredDiet: ['gluten_free'] }),
    ]);
    const d = { ...startDraft, id: 'draft-3', conversationId: c3.conversationId };
    saveDraft(d);
    const { draft } = await buildDraft({ draft: d, addons: [], ctx: c3 }, { specialists, emit: async () => {} });
    expect(draft.components.map((c) => c.id)).toEqual(['c-chicken']);
    expect(listAudit({ conversationId: c3.conversationId }).find((a) => a.action === 'dropOrphanVariants')?.summary).toMatch(/Orpo \(variant of c-missing\)/);
  });
});

describe('substitution and stock', () => {
  const plan = async (conversationId: string, menu: MenuComponentPlan[], customerId = ctx.customerId) => {
    vi.mocked(specialists.planMenu).mockResolvedValueOnce(menu);
    const d = { ...startDraft, id: `draft-${conversationId}`, conversationId, customerId };
    saveDraft(d);
    return buildDraft({ draft: d, addons: [], ctx: { conversationId, customerId } }, { specialists, emit: async () => {} });
  };
  const chickenOnly = [component({ id: 'c-chicken', label: 'Kana', category: 'poultry_main', searchTerms: { fi: 'broileri', en: 'chicken' } })];
  const withStock = (overrides: Record<string, Partial<AvailabilityInfo>>) => async (ids: string[]) => {
    const f = await import('../fixtures.test-util');
    return new Map([...f.fakeAvailability(ids)].map(([id, a]) => [id, { ...a, ...overrides[id] }]));
  };

  it('does not substitute with a product of another kind; the line stays unavailable', async () => {
    const { draft, summary } = await plan('conv-kind', [
      component({ id: 'c-crumbs', label: 'Korppujauho', category: 'seasoning', origin: 'needed_for_cooking', searchTerms: { fi: 'gluteeniton', en: 'gluten free' } }),
    ]);
    const crumbs = draft.lines[0];
    expect(crumbs.productId).toBe('crumbs');
    expect(crumbs.alternatives).not.toContain('pizza');
    expect(crumbs.tags).toContain('unavailable');
    expect(crumbs.tags).not.toContain('substitute');
    expect(summary.exceptions.join(' ')).toMatch(/No product of the same kind/);
  });

  it('tops up from a same-kind alternative when stock is short', async () => {
    vi.mocked(getAvailability).mockImplementationOnce(withStock({ chk: { availableAmount: 10 } })); // 10 kg = 2 pieces of 4.4 kg
    const { draft, summary } = await plan('conv-stock', chickenOnly);
    const [main, topUp] = draft.lines;
    expect(main).toMatchObject({ productId: 'chk', packs: 2, quantity: 8.8 });
    expect(main.quantity).toBeLessThanOrEqual(10); // passes the approve-time stock check
    expect(topUp).toMatchObject({ productId: 'chk2', packs: 6 }); // 56 guests × 0.2 kg = 11.2 kg → 6 × 2 kg
    expect(topUp.tags).toContain('substitute');
    expect(topUp.substituteFor?.reason).toBe('Varastossa vain 2 pakkausta; loput korvataan vastaavalla tuotteella');
    expect(draft.components.map((c) => [c.id, c.guests])).toEqual([['c-chicken', 44], ['c-chicken-more', 56]]);
    expect(summary.exceptions.join(' ')).toMatch(/Varastossa vain 2 pakkausta/);
  });

  it('caps the line and reports it when no alternative has stock', async () => {
    vi.mocked(getAvailability).mockImplementationOnce(withStock({ chk: { availableAmount: 10 }, chk2: { deliverable: false, availableAmount: 0 } }));
    const { draft, summary } = await plan('conv-cap', chickenOnly);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0]).toMatchObject({ productId: 'chk', packs: 2, quantity: 8.8 });
    expect(draft.lines[0].tags).not.toContain('may_deliver_short');
    expect(summary.exceptions.join(' ')).toMatch(/line is capped/);
  });

  describe('with history that ran short last time (+30 % needed)', () => {
    const SHORT = 'cust-short';
    beforeAll(() => {
      storeOrder({
        orderId: 'VA-2026-00002', simulated: true, customerId: SHORT, eventName: 'Häät', eventType: 'wedding',
        deliveryDate: '2026-06-01', guests: 100,
        lines: [{ lineId: 'l-1', productId: 'chk', productName: 'Chicken', packs: 5, quantity: 22, unit: 'kg', unitPrice: 37.4, unitPriceWithTax: 42.46, lineTotal: 187, lineTotalWithTax: 212.3 }],
        total: 187, totalWithTax: 212.3, vat: 25.3, co2Kg: null, minutesSaved: 20, submittedAt: '2026-05-20T09:00:00Z',
      }, new Map([['l-1', 'poultry_main']]));
      recordLeftovers('VA-2026-00002', [{ lineId: 'l-1', leftoverQty: -6.6 }]);
    });
    const chickenLine = (d: Draft) => d.lines.find((l) => l.productId === 'chk');

    it('history clamp: a note never goes above Stock, and is dropped when the clamp leaves nothing to change', async () => {
      // 20 kg → 5 pieces; history 26 kg → 6 pieces.
      vi.mocked(getAvailability).mockImplementationOnce(withStock({ chk: { availableAmount: 50 } }));
      const roomy = await plan('conv-hist-room', chickenOnly, SHORT);
      expect(chickenLine(roomy.draft)!.history).toMatchObject({ historyPacks: 6, suggestedPacks: 5 });

      vi.mocked(getAvailability).mockImplementationOnce(withStock({ chk: { availableAmount: 22 } })); // exactly 5 pieces
      const tight = await plan('conv-hist-tight', chickenOnly, SHORT);
      expect(chickenLine(tight.draft)).toMatchObject({ packs: 5 });
      expect(chickenLine(tight.draft)!.history).toBeUndefined();
    });

    it('history + split: the served line keeps within its stock', async () => {
      vi.mocked(getAvailability).mockImplementationOnce(withStock({ chk: { availableAmount: 10 } }));
      const { draft } = await plan('conv-hist-split', chickenOnly, SHORT);
      expect(chickenLine(draft)).toMatchObject({ packs: 2 });
      expect(chickenLine(draft)!.history).toBeUndefined();
      expect(draft.lines.find((l) => l.productId === 'chk2')!.tags).toContain('substitute');
    });

    it('no history note on a line that cannot be delivered', async () => {
      vi.mocked(getAvailability).mockImplementationOnce(withStock({
        chk: { deliverable: false, availableAmount: 0 }, chk2: { deliverable: false, availableAmount: 0 },
      }));
      const { draft } = await plan('conv-hist-undeliverable', chickenOnly, SHORT);
      const chicken = chickenLine(draft)!;
      expect(chicken.tags).toContain('unavailable');
      expect(chicken.history).toBeUndefined();
    });

    it('history + cap: the capped component asks for the capped amount and no note exceeds stock', async () => {
      vi.mocked(getAvailability).mockImplementationOnce(withStock({ chk: { availableAmount: 10 }, chk2: { deliverable: false, availableAmount: 0 } }));
      const { draft } = await plan('conv-hist-cap', chickenOnly, SHORT);
      expect(draft.components[0].requiredAmount).toBe(8.8);
      expect(chickenLine(draft)).toMatchObject({ packs: 2 });
      expect(chickenLine(draft)!.history).toBeUndefined();
    });
  });

  it('drops a line whose stock covers no pack at all and keeps the exception', async () => {
    vi.mocked(getAvailability).mockImplementationOnce(withStock({ chk: { availableAmount: 2 }, chk2: { deliverable: false, availableAmount: 0 } }));
    const { draft, summary } = await plan('conv-zero', chickenOnly);
    expect(draft.lines).toEqual([]);
    expect(draft.components).toEqual([]);
    expect(summary.exceptions.join(' ')).toMatch(/line is left out/);
  });
});

describe('resilience and allergen safety', () => {
  const run = async (conversationId: string, menuPlan: MenuComponentPlan[]) => {
    vi.mocked(specialists.planMenu).mockResolvedValueOnce(menuPlan);
    const d = { ...startDraft, id: `draft-${conversationId}`, conversationId };
    saveDraft(d);
    return buildDraft({ draft: d, addons: [], ctx: { conversationId, customerId: ctx.customerId } }, { specialists, emit: async () => {} });
  };
  const chicken = [component({ id: 'c-chicken', label: 'Kana', category: 'poultry_main', searchTerms: { fi: 'broileri', en: 'chicken' } })];

  it('runs the allergen screening through the aimo-products MCP client', async () => {
    vi.mocked(checkAllergensViaMcp).mockClear();
    await run('conv-mcp', chicken);
    expect(checkAllergensViaMcp).toHaveBeenCalled();
  });

  it('never selects a conflicting product: the component is left out and reported', async () => {
    vi.mocked(checkAllergensViaMcp).mockImplementationOnce(async (ids) =>
      ids.map((productId) => ({ productId, verdict: 'fail' as const, conflicts: ['gluten' as const], unmetDiets: [] })));
    const { draft, summary } = await run('conv-fail', chicken);
    expect(draft.lines).toHaveLength(0);
    expect(summary.exceptions.join(' ')).toMatch(/Kana: kaikki löydetyt tuotteet/);
    expect(listAudit({ conversationId: 'conv-fail' }).some((a) => a.action === 'noSafeProduct')).toBe(true);
  });

  it('degrades to the best catalogue match when the product agent fails', async () => {
    vi.mocked(specialists.pickProducts).mockRejectedValueOnce(new Error('model down'));
    const { draft } = await run('conv-pick-down', chicken);
    expect(draft.lines).toHaveLength(1);
    expect(listAudit({ conversationId: 'conv-pick-down' }).find((a) => a.action === 'pickProducts' && a.actor === 'product')?.summary)
      .toBe('Product agent unavailable, used best match');
  });

  it('keeps the first unknown candidate when the allergen agent fails', async () => {
    vi.mocked(specialists.chooseUnknownFallback).mockRejectedValueOnce(new Error('model down'));
    const { draft } = await run('conv-allergen-down', [
      component({ id: 'c-bread', label: 'Leipä', category: 'bread', excludeAllergens: ['gluten'], requiredDiet: ['gluten_free'], searchTerms: { fi: 'leipä', en: 'bread' } }),
    ]);
    expect(draft.lines[0]?.allergen.verdict).toBe('unknown');
    expect(listAudit({ conversationId: 'conv-allergen-down' }).some((a) => a.action === 'chooseUnknownFallback')).toBe(true);
  });

  it('turns a menu agent failure into a friendly error', async () => {
    vi.mocked(specialists.planMenu).mockRejectedValueOnce(new Error('overloaded'));
    const d = { ...startDraft, id: 'draft-menu-down', conversationId: 'conv-menu-down' };
    saveDraft(d);
    await expect(buildDraft({ draft: d, addons: [], ctx: { conversationId: 'conv-menu-down', customerId: ctx.customerId } }, { specialists, emit: async () => {} }))
      .rejects.toThrow(/menu planner is unavailable/);
  });
});

describe('reasonText', () => {
  it('writes short reasons in fi / sv / en and falls back to English', () => {
    expect(reasonText({ kind: 'shortStock', packs: 6, label: 'Chicken breast' }, 'en')).toBe('Only 6 packs in stock; the rest is a similar chicken breast');
    expect(reasonText({ kind: 'late', date: '2026-12-09' }, 'sv')).toMatch(/^Tidigast leverans/);
    expect(reasonText({ kind: 'salesBlock' }, 'et')).toBe('The product has a sales block');
  });
});

describe('editDraft: covering the rest of a stock-capped line', () => {
  const chicken300 = [component({ id: 'c-chicken', label: 'Chicken', category: 'poultry_main', guests: 300, searchTerms: { fi: 'broileri', en: 'chicken breast' } })];
  // 30 kg of chk = 6 pieces of 4.4 kg; chk2 not deliverable while planning, so the line is capped (no split).
  const capped = async (conversationId: string) => {
    const c = { conversationId, customerId: 'cust-topup' };
    vi.mocked(specialists.planMenu).mockResolvedValueOnce(chicken300);
    vi.mocked(getAvailability).mockImplementationOnce(async (ids) => {
      const f = await import('../fixtures.test-util');
      return new Map([...f.fakeAvailability(ids)].map(([id, a]) => [id, id === 'chk' ? { ...a, availableAmount: 30 } : id === 'chk2' ? { ...a, deliverable: false, availableAmount: 0 } : a]));
    });
    const d: Draft = { ...startDraft, id: `draft-${conversationId}`, conversationId, customerId: c.customerId, intake: { ...startDraft.intake, guests: 300, diets: 'none', lang: 'en' } };
    saveDraft(d);
    const { summary } = await buildDraft({ draft: d, addons: [], ctx: c }, { specialists, emit: async () => {} });
    expect(summary.exceptions.join(' ')).toMatch(/line is capped/);
    return c;
  };
  const chickenKg = (id: string) => getDraftByConversation(id)!.lines.filter((l) => l.group === 'poultry_main').reduce((s, l) => s + l.quantity, 0);
  const deps = { specialists, emit: async () => {} };

  for (const kind of ['topUp', 'add'] as const) {
    it(`"Add a similar chicken breast to cover the rest" (${kind}) adds only the remainder, tagged substitute`, async () => {
      const c = await capped(`conv-topup-${kind}`);
      const start = getDraftByConversation(c.conversationId)!;
      const main = start.lines[0];
      expect(main).toMatchObject({ productId: 'chk', packs: 6 });
      vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([kind === 'topUp'
        ? intent({ kind: 'topUp', lineId: main.id, searchFi: 'broileri rintafilee', searchEn: 'chicken breast' })
        : intent({ kind: 'add', searchFi: 'broileri rintafilee', searchEn: 'chicken breast', category: 'poultry_main', label: 'Chicken breast' })]);
      const res = await runEditDraft({ ctx: c, instruction: 'Add a similar chicken breast to cover the rest' }, deps);

      const after = getDraftByConversation(c.conversationId)!;
      expect(after.lines).toHaveLength(2);
      const added = after.lines[1];
      expect(added).toMatchObject({ productId: 'chk2', componentId: main.componentId, packs: 17, quantity: 34 }); // 60 − 26.4 = 33.6 kg → 17 × 2 kg
      expect(added.tags).toContain('substitute');
      expect(added.tags).not.toContain('addon');
      expect(added.history).toBeUndefined();
      expect(added.substituteFor?.reason).toBe('Covers the rest: only 6 packs of Chicken breast fillet ca4,4kg in stock');
      expect(after.components).toHaveLength(1);
      const total = chickenKg(c.conversationId);
      expect(total).toBeGreaterThanOrEqual(60);
      expect(total).toBeLessThan(60 + 2);
      expect(res.summary).toMatch(/added/);
    });
  }

  it('an already covered component gets no new line, only a problem (topUp and add)', async () => {
    const c = await capped('conv-topup-covered');
    const main = getDraftByConversation(c.conversationId)!.lines[0];
    vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([intent({ kind: 'topUp', lineId: main.id, searchEn: 'chicken breast' })]);
    await runEditDraft({ ctx: c, instruction: 'cover the rest' }, deps);
    expect(getDraftByConversation(c.conversationId)!.lines).toHaveLength(2);

    vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([intent({ kind: 'topUp', lineId: main.id, searchEn: 'chicken breast' })]);
    const again = await runEditDraft({ ctx: c, instruction: 'cover the rest' }, deps);
    expect(again.problems.join(' ')).toMatch(/already covered/);
    expect(getDraftByConversation(c.conversationId)!.lines).toHaveLength(2);

    vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([
      intent({ kind: 'add', searchFi: 'broileri', searchEn: 'chicken breast', category: 'poultry_main', label: 'Chicken' }),
    ]);
    const dup = await runEditDraft({ ctx: c, instruction: 'add chicken breast' }, deps);
    expect(dup.problems.join(' ')).toMatch(/already covered/);
    expect(getDraftByConversation(c.conversationId)!.lines).toHaveLength(2);
    expect(chickenKg(c.conversationId)).toBeLessThan(62);
  });

  it('caps the top-up by its own stock and reports what is still missing', async () => {
    const c = await capped('conv-topup-short');
    const main = getDraftByConversation(c.conversationId)!.lines[0];
    vi.mocked(specialists.interpretEdit).mockResolvedValueOnce([intent({ kind: 'topUp', lineId: main.id, searchEn: 'chicken breast' })]);
    vi.mocked(getAvailability).mockImplementationOnce(async (ids) => {
      const f = await import('../fixtures.test-util');
      return new Map([...f.fakeAvailability(ids)].map(([id, a]) => [id, id === 'chk2' ? { ...a, logisticModel: 'Stock' as const, availableAmount: 10 } : a]));
    });
    const res = await runEditDraft({ ctx: c, instruction: 'cover the rest' }, deps);
    expect(getDraftByConversation(c.conversationId)!.lines[1]).toMatchObject({ productId: 'chk2', packs: 10, quantity: 20 });
    expect(res.problems.join(' ')).toMatch(/only 10 packs of Chicken thigh fillet 2kg in stock/);
  });
});
