import { describe, expect, it } from 'vitest';
import { sampleProducts } from './sample';

describe('sampleProducts', () => {
  it('returns display fields for the conversation terms, every term represented', () => {
    const products = sampleProducts(['chicken', 'rice'], 12);
    expect(products.length).toBe(12);
    expect(Object.keys(products[0]).sort()).toEqual(expect.arrayContaining(['displayName', 'group', 'id']));
    expect(products.some((p) => p.group === 'poultry')).toBe(true);
    expect(products.some((p) => /rice|riisi/i.test(p.displayName))).toBe(true);
    expect(new Set(products.map((p) => p.displayName.toLowerCase())).size).toBe(products.length);
  });
  it('falls back to food-service staples without terms', () => {
    const products = sampleProducts([], 10);
    expect(products.length).toBe(10);
    expect(new Set(products.map((p) => p.group)).size).toBeGreaterThan(2);
  });
});
