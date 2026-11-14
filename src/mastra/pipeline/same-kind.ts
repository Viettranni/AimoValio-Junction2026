import type { CatalogProduct, MenuComponent } from '@/contracts';

// Diet, state and filler words say nothing about what the food is ("gluten-free breadcrumbs" vs "gluten-free pizza base").
const NOISE = new Set([
  'gluten', 'free', 'gluteeniton', 'glutenfri', 'lactose', 'laktoositon', 'laktosfri', 'vegan', 'vegaani', 'vegetarian',
  'kasvis', 'organic', 'luomu', 'fresh', 'tuore', 'frozen', 'pakaste', 'pakasteet', 'natural', 'luonnollinen', 'with',
  'and', 'ja', 'the', 'for', 'sliced', 'viipaloitu', 'whole', 'kokonainen', 'mild', 'mieto',
]);

function keyTokens(c: MenuComponent): string[] {
  return `${c.searchTerms.fi} ${c.searchTerms.en}`.toLowerCase()
    .split(/[^a-zåäö]+/).filter((t) => t.length >= 4 && !NOISE.has(t));
}

/** Snacks and ready meals are their own kind: never a stand-in for an ingredient (and vice versa). */
const SNACK = /snack|välipala|mellanmål|ready[ -]?meal|valmisruoka|färdigmat|pizza|pizzapohja/i;

/**
 * A product serves the same function as the component (a fair substitute): its name contains one of the
 * component's search words (substring, so Finnish compounds like "jasmiiniriisi" match "riisi"), or it is in
 * the same Valio category as the original pick. It must also be sold in the component's unit when the
 * original was, so a dessert by the kg is never replaced by bars by the piece.
 */
export function sameKind(c: MenuComponent, original: CatalogProduct, candidate: CatalogProduct): boolean {
  if (original.packUnit === c.requiredUnit && candidate.packUnit !== c.requiredUnit) return false;
  const terms = `${c.searchTerms.fi} ${c.searchTerms.en} ${c.label}`;
  const originalName = `${original.nameFi} ${original.nameEn}`.toLowerCase();
  const name = `${candidate.nameFi} ${candidate.nameEn}`.toLowerCase();
  if (SNACK.test(name) && !SNACK.test(terms) && !SNACK.test(originalName)) return false;
  if (candidate.category === original.category) return true;
  // The words that name what the original pick IS ("korppujauho" in "gluten-free breadcrumbs for chicken"),
  // not what it is for or which diet it suits; all search words only when none of them is in the original's name.
  const tokens = keyTokens(c);
  const anchored = tokens.filter((t) => originalName.includes(t));
  return (anchored.length ? anchored : tokens).some((t) => name.includes(t));
}

const words = (s: string) => s.toLowerCase().split(/[^a-zåäö]+/).filter((t) => t.length >= 4 && !NOISE.has(t));

/**
 * Whether `candidate` may replace `original` on a line the buyer asked to swap ("swap to basmati", "a lactose-free
 * cream sauce"). Stricter than sameKind, whose single shared word let a cream sauce become ice cream ("cream") or
 * soy sauce ("sauce") live: the candidate must be in the same category group as the original (first four digits of
 * Valio's category code), or its name must contain every key word the buyer asked for, in English or in Finnish.
 */
export function swapFits(original: CatalogProduct, candidate: CatalogProduct, request: { fi: string; en: string }): boolean {
  if (SNACK.test(`${candidate.nameFi} ${candidate.nameEn}`) && !SNACK.test(`${request.fi} ${request.en} ${original.nameFi} ${original.nameEn}`)) return false;
  if (original.category.length >= 4 && candidate.category.slice(0, 4) === original.category.slice(0, 4)) return true;
  const name = `${candidate.nameFi} ${candidate.nameEn}`.toLowerCase();
  return [words(request.en), words(request.fi)].some((ws) => ws.length > 0 && ws.every((w) => name.includes(w)));
}
