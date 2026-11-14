import { describe, expect, it } from 'vitest';
import { dietCountOptions, dietCovers, fitDietSplit, mergeDiets, parseDietCount } from './diets';

describe('dietCountOptions', () => {
  it('offers 5 / 10 / 20, about 10% and everyone for a mid-size event', () => {
    expect(dietCountOptions(120)).toEqual([
      { kind: 'count', guests: 5 }, { kind: 'count', guests: 10 }, { kind: 'count', guests: 20 },
      { kind: 'share', guests: 12 }, { kind: 'all', guests: 120 },
    ]);
  });

  it('skips the share when it equals a fixed count, and counts that are not below the guest count', () => {
    expect(dietCountOptions(100).map((o) => o.guests)).toEqual([5, 10, 20, 100]);
    expect(dietCountOptions(15)).toEqual([
      { kind: 'count', guests: 5 }, { kind: 'count', guests: 10 }, { kind: 'share', guests: 2 }, { kind: 'all', guests: 15 },
    ]);
    expect(dietCountOptions(5)).toEqual([{ kind: 'share', guests: 1 }, { kind: 'all', guests: 5 }]);
    expect(dietCountOptions(1)).toEqual([{ kind: 'all', guests: 1 }]);
  });

  it('is empty without a guest count', () => {
    expect(dietCountOptions(0)).toEqual([]);
  });
});

describe('parseDietCount', () => {
  it('reads the labels the count buttons send, in every UI language', () => {
    expect(parseDietCount('5 guests', 120)).toBe(5);
    expect(parseDietCount('20', 120)).toBe(20);
    expect(parseDietCount('12 vierasta', 120)).toBe(12);
    expect(parseDietCount('10 gäster', 120)).toBe(10);
    expect(parseDietCount('About 10% (12)', 120)).toBe(12);
    expect(parseDietCount('Noin 10 % (12)', 120)).toBe(12);
    expect(parseDietCount('Ungefär 10 % (12)', 120)).toBe(12);
    expect(parseDietCount('All 120', 120)).toBe(120);
    expect(parseDietCount('Kaikki 120', 120)).toBe(120);
    expect(parseDietCount('Alla 120', 120)).toBe(120);
  });

  it('reads a bare percentage or "everyone" against the guest count', () => {
    expect(parseDietCount('10%', 120)).toBe(12);
    expect(parseDietCount('about 15 %', 200)).toBe(30);
    expect(parseDietCount('everyone', 80)).toBe(80);
    expect(parseDietCount('kaikki', 80)).toBe(80);
  });

  it('caps at the guest count and never returns zero', () => {
    expect(parseDietCount('300', 120)).toBe(120);
    expect(parseDietCount('1%', 20)).toBe(1);
    expect(parseDietCount('0', 120)).toBeNull();
  });

  it('leaves anything else to the intake agent', () => {
    for (const text of ['make it 150 guests', '12 gluten-free, 4 vegan', 'budget 1500', 'no allergies', 'next Friday', '']) {
      expect(parseDietCount(text, 120)).toBeNull();
    }
  });
});

describe('mergeDiets', () => {
  it('keeps a diet named without a count pending', () => {
    expect(mergeDiets({}, { diets: null, named: ['gluten_free'] })).toEqual({ dietsPending: ['gluten_free'] });
  });

  it('a count fills a pending diet and keeps the others pending', () => {
    const current = { dietsPending: ['gluten_free', 'vegan'] as const };
    expect(mergeDiets({ dietsPending: [...current.dietsPending] }, { diets: [{ diet: 'gluten_free', guests: 12 }], named: null }))
      .toEqual({ diets: [{ diet: 'gluten_free', guests: 12 }], dietsPending: ['vegan'] });
  });

  it('merges counts by diet and drops a diet set to zero', () => {
    expect(mergeDiets(
      { diets: [{ diet: 'gluten_free', guests: 12 }, { diet: 'vegan', guests: 3 }] },
      { diets: [{ diet: 'vegan', guests: 0 }, { diet: 'lactose_free', guests: 4 }], named: null },
    )).toEqual({ diets: [{ diet: 'gluten_free', guests: 12 }, { diet: 'lactose_free', guests: 4 }] });
  });

  it('a withdrawn pending diet is no longer asked about', () => {
    expect(mergeDiets({ dietsPending: ['nuts'] }, { diets: [{ diet: 'nuts', guests: 0 }], named: null })).toEqual({});
  });

  it('"none" clears every diet and anything pending', () => {
    expect(mergeDiets({ diets: [{ diet: 'vegan', guests: 2 }], dietsPending: ['nuts'] }, { diets: 'none', named: null }))
      .toEqual({ diets: 'none' });
  });

  it('a diet named after "none" replaces it', () => {
    expect(mergeDiets({ diets: 'none' }, { diets: null, named: ['vegan'] })).toEqual({ dietsPending: ['vegan'] });
    expect(mergeDiets({ diets: 'none' }, { diets: [{ diet: 'vegan', guests: 3 }], named: null })).toEqual({ diets: [{ diet: 'vegan', guests: 3 }] });
  });

  it('a named diet that already has a count is not asked again', () => {
    expect(mergeDiets({ diets: [{ diet: 'vegan', guests: 3 }] }, { diets: null, named: ['vegan'] })).toEqual({ diets: [{ diet: 'vegan', guests: 3 }] });
  });

  it('changes nothing when the message says nothing about diets', () => {
    const current = { diets: [{ diet: 'vegan' as const, guests: 3 }], dietsPending: ['nuts' as const] };
    expect(mergeDiets(current, { diets: null, named: null })).toEqual(current);
  });
});

describe('dietCovers', () => {
  it('coverage is one way', () => {
    expect(dietCovers({ requiredDiet: ['vegan'] }, 'lactose_free')).toBe(true);
    expect(dietCovers({ requiredDiet: ['lactose_free'] }, 'milk')).toBe(false);
    expect(dietCovers({ excludeAllergens: ['gluten'] }, 'gluten_free')).toBe(true);
    expect(dietCovers({ excludeAllergens: ['milk', 'egg'] }, 'vegan')).toBe(false);
  });
});

describe('fitDietSplit', () => {
  const plan = (o: { id: string; guests: number; dietVariantOf?: string; requiredDiet?: ('gluten_free' | 'vegan')[]; excludeAllergens?: 'nuts'[] }) => ({
    dietVariantOf: null, requiredDiet: null, excludeAllergens: null, ...o,
  });

  it('sizes each variant by its diet count and gives the rest to the base', () => {
    const { plans } = fitDietSplit([
      plan({ id: 'c-chicken', guests: 120 }),
      plan({ id: 'c-chicken-gf', guests: 15, dietVariantOf: 'c-chicken', requiredDiet: ['gluten_free'] }),
      plan({ id: 'c-rice', guests: 120 }),
    ], [{ diet: 'gluten_free', guests: 12 }], 120);
    expect(plans.map((p) => [p.id, p.guests])).toEqual([['c-chicken', 108], ['c-chicken-gf', 12], ['c-rice', 120]]);
  });

  it('a variant covering several diets serves all of them', () => {
    const { plans } = fitDietSplit([
      plan({ id: 'c-bread', guests: 100 }),
      plan({ id: 'c-bread-v', guests: 5, dietVariantOf: 'c-bread', requiredDiet: ['vegan', 'gluten_free'] }),
    ], [{ diet: 'gluten_free', guests: 10 }, { diet: 'lactose_free', guests: 4 }], 100);
    expect(plans.map((p) => p.guests)).toEqual([86, 14]);
  });

  it('when a diet covers everyone the variant goes and the base carries the constraint', () => {
    const { plans, merged } = fitDietSplit([
      plan({ id: 'c-chicken', guests: 80 }),
      plan({ id: 'c-chicken-gf', guests: 80, dietVariantOf: 'c-chicken', requiredDiet: ['gluten_free'] }),
    ], [{ diet: 'gluten_free', guests: 80 }], 80);
    expect(plans).toEqual([plan({ id: 'c-chicken', guests: 80 })]);
    expect(merged).toEqual(['c-chicken-gf']);
  });

  it('when the variants together leave nobody for the base, all are folded into the base', () => {
    const { plans, merged } = fitDietSplit([
      plan({ id: 'c-a', guests: 20 }),
      plan({ id: 'c-a-gf', guests: 10, dietVariantOf: 'c-a', requiredDiet: ['gluten_free'] }),
      plan({ id: 'c-a-vg', guests: 10, dietVariantOf: 'c-a', requiredDiet: ['vegan'] }),
    ], [{ diet: 'gluten_free', guests: 10 }, { diet: 'vegan', guests: 10 }], 20);
    expect(plans.map((p) => [p.id, p.guests])).toEqual([['c-a', 20]]);
    expect(merged).toEqual(['c-a-gf', 'c-a-vg']);
  });

  it('leaves a variant matching no stated diet as planned, and does nothing without diets or guests', () => {
    const ps = [plan({ id: 'c-a', guests: 50 }), plan({ id: 'c-a-n', guests: 3, dietVariantOf: 'c-a', excludeAllergens: ['nuts'] })];
    expect(fitDietSplit(ps, [{ diet: 'vegan', guests: 5 }], 50).plans.map((p) => p.guests)).toEqual([47, 3]);
    expect(fitDietSplit(ps, 'none', 50).plans).toBe(ps);
    expect(fitDietSplit(ps, [{ diet: 'nuts', guests: 5 }], 0).plans).toBe(ps);
  });
});
