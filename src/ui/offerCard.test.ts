import { describe, expect, it } from 'vitest';
import type { Offer, OfferLine } from '@/gateway/types';
import { approvalReasons, firstName, offerCountdown, priceChanges, roleLabel } from './offerCard';

const line = (lineId: string, productName: string, productId = lineId): OfferLine => ({
  lineId, productId, productName, packDescription: '', requested: { quantity: 1, unit: 'packs' }, packs: 1, quantity: 5, unit: 'kg',
  unitPrice: 10, unitPriceWithTax: 11, priceBasis: 'per_pack', valioPrice: 10, lineTotal: 10, lineTotalWithTax: 11,
  status: 'available', available: true, availablePacks: null, availableDate: null, cutoff: null,
});
const offer = { offerId: 'OF-1', lines: [line('l-1', 'Basmati rice 5kg'), line('l-2', 'Chicken breast fillet ca4,4kg')] } as unknown as Offer;

describe('offer card data', () => {
  it('counts down on the gateway clock and expires at validUntil', () => {
    const until = '2026-11-14T10:15:00Z';
    expect(offerCountdown(until, Date.parse('2026-11-14T10:00:00Z'))).toMatchObject({ label: '15:00', expired: false });
    expect(offerCountdown(until, Date.parse('2026-11-14T10:14:30.2Z')).label).toBe('0:30');
    // Demo clock two days ahead of the browser: the skew is applied.
    expect(offerCountdown('2026-11-16T10:15:00Z', Date.parse('2026-11-14T10:10:00Z'), 2 * 86_400_000).label).toBe('5:00');
    expect(offerCountdown(until, Date.parse('2026-11-14T10:16:00Z'))).toMatchObject({ expired: true, label: '0:00', msLeft: 0 });
  });

  it('shows price changes as "Rice €22.58 → €23.10" and skips non-price changes', () => {
    const rows = priceChanges([
      { lineId: 'l-1', productId: 'l-1', field: 'price', from: 22.58, to: 23.1, message: '' },
      { field: 'expired', from: 'a', to: 'b', message: 'expired' },
      { lineId: 'l-2', productId: 'l-2', field: 'availability', from: 'available', to: 'partial', message: '' },
    ], offer, 'en');
    expect(rows).toEqual([{ lineId: 'l-1', name: 'Basmati rice', text: '€22.58 → €23.10' }]);
    expect(priceChanges([{ lineId: 'l-1', field: 'price', from: 22.58, to: 23.1, message: '' }], offer, 'fi')[0].text.replace(/\s/g, ' ')).toBe('22,58 € → 23,10 €');
  });

  it("explains approval reasons in the buyer's language, once per rule", () => {
    const reasons = [
      { rule: 'total_over_limit' as const, message: 'Total €1,234.00 excl. VAT is above…' },
      { rule: 'allergen_unverified' as const, message: '…' },
    ];
    expect(approvalReasons(reasons, { total: 1234, limitEur: 1000 }, 'en')).toEqual([
      'Total €1,234.00 excl. VAT is above the €1,000 limit for automatic orders',
      'Allergens of some products couldn’t be verified against your diets',
    ]);
    expect(approvalReasons(reasons.slice(0, 1), { total: 1234, limitEur: 1000 }, 'fi')[0].replace(/\s/g, ' ')).toMatch(/^Summa 1 234,00 € alv 0 % ylittää/);
    expect(roleLabel('Purchasing manager', 'sv')).toBe('Inköpschef');
    expect(roleLabel('Head chef', 'fi')).toBe('Head chef');
    expect(firstName('Anna Virtanen')).toBe('Anna');
  });
});
