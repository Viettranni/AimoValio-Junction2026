// The ONE mapper from this project's orders (src/db/schema.ts: orders, order_lines, leftovers) to `line` rows.
// Fields this project does not record stay null.
import { weekdayName } from './dates';
import { CATEGORY_CODE_FI, fiProduct, PROJECT_EVENT_TYPE_FI, STORAGE_FI } from './fi';
import { round } from './math';
import type { LineRow } from './schema';

export interface ProjectOrderLine {
  id: string;
  productId: string;
  productName: string;
  /** Portion category, e.g. poultry_main. */
  category: string;
  packs: number;
  quantity: number;
  /** Unit of `quantity`: kg, l or pcs. */
  unit: string;
  /** Per pack, excl. VAT. */
  unitPrice: number;
}

export interface ProjectOrder {
  id: string;
  customerId: string;
  eventName: string;
  eventType: string;
  deliveryDate: string;
  guests: number;
  lines: ProjectOrderLine[];
}

export interface ProjectLeftover {
  orderId: string;
  lineId: string;
  orderedQty: number;
  leftoverQty: number;
}

/** What the catalogue knows about a product; null when the product is not in the catalogue. */
export interface ProductFacts {
  vendor: string | null;
  temperature: string;
  co2PerKg: number | null;
}


function storage(temperature: string | undefined): string | null {
  if (temperature === 'chilled') return STORAGE_FI.chilled;
  if (temperature === 'frozen' || temperature === 'ambient') return STORAGE_FI.ambient;
  return null;
}

export function toLineRows({ orders, leftovers, productFacts }: {
  orders: ProjectOrder[];
  leftovers: ProjectLeftover[];
  productFacts: (productId: string) => ProductFacts | null;
}): LineRow[] {
  const left = new Map(leftovers.map((l) => [`${l.orderId}|${l.lineId}`, l]));
  return orders.flatMap((o) => o.lines.map((ln): LineRow => {
    const facts = productFacts(ln.productId);
    const value = round({ v: ln.packs * ln.unitPrice, places: 2 });
    const kg = ln.unit === 'kg' || ln.unit === 'l' ? round({ v: ln.quantity, places: 2 }) : null;
    const lo = left.get(`${o.id}|${ln.id}`);
    const used = lo && lo.orderedQty > 0 ? Math.min(1, 1 - lo.leftoverQty / lo.orderedQty) : null;
    return {
      order_id: o.id,
      order_type: 'event',
      buyer_id: o.customerId,
      site_id: null,
      site_name: null,
      date: o.deliveryDate,
      month: o.deliveryDate.slice(0, 7),
      weekday: weekdayName(o.deliveryDate),
      event_id: o.id,
      event_type: PROJECT_EVENT_TYPE_FI[o.eventType] ?? o.eventType,
      event_name: o.eventName,
      guests: o.guests,
      product: fiProduct(ln.productName),
      product_key: ln.productId,
      category: CATEGORY_CODE_FI[ln.category] ?? ln.category,
      brand: facts?.vendor || null,
      temp: storage(facts?.temperature),
      qty: ln.packs,
      unit: 'laatikko',
      unit_price: ln.unitPrice,
      value_eur: value,
      kg,
      co2e_kg: kg !== null && facts?.co2PerKg != null ? round({ v: kg * facts.co2PerKg, places: 2 }) : null,
      on_time: null,
      used_pct: used === null ? null : round({ v: used, places: 3 }),
      waste_eur: used === null ? null : round({ v: value * (1 - used), places: 2 }),
      label: used === null ? null : used >= 0.9 ? 'right_sized' : 'over_ordered',
    };
  }));
}
