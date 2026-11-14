import { describe, expect, it } from 'vitest';
import type { CatalogProduct, MenuComponent } from '@/contracts';
import { products } from '../fixtures.test-util';
import { sameKind } from './same-kind';

const product = (o: Partial<CatalogProduct>): CatalogProduct => ({ ...products[0], ...o });
const component = (fi: string, en: string, o: Partial<MenuComponent> = {}): MenuComponent => ({
  id: 'c', label: en, searchTerms: { fi, en }, category: 'dessert', origin: 'requested', guests: 100,
  requiredAmount: 12, requiredUnit: 'kg', ...o,
});

describe('sameKind', () => {
  it('rejects a product that only shares diet words', () => {
    const c = component('gluteeniton korppujauho', 'gluten-free breadcrumbs');
    const crumbs = product({ nameEn: 'Gluten free breadcrumbs 1kg', nameFi: 'Gluteeniton korppujauho 1kg', category: '20' });
    const pizza = product({ nameEn: 'Gluten free pizza base', nameFi: 'Gluteeniton pizzapohja', category: '21' });
    const otherCrumbs = product({ nameEn: 'Panko breadcrumbs 1kg', nameFi: 'Panko korppujauho 1kg', category: '22' });
    expect(sameKind(c, crumbs, pizza)).toBe(false);
    expect(sameKind(c, crumbs, otherCrumbs)).toBe(true);
  });

  it('rejects a dessert sold by the piece for a dessert needed by the kg', () => {
    const c = component('mutakakku', 'mud cake');
    const cake = product({ nameEn: 'Mud cake 2kg', nameFi: 'Mutakakku 2kg', category: '30', packUnit: 'kg' });
    const bars = product({ nameEn: 'Mint chocolate cake bar', nameFi: 'Minttusuklaapatukka', category: '30', packUnit: 'pcs' });
    expect(sameKind(c, cake, bars)).toBe(false);
  });

  it('matches Finnish compounds and the same Valio category', () => {
    const c = component('riisi', 'rice', { category: 'grain_side' });
    const jasmine = product({ nameEn: 'Jasmine rice 5kg', nameFi: 'Jasmiiniriisi 5kg', category: '40' });
    expect(sameKind(c, jasmine, product({ nameEn: 'Basmati 5kg', nameFi: 'Basmatiriisi 5kg', category: '41' }))).toBe(true);
    expect(sameKind(c, jasmine, product({ nameEn: 'Bulgur 5kg', nameFi: 'Bulgur 5kg', category: '40' }))).toBe(true);
    expect(sameKind(c, jasmine, product({ nameEn: 'Couscous 5kg', nameFi: 'Kuskus 5kg', category: '42' }))).toBe(false);
  });
});
