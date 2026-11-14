import type { AvailabilityInfo, CatalogProduct, PriceInfo } from '@/contracts';

const base: CatalogProduct = {
  id: '', nameEn: '', nameFi: '', category: '1', salesUnit: 'KI',
  salesUnitLabel: { en: 'box', fi: 'laatikko', sv: 'kartong' }, packSize: 5, packUnit: 'kg',
  packDescription: '5 kg', allowedLotSize: 1, temperature: 'chilled', vendor: 'v',
  allergens: [], dietFlags: ['gluten_free', 'lactose_free'], reliability: 0.97, co2PerKg: null,
};
const p = (o: Partial<CatalogProduct>): CatalogProduct => ({ ...base, ...o });

export const products: CatalogProduct[] = [
  p({ id: 'chk', nameEn: 'Chicken breast fillet ca4,4kg', nameFi: 'Broileri rintafilee n4,4kg', salesUnit: 'KG', packSize: 4.4, packDescription: 'approx. 4.4 kg piece' }),
  p({ id: 'chk2', nameEn: 'Chicken thigh fillet 2kg', nameFi: 'Broileri reisifilee 2kg', packSize: 2, packDescription: '2 kg bag', reliability: 0.85 }),
  p({ id: 'jas', nameEn: 'Jasmine rice 5kg', nameFi: 'Jasmiiniriisi 5kg', nameSv: 'Jasminris 5kg', temperature: 'ambient' }),
  p({ id: 'bas', nameEn: 'Basmati rice 5kg', nameFi: 'Basmatiriisi 5kg', temperature: 'ambient' }),
  p({ id: 'bread', nameEn: 'White bread 3kg', nameFi: 'Vaalea leipä 3kg', packSize: 3, allergens: ['gluten'], dietFlags: ['lactose_free'], keyIngredientsText: 'WHEAT flour, water' }),
  p({ id: 'gfb1', nameEn: 'Bread rolls 2kg', nameFi: 'Sämpylä leipä 2kg', packSize: 2, allergens: 'unknown', dietFlags: [] }),
  p({ id: 'gfb2', nameEn: 'Gluten free bread 2kg', nameFi: 'Gluteeniton leipä 2kg', packSize: 2, allergens: 'unknown', dietFlags: [] }),
  p({ id: 'crumbs', nameEn: 'Gluten free crumb coating 1kg', nameFi: 'Gluteeniton korppujauho 1kg', category: '20', packSize: 1, temperature: 'ambient' }),
  p({ id: 'pizza', nameEn: 'Gluten free pizza base 1kg', nameFi: 'Gluteeniton pizzapohja 1kg', category: '21', packSize: 1, temperature: 'frozen' }),
];

export const DATE = '2026-12-06';
const fetchedAt = '2026-11-14T10:00:00Z';

/** Per sales unit as Valio returns it: per kg for the KG product. */
const priceList: Record<string, [number, number]> = {
  chk: [8.5, 9.65], chk2: [13.2, 14.98], jas: [11.9, 13.51], bas: [13.4, 15.21], bread: [14.2, 16.12], gfb1: [9, 10.22], gfb2: [10, 11.35], crumbs: [6, 6.81], pizza: [7, 7.95],
};

export function fakePrices(ids: string[]): Map<string, PriceInfo> {
  return new Map(ids.map((id) => {
    const [price, priceWithTax] = priceList[id];
    return [id, { productId: id, ok: true, price, priceWithTax, taxRate: 13.5, currency: 'EUR', fetchedAt }];
  }));
}

export function fakeAvailability(ids: string[]): Map<string, AvailabilityInfo> {
  return new Map(ids.map((id) => {
    const info: AvailabilityInfo = {
      productId: id, deliverable: true, salesBlock: false, logisticModel: 'Stock', availableAmount: 500,
      availableDate: DATE, closingTime: '2026-12-04T10:00:00Z', fetchedAt,
    };
    if (id === 'jas') Object.assign(info, { deliverable: false, availableAmount: 0, availableDate: '2026-12-20' });
    if (id === 'chk2') Object.assign(info, { logisticModel: 'Terminal', availableAmount: null });
    if (id === 'crumbs') Object.assign(info, { deliverable: false, availableAmount: 0 });
    if (id === 'bas') info.closingTime = '2026-12-03T10:00:00Z';
    return [id, info];
  }));
}
