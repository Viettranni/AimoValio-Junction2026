import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { checkAllergens, getAlternatives, getProduct, searchProducts } from './index';
import { loadCatalog } from './load';

describe('catalogue search', () => {
  beforeAll(() => {
    if (!existsSync(path.join(process.cwd(), 'data', 'catalog.index.json'))) {
      throw new Error('data/catalog.index.json is missing: run `npm run build:index` first');
    }
    loadCatalog();
  });

  it('finds a chicken fillet for an English query', () => {
    const hits = searchProducts({ query: 'chicken breast fillet' }).slice(0, 5);
    expect(hits.some((h) => /chicken/i.test(h.product.nameEn) && /fillet/i.test(h.product.nameEn))).toBe(true);
  });
  it('searches in Finnish', () => {
    const hits = searchProducts({ query: 'kana' });
    expect(hits.length).toBeGreaterThan(0);
  });
  it('drops gluten products when gluten is excluded', () => {
    const hits = searchProducts({ query: 'pasta', excludeAllergens: ['gluten'], limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      if (h.product.allergens !== 'unknown') expect(h.product.allergens).not.toContain('gluten');
      else expect(h.reasons.join(' ')).toMatch(/unverified/);
    }
  });
  it('honours the limit and temperature filter', () => {
    const hits = searchProducts({ query: 'fish', temperature: 'frozen', limit: 3 });
    expect(hits.length).toBeLessThanOrEqual(3);
    for (const h of hits) expect(h.product.temperature).toBe('frozen');
  });
  it('gets alternatives that exclude the product itself', () => {
    const seed = searchProducts({ query: 'chicken breast fillet' })[0].product;
    const alts = getAlternatives(seed.id, 4);
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.every((a) => a.product.id !== seed.id)).toBe(true);
  });
  it('checks allergens by id, including unknown and missing products', () => {
    const unknown = loadCatalog().find((p) => p.allergens === 'unknown' && !p.dietFlags.includes('gluten_free'))!;
    const withGluten = loadCatalog().find((p) => Array.isArray(p.allergens) && p.allergens.includes('gluten'))!;
    const [a, b, c] = checkAllergens([unknown.id, withGluten.id, 'nope'], { excludeAllergens: ['gluten'], requireDiet: ['gluten_free'] });
    expect(a.verdict).toBe('unknown');
    expect(b.verdict).toBe('fail');
    expect(b.conflicts).toEqual(['gluten']);
    expect(c.verdict).toBe('unknown');
    expect(getProduct('nope')).toBeUndefined();
  });
});
