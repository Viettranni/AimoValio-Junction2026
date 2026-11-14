import type { CatalogProduct } from '@/contracts';
import { shortName } from '@/ui/productName';
import { interleave, mixGroups, shelfGroup, supplierLabel, uniqueByName, type ShelfProduct } from '@/ui/shelf';
import { searchProducts } from './search';

/** Food-service staples rolled when the conversation has no menu yet. */
export const STAPLE_TERMS = [
  'chicken breast', 'jasmine rice', 'cooking cream', 'potato', 'rapeseed oil',
  'butter', 'salad mix', 'wheat flour', 'tomato', 'pasta', 'cheese', 'onion',
];

const MAX_TERMS = 8;
const CACHE_MAX = 100;
const cache = new Map<string, ShelfProduct[]>();

function nameFor(p: CatalogProduct, lang: string | undefined): string {
  if (lang === 'fi' && p.nameFi) return p.nameFi;
  if (lang === 'sv' && p.nameSv) return p.nameSv;
  return p.nameEn;
}

function toShelf(p: CatalogProduct, lang: string | undefined): ShelfProduct {
  return {
    id: p.id,
    displayName: shortName(nameFor(p, lang)),
    packDescription: p.packDescription || undefined,
    // Groups read the English name: the pictogram rules know it best.
    group: shelfGroup(`${p.nameEn} ${p.nameFi}`),
    supplier: supplierLabel(p.vendor),
  };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Search hits whose name really contains the term: fuzzy search is right for typos in a request, but in a
 * roll "rice" turning into "costa rica" looks careless. Falls back to the plain hits when too few are left.
 */
function relevant(query: string, limit: number): CatalogProduct[] {
  const hits = searchProducts({ query, limit: limit * 4 }).map((h) => h.product);
  const words = query.split(/\s+/).filter(Boolean).map((w) => new RegExp(`(?:^|[^\\p{L}])${escape(w)}`, 'iu'));
  const named = hits.filter((p) => !/^\d/.test(p.nameEn) && words.every((re) => re.test(p.nameEn) || re.test(p.nameFi)));
  return (named.length >= Math.min(3, limit) ? named : hits).slice(0, limit);
}

/**
 * Up to `n` catalogue products relevant to the terms (round-robin across terms so every dish shows up),
 * topped up with staples. Display fields only; nothing here is a price or stock claim.
 */
export function sampleProducts(terms: string[], n: number, lang?: string): ShelfProduct[] {
  const key = `${lang ?? 'en'}|${n}|${terms.join('|')}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const own = terms.slice(0, MAX_TERMS);
  const perTerm = Math.max(3, Math.ceil(n / Math.max(own.length, 1)) + 2);
  const lists = own.map((query) => relevant(query, perTerm).map((p) => toShelf(p, lang)));
  let products = uniqueByName(interleave(lists));
  if (products.length < n) {
    const staples = STAPLE_TERMS.map((query) => relevant(query, 2).map((p) => toShelf(p, lang)));
    products = uniqueByName([...products, ...mixGroups(interleave(staples))]);
  }
  const out = (own.length ? products : mixGroups(products)).slice(0, n);

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
