import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sampleProducts } from '@/catalog/sample';
import { parseSampleQuery } from '@/ui/shelf';
import { failure, parseQuery } from '../../http';

const querySchema = z.object({
  /** Space- or comma-separated dishes, e.g. "chicken rice"; empty gives food-service staples. */
  q: z.string().max(200).default(''),
  n: z.coerce.number().int().min(1).max(48).default(24),
  lang: z.enum(['en', 'fi', 'sv']).optional(),
});

/** GET /api/catalog/sample?q=chicken%20rice&n=24 — products for the "browsing the shelves" loaders. */
export async function GET(req: Request) {
  const parsed = parseQuery(req, querySchema);
  if ('error' in parsed) return parsed.error;
  const { q, n, lang } = parsed.data;
  try {
    const products = sampleProducts(parseSampleQuery(q), n, lang);
    return NextResponse.json({ products }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e) {
    return failure(e);
  }
}
