import { describe, expect, it, vi } from 'vitest';

vi.mock('@/catalog/load', async () => {
  const { products } = await import('@/mastra/fixtures.test-util');
  return { loadCatalog: () => products };
});

import { checkAllergens, getAlternatives, getProduct, searchProducts } from '@/catalog';
import { aimoProductTools, aimoProductsServer } from './aimo-products';

const call = (name: keyof typeof aimoProductTools, input: unknown) =>
  (aimoProductTools[name].execute as (i: unknown, c: unknown) => Promise<unknown>)(input, {});

describe('aimo-products MCP tools', () => {
  it('return the same data as the catalogue module', async () => {
    expect(await call('searchProducts', { query: 'rice', limit: 3 })).toEqual({ hits: searchProducts({ query: 'rice', limit: 3 }) });
    expect(await call('searchProducts', { query: 'bread', excludeAllergens: ['gluten'] }))
      .toEqual({ hits: searchProducts({ query: 'bread', excludeAllergens: ['gluten'] }) });
    expect(await call('getProduct', { id: 'chk' })).toEqual({ product: getProduct('chk') });
    expect(await call('getProduct', { id: 'nope' })).toEqual({ product: null });
    expect(await call('getAlternatives', { productId: 'jas', limit: 2 })).toEqual({ hits: getAlternatives('jas', 2) });
    expect(await call('checkAllergens', { ids: ['bread', 'gfb1'], excludeAllergens: ['gluten'] }))
      .toEqual({ checks: checkAllergens(['bread', 'gfb1'], { excludeAllergens: ['gluten'] }) });
  });

  it('getIngredients returns the ingredient text and parsed allergens', async () => {
    expect(await call('getIngredients', { id: 'bread' })).toEqual({
      productId: 'bread', found: true, ingredientsText: 'WHEAT flour, water', allergens: ['gluten'], dietFlags: [],
    });
    expect(await call('getIngredients', { id: 'nope' })).toMatchObject({ found: false, allergens: 'unknown' });
  });

  it('exposes the five tools on the MCP server', async () => {
    const { tools } = await aimoProductsServer.getToolListInfo();
    expect(tools.map((t) => t.name).sort()).toEqual(['checkAllergens', 'getAlternatives', 'getIngredients', 'getProduct', 'searchProducts']);
  });
});
