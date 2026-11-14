import { describe, expect, it } from 'vitest';
import type { AvailabilityInfo, PriceInfo } from '@/contracts';
import { products } from '../fixtures.test-util';
import { availablePacks, packPrice, stockTags } from './reprice';

const chickenKg = products.find((p) => p.id === 'chk')!; // salesUnit KG, 4.4 kg piece
const riceBox = products.find((p) => p.id === 'jas')!;  // salesUnit KI, 5 kg box

const price = (o: Partial<PriceInfo> = {}): PriceInfo => ({ productId: 'x', ok: true, price: 8.5, priceWithTax: 9.65, currency: 'EUR', fetchedAt: '', ...o });
const avail = (o: Partial<AvailabilityInfo> = {}): AvailabilityInfo => ({
  productId: 'x', deliverable: true, salesBlock: false, logisticModel: 'Stock', availableAmount: 100,
  availableDate: null, closingTime: null, fetchedAt: '', ...o,
});

describe('packPrice', () => {
  it('multiplies the per-kg price of KG products by the piece weight', () => {
    expect(packPrice(chickenKg, price())).toEqual({ unitPrice: 37.4, unitPriceWithTax: 42.46 });
  });
  it('keeps the sales-unit price for other products', () => {
    expect(packPrice(riceBox, price({ price: 11.9, priceWithTax: 13.51 }))).toEqual({ unitPrice: 11.9, unitPriceWithTax: 13.51 });
  });
  it('is null when the price is missing or failed', () => {
    expect(packPrice(riceBox, undefined)).toEqual({ unitPrice: null, unitPriceWithTax: null });
    expect(packPrice(chickenKg, price({ ok: false }))).toEqual({ unitPrice: null, unitPriceWithTax: null });
  });
});

describe('availablePacks', () => {
  it('converts kg stock to pieces for KG products', () => {
    expect(availablePacks(chickenKg, avail({ availableAmount: 20 }))).toBe(4);
    expect(availablePacks(riceBox, avail({ availableAmount: 20 }))).toBe(20);
    expect(availablePacks(riceBox, avail({ availableAmount: null }))).toBeNull();
  });
});

describe('stockTags', () => {
  it('tags stock, Terminal, shortfalls and unreliable suppliers', () => {
    expect(stockTags(riceBox, avail(), 3)).toEqual(['in_stock']);
    expect(stockTags(riceBox, avail({ logisticModel: 'Terminal', availableAmount: null }), 3)).toEqual(['supplier_delivered']);
    expect(stockTags(chickenKg, avail({ availableAmount: 10 }), 5)).toEqual(['in_stock', 'may_deliver_short']);
    expect(stockTags({ ...riceBox, reliability: 0.8 }, avail(), 1)).toEqual(['in_stock', 'may_deliver_short']);
    expect(stockTags(riceBox, avail({ deliverable: false }), 1)).toEqual(['unavailable']);
    expect(stockTags(riceBox, undefined, 1)).toEqual([]);
  });
});
