import type { CatalogProduct, Draft, DraftLine, HistoryAdjustment } from '@/contracts';

export const line = (o: Partial<DraftLine> = {}): DraftLine => ({
  id: 'l-1', componentId: 'c-1', group: 'poultry_main', productId: 'p-1', productName: 'Chicken',
  packDescription: '4 × 1.5 kg box', packs: 10, quantity: 60, unit: 'kg',
  unitPrice: 10, unitPriceWithTax: 11.35, tags: [],
  allergen: { productId: 'p-1', verdict: 'pass', conflicts: [], unmetDiets: [] },
  alternatives: [], ...o,
});

export const adjustment = (o: Partial<HistoryAdjustment> = {}): HistoryAdjustment => ({
  basis: 'same_product', sampleSize: 2, ratio: 0.1, suggestedQty: 54, adjustedQty: 48.6, unit: 'kg', last: null, ...o,
});

export const product = (o: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: 'p-1', nameEn: 'Chicken', nameFi: 'Kana', category: '1', salesUnit: 'KI',
  salesUnitLabel: { en: 'box', fi: 'laatikko', sv: 'kartong' }, packSize: 6, packUnit: 'kg',
  packDescription: '4 × 1.5 kg box', allowedLotSize: 1, temperature: 'chilled', vendor: 'v',
  allergens: [], dietFlags: [], reliability: null, co2PerKg: null, ...o,
});

export const draft = (o: Partial<Draft> = {}): Draft => ({
  id: 'd', conversationId: 'c', customerId: 'u',
  intake: { guests: 300, eventType: 'party', budget: 'none' },
  components: [{
    id: 'c-1', label: 'Chicken', searchTerms: { fi: 'kana', en: 'chicken' }, category: 'poultry_main',
    origin: 'requested', guests: 300, requiredAmount: 54, requiredUnit: 'kg',
  }],
  lines: [line({ packs: 9, quantity: 54 })],
  totals: { low: 0, high: 0, lowWithTax: 0, highWithTax: 0, collapsed: true, budget: null, overBudget: false },
  cutoff: null, status: 'building', updatedAt: '2026-11-14T00:00:00Z', ...o,
});
