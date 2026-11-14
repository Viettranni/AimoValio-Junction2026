import MiniSearch from 'minisearch';
import type { Allergen, AllergenCheck, CatalogProduct, DietFlag, SearchHit, SearchQuery } from '@/contracts';
import { allergenEvidence, dietContradicted } from './allergens';
import { loadCatalog } from './load';

interface Constraints { excludeAllergens?: Allergen[]; requireDiet?: DietFlag[] }

let index: MiniSearch<CatalogProduct> | null = null;

function getIndex(): MiniSearch<CatalogProduct> {
  if (!index) {
    index = new MiniSearch<CatalogProduct>({
      fields: ['nameFi', 'nameEn'],
      storeFields: [],
      idField: 'id',
      searchOptions: { prefix: true, boost: { nameEn: 1.1 } },
    });
    index.addAll(loadCatalog());
  }
  return index;
}

const byId = new Map<string, CatalogProduct>();
export function getProduct(id: string): CatalogProduct | undefined {
  if (byId.size === 0) for (const p of loadCatalog()) byId.set(p.id, p);
  return byId.get(id);
}

export function checkProduct(p: CatalogProduct | undefined, c: Constraints, productId = p?.id ?? ''): AllergenCheck {
  const exclude = c.excludeAllergens ?? [];
  const diets = c.requireDiet ?? [];
  if (!p) return { productId, verdict: 'unknown', conflicts: exclude, unmetDiets: diets };
  if (p.allergens === 'unknown') {
    return {
      productId,
      verdict: exclude.length || diets.length ? 'unknown' : 'pass',
      conflicts: exclude,
      unmetDiets: diets.filter((d) => !p.dietFlags.includes(d)),
      evidence: 'No ingredient data for this product',
    };
  }
  const known = p.allergens;
  const conflicts = exclude.filter((a) => known.includes(a));
  const unmetDiets = diets.filter((d) => !p.dietFlags.includes(d));
  const hardFail = conflicts.length > 0 || unmetDiets.some((d) => dietContradicted(d, known));
  const evidence = conflicts.length
    ? conflicts.map((a) => allergenEvidence(p.keyIngredientsText, a) ?? `contains ${a}`).join('; ')
    : undefined;
  if (hardFail) return { productId, verdict: 'fail', conflicts, unmetDiets, evidence };
  if (unmetDiets.length) return { productId, verdict: 'unknown', conflicts, unmetDiets, evidence };
  // Allergens read from the name alone prove nothing about what else is inside.
  if (!p.ingredientData && (exclude.length || diets.length)) {
    return { productId, verdict: 'unknown', conflicts: exclude, unmetDiets: diets, evidence: 'No ingredient list; allergens read from the product name only' };
  }
  return { productId, verdict: 'pass', conflicts, unmetDiets, evidence };
}

export function checkAllergens(ids: string[], constraints: Constraints): AllergenCheck[] {
  return ids.map((id) => checkProduct(getProduct(id), constraints, id));
}

/** Food-service pack sizes beat consumer packs; reliable suppliers get a nudge. */
function rank(score: number, p: CatalogProduct): number {
  let s = score;
  if (p.reliability !== null && p.reliability >= 0.95) s *= 1.15;
  if (p.packUnit !== 'pcs') s *= p.packSize >= 1 ? 1.1 : p.packSize < 0.5 ? 0.85 : 1;
  return s;
}

function runSearch(query: string, combineWith: 'AND' | 'OR') {
  return getIndex().search(query, {
    combineWith,
    fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
  });
}

export function searchProducts(q: SearchQuery): SearchHit[] {
  const limit = q.limit ?? 8;
  let raw = runSearch(q.query, 'AND');
  if (raw.length === 0) raw = runSearch(q.query, 'OR');

  const constrained = !!(q.excludeAllergens?.length || q.requireDiet?.length);
  const safe: SearchHit[] = [];
  const unverified: SearchHit[] = [];
  for (const r of raw.slice(0, 400)) {
    const product = getProduct(r.id);
    if (!product) continue;
    if (q.temperature && product.temperature !== q.temperature) continue;
    const reasons = [`name match: ${r.terms.join(' ')}`];
    if (product.reliability !== null && product.reliability >= 0.95) reasons.push('reliable delivery');
    const hit: SearchHit = { product, score: rank(r.score, product), reasons };
    if (!constrained) { safe.push(hit); continue; }
    const verdict = checkProduct(product, q).verdict;
    if (verdict === 'pass') safe.push(hit);
    else if (verdict === 'unknown') unverified.push({ ...hit, reasons: [...reasons, 'allergens unverified: no ingredient data'] });
  }
  const pool = safe.length > 0 ? safe : unverified;
  return pool.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function getAlternatives(productId: string, limit = 5): SearchHit[] {
  const source = getProduct(productId);
  if (!source) return [];
  const hits = runSearch(source.nameEn, 'OR')
    .map((r) => ({ product: getProduct(r.id), score: r.score }))
    .filter((h): h is { product: CatalogProduct; score: number } => !!h.product && h.product.id !== productId);
  const sameCategory = hits.filter((h) => h.product.category === source.category);
  const pool = sameCategory.length >= limit ? sameCategory : hits;
  return pool
    .map((h) => ({ product: h.product, score: rank(h.score, h.product), reasons: [`similar to ${source.nameEn}`] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
