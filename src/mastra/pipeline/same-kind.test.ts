import { describe, expect, it } from 'vitest';
import type { CatalogProduct, MenuComponent } from '@/contracts';
import { products } from '../fixtures.test-util';
import { sameKind, swapFits } from './same-kind';

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

  it('never turns gluten-free breadcrumbs into gluten-free snack pizzas (seen live)', () => {
    const c = component('gluteeniton korppujauho kanalle', 'gluten-free breadcrumbs for chicken', { category: 'seasoning' });
    const crumbs = product({ nameEn: 'Moilas Gluten-Free Breadcrumbs 350g', nameFi: 'Moilas Gluteeniton Korppujauho 350g', category: '21310' });
    const pizza = product({ nameEn: '12 x Moilas Gluten-Free Snack Pizza BBQ Chicken 100g pre-baked frozen', nameFi: '12 x Moilas gluteeniton snackpizza BBQ broileri 100g', category: '41755' });
    const mestari = product({ nameEn: 'Mestari gluten-free Breadcrumb 5 kg', nameFi: 'Mestari gluteeniton Korppujauho 5 kg', category: '21310' });
    expect(sameKind(c, crumbs, pizza)).toBe(false);
    expect(sameKind(c, crumbs, { ...pizza, category: '21310' })).toBe(false); // a snack is never an ingredient's stand-in
    expect(sameKind(c, crumbs, mestari)).toBe(true);
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

describe('swapFits', () => {
  const knorr = product({ nameEn: 'Knorr Cream sauce 1kg/9L', nameFi: 'Knorr Kermakastike 1kg/9L', category: '21905' });
  const ask = { fi: 'laktoositon kermakastike', en: 'lactose-free cream sauce' };
  it('rejects ice cream and soy sauce for a cream sauce (seen live)', () => {
    const iceCream = product({ nameEn: 'Cornetto Classico Gluten & Lactose Free Ice cream 125 ml/75 g', nameFi: 'Cornetto Gluteeniton ja laktoositon Jäätelötuutti', category: '41800' });
    const soy = product({ nameEn: 'Kikkoman 1l Gluten free soy sauce', nameFi: 'Kikkoman 1l Gluteeniton soijakastike', category: '21921' });
    expect(swapFits(knorr, iceCream, ask)).toBe(false);
    expect(swapFits(knorr, soy, { fi: 'gluteeniton kermakastike', en: 'gluten-free cream sauce' })).toBe(false);
  });
  it('accepts the same category group or a name with every asked word', () => {
    const valio = product({ nameEn: 'Valio Keittiön creamy brown sauce 3 dl lactose free', nameFi: 'Valio Keittiön kermainen ruskea kastike 3 dl laktoositon', category: '21904' });
    expect(swapFits(knorr, valio, ask)).toBe(true);
    const jasmine = product({ nameEn: 'Jasmin rice 5kg', nameFi: 'Jasmiiniriisi 5kg', category: '21340' });
    const basmati = product({ nameEn: 'Basmati rice 5kg', nameFi: 'Basmatiriisi 5kg', category: '17300' });
    expect(swapFits(jasmine, basmati, { fi: 'basmatiriisi', en: 'basmati rice' })).toBe(true);
  });
});
