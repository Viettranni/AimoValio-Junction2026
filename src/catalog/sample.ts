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

/** Joining words inside a menu chip ("chicken and rice", "kana ja riisi"): the chip is really two dishes. */
const JOINERS = /\s*(?:&|\+|\/|,|\band\b|\bwith\b|\bja\b|\boch\b|\bmed\b)\s*/iu;
const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'for', 'some', 'fresh', 'sm', 'en']);

/**
 * Snacks, sweets and ready meals: real catalogue products, but in a roll for "chicken" or "rice" they read as
 * careless ("Rice Krispies", "Chicken Kiev"). Kept only when the buyer's own term asks for one of them.
 */
const OFF_TOPIC = [
  'pie', 'kiev', 'krispies', 'cookie', 'biscuit', 'candy', 'chocolate', 'snack', 'nugget', 'ice cream', 'ready meal',
  'pudding', 'porridge', 'wrap', 'burger', 'pizza', 'grandiosa', 'chips', 'crisps', 'dumpling', 'gyoza', 'sushi',
  'cake', 'waffle', 'cereal', 'sweet', 'dessert', 'lasagne', 'casserole', 'sandwich', 'kebab', 'bun', 'slider',
  'toast', 'pop', 'bites', 'mac', 'pringles', 'peanut', 'drip',
];

/** Whole word, optional English plural, Unicode-aware (so "rice" is not "costa rica" nor "licorice"). */
const wholeWord = (word: string) => new RegExp(`(?:^|[^\\p{L}])${escape(word)}(?:s|es)?(?![\\p{L}])`, 'iu');

/** A menu chip as one or more searchable dishes, each a list of content words. */
export function dishesOf(term: string): string[][] {
  return term
    .split(JOINERS)
    .map((part) => part.toLowerCase().split(/\s+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w)))
    .filter((words) => words.length > 0);
}

/**
 * Catalogue products that really are the dish: every content word matches a whole word of the name, nothing
 * off-topic, and only the one or two Valio categories the best matches come from (so "chicken" stays with
 * chicken meat rather than chicken-flavoured soups). No fuzzy fallback: fewer is better than wrong; the
 * staples top-up fills the roll.
 */
export function relevant(words: string[], limit: number): CatalogProduct[] {
  const res = words.map(wholeWord);
  const asked = words.join(' ');
  const offTopic = OFF_TOPIC.filter((w) => !asked.includes(w)).map(wholeWord);
  const hits = searchProducts({ query: words.join(' '), limit: 120 })
    .map((h) => h.product)
    .filter((p) => !/^\d/.test(p.nameEn))
    .filter((p) => res.every((re) => re.test(p.nameEn) || re.test(p.nameFi)))
    .filter((p) => !offTopic.some((re) => re.test(p.nameEn)));
  const counts = new Map<string, number>();
  for (const p of hits.slice(0, 5)) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  const keep = new Set(ranked.filter(([, c], i) => i === 0 || (i === 1 && c >= 2)).map(([cat]) => cat));
  return hits.filter((p) => keep.has(p.category)).slice(0, limit);
}

/**
 * Up to `n` catalogue products relevant to the terms (round-robin across terms so every dish shows up),
 * topped up with staples. Display fields only; nothing here is a price or stock claim.
 */
export function sampleProducts(terms: string[], n: number, lang?: string): ShelfProduct[] {
  const key = `${lang ?? 'en'}|${n}|${terms.join('|')}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const own = terms.flatMap(dishesOf).slice(0, MAX_TERMS);
  const perTerm = Math.max(3, Math.ceil(n / Math.max(own.length, 1)) + 2);
  const lists = own.map((words) => relevant(words, perTerm).map((p) => toShelf(p, lang)));
  let products = uniqueByName(interleave(lists));
  if (products.length < n) {
    const staples = STAPLE_TERMS.map((query) => relevant(dishesOf(query)[0], 2).map((p) => toShelf(p, lang)));
    products = uniqueByName([...products, ...mixGroups(interleave(staples))]);
  }
  const out = (own.length ? products : mixGroups(products)).slice(0, n);

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
