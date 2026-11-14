// Lookup: catalogue search, product details, and price + availability for a delivery date.
// Thin over src/catalog, src/valio and src/domain: no pricing or cut-off logic of its own.
import type { AllergenCheck, AvailabilityInfo, CatalogProduct, ISODate, PriceInfo, SearchHit, SearchQuery } from '@/contracts';
import { checkAllergens, getProduct, searchProducts } from '@/catalog';
import { getDb, type Db } from '@/db/client';
import { now as clockNow } from '@/db/repo';
import { deliverableOn, effectiveCutoff } from '@/domain/cutoff';
import { availablePacks, packPrice } from '@/mastra/pipeline/reprice';
import { getAvailability, getPrices } from '@/valio/client';
import type { PriceBasis, Requirements } from './types';

/** Valio reports "no stock limit" as very large amounts (999999, 9999999999). */
const UNLIMITED_AMOUNT = 999_999;
/** Older than the Valio cache TTL: only served when the refresh failed. */
export const STALE_PRICE_MS = 10 * 60 * 1000;

export function searchCatalog(q: SearchQuery): SearchHit[] {
  return searchProducts(q);
}

export function getProductDetails(id: string) {
  const product = getProduct(id);
  if (!product) return null;
  return { product, ingredientsText: product.keyIngredientsText ?? null };
}

export const soldByKg = (p: Pick<CatalogProduct, 'salesUnit' | 'packSize'>) => p.salesUnit.toUpperCase() === 'KG' && p.packSize > 0;

export function normaliseAvailability(a: AvailabilityInfo | undefined): AvailabilityInfo | undefined {
  if (!a || a.availableAmount === null || a.availableAmount < UNLIMITED_AMOUNT) return a;
  return { ...a, availableAmount: null };
}

export interface ProductPricing {
  currency: string;
  basis: PriceBasis;
  /** Price of ONE pack (the sales unit you order), excl. / incl. VAT. */
  pricePerPack: number | null;
  pricePerPackWithTax: number | null;
  /** Only for products Valio prices per kg (basis per_kg). */
  pricePerKg: number | null;
  pricePerKgWithTax: number | null;
  comparisonPrice: number | null;
  comparisonUnit: string | null;
  taxRate: number | null;
  fetchedAt: string;
  stale: boolean;
}

export interface ProductAvailability {
  deliverableOnDate: boolean;
  /** As Valio reports it: kg for products sold by the kg, packs otherwise; null = no stock limit reported. */
  availableAmount: number | null;
  availableAmountUnit: 'kg' | 'packs';
  availablePacks: number | null;
  availableDate: ISODate | null;
  logisticModel: 'Stock' | 'Terminal' | null;
  salesBlock: boolean;
  /** Order cut-off for delivery on the requested date (src/domain/cutoff). */
  cutoff: string | null;
  cutoffPassed: boolean;
  reason?: string;
}

export interface ProductQuote {
  productId: string;
  found: boolean;
  name: string | null;
  packDescription: string | null;
  packSize: number | null;
  packUnit: string | null;
  allowedLotSize: number | null;
  pricing: ProductPricing | null;
  availability: ProductAvailability | null;
  reliability: number | null;
  co2PerKg: number | null;
  allergens: CatalogProduct['allergens'];
  ingredientData: boolean;
  dietFlags: CatalogProduct['dietFlags'];
  /** Present when requirements were given. */
  allergenCheck?: AllergenCheck;
}

export function pricingFor(product: CatalogProduct, price: PriceInfo | undefined, realNowMs = Date.now()): ProductPricing | null {
  if (!price?.ok) return null;
  const { unitPrice, unitPriceWithTax } = packPrice(product, price);
  const kg = soldByKg(product);
  return {
    currency: price.currency,
    basis: kg ? 'per_kg' : 'per_pack',
    pricePerPack: unitPrice,
    pricePerPackWithTax: unitPriceWithTax,
    pricePerKg: kg ? price.price ?? null : null,
    pricePerKgWithTax: kg ? price.priceWithTax ?? null : null,
    comparisonPrice: price.comparisonPrice ?? null,
    comparisonUnit: price.comparisonUnit ?? null,
    taxRate: price.taxRate ?? null,
    fetchedAt: price.fetchedAt,
    stale: realNowMs - Date.parse(price.fetchedAt) > STALE_PRICE_MS,
  };
}

export function availabilityFor(product: CatalogProduct, raw: AvailabilityInfo | undefined, date: ISODate, nowMs: number): ProductAvailability {
  const a = normaliseAvailability(raw);
  const unit = soldByKg(product) ? 'kg' : 'packs';
  if (!a) {
    return {
      deliverableOnDate: false, availableAmount: null, availableAmountUnit: unit, availablePacks: null, availableDate: null,
      logisticModel: null, salesBlock: false, cutoff: null, cutoffPassed: false, reason: 'no availability data from Valio',
    };
  }
  const onDate = deliverableOn(a, date);
  const cutoff = effectiveCutoff(a, date);
  const cutoffPassed = !!cutoff && Date.parse(cutoff) < nowMs;
  let reason: string | undefined;
  if (a.salesBlock) reason = 'sales block';
  else if (!a.deliverable) reason = 'not deliverable';
  else if (!onDate) reason = `earliest delivery ${a.availableDate}`;
  else if (cutoffPassed) reason = `order cut-off ${cutoff} has passed`;
  return {
    deliverableOnDate: onDate && !cutoffPassed,
    availableAmount: a.availableAmount,
    availableAmountUnit: unit,
    availablePacks: availablePacks(product, a),
    availableDate: a.availableDate,
    logisticModel: a.logisticModel,
    salesBlock: a.salesBlock,
    cutoff,
    cutoffPassed,
    ...(reason ? { reason } : {}),
  };
}

/** Fresh Valio data for products on a date (cached up to 10 min by src/valio). */
export async function fetchValio(ids: string[], date: ISODate) {
  const [prices, avail] = await Promise.all([getPrices(ids, date), getAvailability(ids, date)]);
  return { prices, avail };
}

export async function getPriceAndAvailability(
  productIds: string[], date: ISODate, opts: { requirements?: Requirements; db?: Db } = {},
): Promise<{ date: ISODate; checkedAt: string; quotes: ProductQuote[] }> {
  const ids = [...new Set(productIds)];
  const known = ids.filter((id) => getProduct(id));
  const { prices, avail } = known.length ? await fetchValio(known, date) : { prices: new Map(), avail: new Map() };
  const nowMs = clockNow(opts.db ?? getDb()).getTime();
  const checks = opts.requirements ? new Map(checkAllergens(ids, opts.requirements).map((c) => [c.productId, c])) : null;
  const quotes = ids.map((id): ProductQuote => {
    const p = getProduct(id);
    if (!p) {
      return {
        productId: id, found: false, name: null, packDescription: null, packSize: null, packUnit: null, allowedLotSize: null,
        pricing: null, availability: null, reliability: null, co2PerKg: null, allergens: 'unknown', ingredientData: false, dietFlags: [],
      };
    }
    return {
      productId: id, found: true, name: p.nameEn || p.nameFi, packDescription: p.packDescription, packSize: p.packSize,
      packUnit: p.packUnit, allowedLotSize: p.allowedLotSize,
      pricing: pricingFor(p, prices.get(id)),
      availability: availabilityFor(p, avail.get(id), date, nowMs),
      reliability: p.reliability, co2PerKg: p.co2PerKg, allergens: p.allergens, ingredientData: p.ingredientData, dietFlags: p.dietFlags,
      ...(checks ? { allergenCheck: checks.get(id) } : {}),
    };
  });
  return { date, checkedAt: new Date(nowMs).toISOString(), quotes };
}
