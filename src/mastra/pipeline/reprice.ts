import type { AvailabilityInfo, CatalogProduct, DraftLine, ISODate, LineTag, PriceInfo } from '@/contracts';
import { deliverableOn } from '@/domain/cutoff';

type PricedProduct = Pick<CatalogProduct, 'salesUnit' | 'packSize'>;

const STOCK_TAGS: ReadonlySet<LineTag> = new Set(['in_stock', 'supplier_delivered', 'may_deliver_short', 'unavailable']);
const RELIABILITY_WARNING = 0.9;

/** Valio prices and stocks KG products per kg; their packSize is the weight of one piece. */
const soldByKg = (p: PricedProduct) => p.salesUnit.toUpperCase() === 'KG' && p.packSize > 0;
const cents = (n: number) => Math.round(n * 100) / 100;

/** Price of ONE pack (sales unit as we order it), excl. and incl. VAT. */
export function packPrice(product: PricedProduct, price: PriceInfo | undefined) {
  const factor = soldByKg(product) ? product.packSize : 1;
  const per = (v: number | undefined) => (price?.ok && v !== undefined ? (factor === 1 ? v : cents(v * factor)) : null);
  return { unitPrice: per(price?.price), unitPriceWithTax: per(price?.priceWithTax) };
}

/** Available amount in packs, or null when unknown (Terminal). */
export function availablePacks(product: PricedProduct, availability: AvailabilityInfo | undefined): number | null {
  const amount = availability?.availableAmount;
  if (amount === null || amount === undefined) return null;
  return soldByKg(product) ? Math.floor(amount / product.packSize) : amount;
}

export function stockTags(
  product: PricedProduct & Pick<CatalogProduct, 'reliability'>, availability: AvailabilityInfo | undefined, packs: number,
  requestedDate: ISODate,
): LineTag[] {
  if (!availability) return [];
  if (!deliverableOn(availability, requestedDate)) return ['unavailable'];
  const tags: LineTag[] = [availability.logisticModel === 'Terminal' ? 'supplier_delivered' : 'in_stock'];
  const stock = availablePacks(product, availability);
  const unreliable = product.reliability !== null && product.reliability < RELIABILITY_WARNING;
  if (unreliable || (stock !== null && stock < packs)) tags.push('may_deliver_short');
  return tags;
}

/** Applies Valio price and stock data to a line: per-pack prices and stock tags. */
export function repriceLine(
  line: DraftLine, product: CatalogProduct, price: PriceInfo | undefined, availability: AvailabilityInfo | undefined,
  requestedDate: ISODate,
): DraftLine {
  const tags = [...line.tags.filter((t) => !STOCK_TAGS.has(t)), ...stockTags(product, availability, line.packs, requestedDate)];
  return { ...line, ...packPrice(product, price), tags, price, availability };
}
