import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getProduct } from './search';
import { dishesOf, sampleProducts } from './sample';

const hasIndex = existsSync(path.join(process.cwd(), 'data', 'catalog.index.json'));
if (!hasIndex) console.warn('sample.test: data/catalog.index.json is missing (run `npm run build:index`); catalogue checks skipped');

const OFF_TOPIC = /\b(pie|kiev|krispies|cookie|biscuit|candy|chocolate|snack|nugget|ice cream|pudding|porridge|wrap|burger|pizza|sushi|cake)\b/i;

describe('dishesOf', () => {
  it('splits joined chips into dishes of content words', () => {
    expect(dishesOf('chicken and rice')).toEqual([['chicken'], ['rice']]);
    expect(dishesOf('Salmon fillet')).toEqual([['salmon', 'fillet']]);
    expect(dishesOf('kana ja riisi')).toEqual([['kana'], ['riisi']]);
  });
});

describe.skipIf(!hasIndex)('sampleProducts', () => {
  const products = hasIndex ? sampleProducts(['chicken', 'rice'], 24) : [];

  it('returns display fields for the conversation terms, every term represented', () => {
    expect(products.length).toBe(24);
    expect(Object.keys(products[0])).toEqual(expect.arrayContaining(['displayName', 'group', 'id']));
    expect(products.some((p) => /\bchicken\b/i.test(p.displayName))).toBe(true);
    expect(products.some((p) => /\brice\b/i.test(p.displayName))).toBe(true);
    expect(new Set(products.map((p) => p.displayName.toLowerCase())).size).toBe(products.length);
  });

  it('leaves out snacks, sweets, ready meals and fuzzy look-alikes', () => {
    for (const p of products) {
      const name = getProduct(p.id)!.nameEn;
      expect(name).not.toMatch(OFF_TOPIC);
      expect(name).not.toMatch(/costa rica|licorice/i);
    }
  });

  it('keeps each term to one or two catalogue categories', () => {
    const categories = (re: RegExp) =>
      new Set(products.map((p) => getProduct(p.id)!).filter((p) => re.test(p.nameEn)).map((p) => p.category));
    expect(categories(/\bchicken\b/i).size).toBeLessThanOrEqual(2);
    expect(categories(/\brice\b/i).size).toBeLessThanOrEqual(2);
  });

  it('falls back to food-service staples without terms', () => {
    const staples = sampleProducts([], 10);
    expect(staples.length).toBe(10);
    expect(new Set(staples.map((p) => p.group)).size).toBeGreaterThan(2);
  });
});
