import { describe, expect, it } from 'vitest';
import type { Allergen } from '@/contracts';
import { deriveAllergens, deriveDietFlags, parseAllergens } from './allergens';

describe('parseAllergens', () => {
  it('finds egg and mustard in the potato salad text', () => {
    const text = 'potato (60%), mayonnaise (rapeseed oil, water, EGG YOLK, sugar), spices (MUSTARD SEED, white pepper)';
    expect(parseAllergens(text, [])).toEqual(expect.arrayContaining(['egg', 'mustard']));
  });
  it('maps milk and maito to milk', () => {
    expect(parseAllergens('skimmed MILK powder', [])).toContain('milk');
    expect(parseAllergens('rasvaton maito, suola', [])).toContain('milk');
    expect(parseAllergens('täysMAITOjauhe', [])).toContain('milk');
  });
  it.each(['WHEAT flour', 'BARLEY malt', 'RYE', 'OATS', 'VEHNÄJAUHO', 'ohra', 'RUIS', 'KAURA'])('maps %s to gluten', (t) => {
    expect(parseAllergens(t, [])).toContain('gluten');
  });
  it('detects Finnish allergen words', () => {
    expect(parseAllergens('KANANMUNA, SOIJA, SELLERI, SINAPPI, SEESAMI, KALA', [])).toEqual(
      expect.arrayContaining(['egg', 'soy', 'celery', 'mustard', 'sesame', 'fish']),
    );
  });
  it('keeps peanut and tree nuts apart', () => {
    expect(parseAllergens('MAAPÄHKINÄ', [])).toEqual(['peanut']);
    expect(parseAllergens('PÄHKINÄ, almonds', [])).toEqual(['nuts']);
  });
  it('ignores look-alikes', () => {
    expect(parseAllergens('lactic acid, maitohappo, coconut milk, nutmeg, buckwheat, gluten free flour, cocoa butter', [])).toEqual([]);
    expect(parseAllergens('aromivahvenne, laxative effects', [])).toEqual([]);
  });
  it('returns unknown with no text and no ingredients', () => {
    expect(parseAllergens(undefined, [])).toBe('unknown');
    expect(parseAllergens('  ', [])).toBe('unknown');
  });
  it('uses ingredient names when the key text is missing', () => {
    expect(parseAllergens(undefined, ['wheat flour'])).toEqual(['gluten']);
  });
  it('returns an empty list when text exists and has no allergens', () => {
    expect(parseAllergens('Black currants 100%.', [])).toEqual([]);
  });
});

describe('deriveDietFlags', () => {
  const base = { nameEn: 'Chicken', nameFi: 'Kana' };
  it('derives gluten and lactose free from known allergens', () => {
    expect(deriveDietFlags({ ...base, allergens: ['egg'] })).toEqual(expect.arrayContaining(['gluten_free', 'lactose_free']));
    expect(deriveDietFlags({ ...base, allergens: ['gluten', 'milk'] })).toEqual([]);
  });
  it('never infers diets from unknown allergens without a name claim', () => {
    expect(deriveDietFlags({ ...base, allergens: 'unknown' })).toEqual([]);
  });
  it('trusts explicit name claims unless allergens contradict them', () => {
    expect(deriveDietFlags({ nameEn: 'Feta lactose free', nameFi: 'Feta laktoositon', allergens: 'unknown' })).toContain('lactose_free');
    expect(deriveDietFlags({ nameEn: 'Vegan burger', nameFi: 'Vegaaniburgeri', allergens: ['soy'] })).toEqual(
      expect.arrayContaining(['vegan', 'vegetarian']),
    );
    expect(deriveDietFlags({ nameEn: 'Vegan burger', nameFi: '', allergens: ['egg'] })).not.toContain('vegan');
  });
  it('flags lactose-free dairy as lactose free although it contains milk (milk allergy still fails)', () => {
    const milk = { nameEn: 'Valio semi skimmed milk 1 l lactose free UHT', nameFi: 'Valio kevytmaito 1 l laktoositon UHT', allergens: ['milk'] as Allergen[], ingredientData: true };
    expect(deriveDietFlags(milk)).toContain('lactose_free');
    expect(deriveDietFlags({ ...milk, nameEn: 'Valio semi skimmed milk 1 l', nameFi: 'Valio kevytmaito 1 l' })).not.toContain('lactose_free');
  });
});

describe('deriveAllergens', () => {
  const sales = 'Myyntierä 5kg:n tai 10kg:n laatikko.';
  it('flags herring from the name and refuses diet flags when the text is a sales note', () => {
    const r = deriveAllergens([sales], [], ['Baltic herring fillet', 'Silakkafilee']);
    expect(r).toEqual({ allergens: ['fish'], ingredientData: false });
    expect(deriveDietFlags({ nameEn: 'Baltic herring fillet', nameFi: 'Silakkafilee', ...r })).toEqual([]);
  });
  it('detects burbot, roach and vendace roe', () => {
    expect(parseAllergens('MADE (LOTA LOTA)', [])).toEqual(['fish']);
    expect(parseAllergens('särki', [])).toEqual(['fish']);
    expect(parseAllergens('vendace roe', [])).toEqual(['fish']);
    expect(parseAllergens('KATKARAPU', [])).toEqual(['crustaceans']);
    expect(parseAllergens('lemon made with sugar', [])).toEqual([]);
  });
  it('treats non-ingredient short text as unknown', () => {
    expect(deriveAllergens(['Sold in 5 kg boxes.'], [], ['Mystery item', 'Mysteeri']).allergens).toBe('unknown');
    expect(deriveAllergens(['ok'], [], ['Item', 'Tuote']).allergens).toBe('unknown');
  });
  it('unions name allergens with a real ingredient list', () => {
    const r = deriveAllergens(['potato, salt, water'], [], ['Salmon potato mash']);
    expect(r.allergens).toEqual(['fish']);
    expect(r.ingredientData).toBe(true);
  });
});

describe('lowercase voi', () => {
  it('is butter as a whole list item, not the verb', () => {
    expect(parseAllergens('vehnäjauho, voi, suola', [])).toContain('milk');
    expect(parseAllergens('Teipille voi kirjoittaa.', [])).toEqual([]);
  });
});
