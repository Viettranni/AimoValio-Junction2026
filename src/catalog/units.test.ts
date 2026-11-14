import { describe, expect, it } from 'vitest';
import { deriveUnits, parseNameMeasure } from './units';

const names = (en: string) => ({ names: [{ value: en, language: 'en' }] });

describe('parseNameMeasure', () => {
  it('parses multipacks, decimals with comma, and litres', () => {
    expect(parseNameMeasure('Rice 4x1,5kg')?.total).toBeCloseTo(6);
    expect(parseNameMeasure('Macaroni 10 kg')?.total).toBe(10);
    expect(parseNameMeasure('Cream 1 L')).toMatchObject({ kind: 'l', total: 1 });
    expect(parseNameMeasure('6 x Filos halloumi 750g')?.total).toBeCloseTo(4.5);
    expect(parseNameMeasure('Mineral water')).toBeNull();
  });
});

describe('deriveUnits', () => {
  it('reads the approximate weight from the name for kg-sold products', () => {
    const u = deriveUnits({
      salesUnit: 'KG', baseUnit: 'KG', allowedLotSize: 4.4,
      units: [{ unitId: 'KG', sizeInBaseUnits: 1 }],
      synkkaData: names('Kariniemen Chicken breast fillet marinated 150-180g/appr. 4,4 kg'),
    });
    expect(u).toMatchObject({ packSize: 4.4, packUnit: 'kg' });
    expect(u.salesUnitLabel).toEqual({ en: 'kg', fi: 'kg', sv: 'kg' });
  });
  it('uses the case net weight for a box', () => {
    const u = deriveUnits({
      salesUnit: 'KI', baseUnit: 'BAG',
      units: [{ unitId: 'BAG', sizeInBaseUnits: 1 }, { unitId: 'KI', sizeInBaseUnits: 18 }],
      synkkaData: { ...names('40g Kettle Chips'), unitConversions: [{ synkkaPackagingType: 'CASE', netWeight: { unit: 'GRM', value: 720 } }] },
    });
    expect(u).toMatchObject({ packSize: 0.72, packUnit: 'kg', salesUnitLabel: { en: 'box', fi: 'laatikko', sv: 'kartong' } });
  });
  it('scales the each-weight by the sales unit size', () => {
    const u = deriveUnits({
      salesUnit: 'KI', baseUnit: 'ST',
      units: [{ unitId: 'ST', sizeInBaseUnits: 1 }, { unitId: 'KI', sizeInBaseUnits: 6 }],
      synkkaData: { ...names('Sauce'), unitConversions: [{ synkkaPackagingType: 'BASE_UNIT_OR_EACH', netWeight: { unit: 'GRM', value: 500 } }] },
    });
    expect(u.packSize).toBe(3);
  });
  it('describes multipacks from the name and measures liquids in litres', () => {
    const u = deriveUnits({ salesUnit: 'KI', baseUnit: 'KI', units: [{ unitId: 'KI', sizeInBaseUnits: 1 }], synkkaData: names('4 x Cream 1,5 l') });
    expect(u).toMatchObject({ packSize: 6, packUnit: 'l', packDescription: '4 × 1.5 l box' });
  });
  it('falls back to pieces and a generic label', () => {
    const u = deriveUnits({ salesUnit: 'XYZ', baseUnit: 'XYZ', synkkaData: names('Napkin holder') });
    expect(u).toMatchObject({ packSize: 1, packUnit: 'pcs', salesUnitLabel: { en: 'package', fi: 'pakkaus', sv: 'förpackning' } });
  });
  it('scales a per-item litre measure by bottles per box', () => {
    const u = deriveUnits({
      salesUnit: 'KI', baseUnit: 'BOT',
      units: [{ unitId: 'BOT', sizeInBaseUnits: 1 }, { unitId: 'KI', sizeInBaseUnits: 12 }],
      synkkaData: names('Arizona Green Tea 45cl'),
    });
    expect(u).toMatchObject({ packSize: 5.4, packUnit: 'l', packDescription: '12 × 0.45 l box' });
  });
  it('does not rescale a name that already states the case count', () => {
    const u = deriveUnits({
      salesUnit: 'KI', baseUnit: 'PRK',
      units: [{ unitId: 'PRK', sizeInBaseUnits: 1 }, { unitId: 'KI', sizeInBaseUnits: 6 }],
      synkkaData: names('Jalostaja pork and beef 400g x 6'),
    });
    expect(u).toMatchObject({ packSize: 2.4, packUnit: 'kg', packDescription: '6 × 400 g box' });
  });
  it('reads a trailing x8 multiplier', () => {
    const u = deriveUnits({
      salesUnit: 'KI', baseUnit: 'KI', units: [{ unitId: 'KI', sizeInBaseUnits: 1 }],
      synkkaData: names('Fria Cinnamon buns 200g/4pcs frozen x8'),
    });
    expect(u).toMatchObject({ packSize: 1.6, packUnit: 'kg' });
  });
});
