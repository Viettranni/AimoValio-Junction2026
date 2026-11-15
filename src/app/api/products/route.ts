// Catalogue browse for the Products tab: search hits with today's fixed price per pack when Valio answers.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPriceAndAvailability, searchCatalog } from '@/gateway/lookup';
import { failure, parseQuery } from '../http';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().trim().max(120).default(''),
  n: z.coerce.number().int().min(1).max(36).default(24),
});

/** Next weekday (Mon–Fri) after today, as YYYY-MM-DD: the earliest normal delivery day. */
function nextDeliveryDay(now = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** GET /api/products?q=maito&n=24 */
export async function GET(req: Request) {
  const parsed = parseQuery(req, querySchema);
  if ('error' in parsed) return parsed.error;
  const { q, n } = parsed.data;
  try {
    const hits = searchCatalog({ query: q || 'maito', limit: n });
    const date = nextDeliveryDay();
    const quotes = await getPriceAndAvailability(hits.map((h) => h.product.id), date)
      .then((r) => new Map(r.quotes.map((x) => [x.productId, x])))
      .catch(() => null);
    const products = hits.map(({ product: p }) => {
      const quote = quotes?.get(p.id);
      return {
        id: p.id,
        name: p.nameEn || p.nameFi,
        nameFi: p.nameFi,
        packDescription: p.packDescription,
        vendor: p.vendor,
        temperature: p.temperature,
        allergensKnown: p.allergens !== 'unknown' && p.ingredientData,
        price: quote?.pricing?.pricePerPack ?? null,
        inStock: quote?.availability ? quote.availability.deliverableOnDate && !quote.availability.salesBlock : null,
        supplierDelivered: quote?.availability?.logisticModel === 'Terminal',
      };
    });
    return NextResponse.json({ date, live: quotes !== null, products });
  } catch (e) {
    return failure(e);
  }
}
