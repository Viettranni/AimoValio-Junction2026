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

/**
 * A product serves the same function as the component (a fair substitute): its name contains one of the
 * component's search words (substring, so Finnish compounds like "jasmiiniriisi" match "riisi"), or it is in
 * the same Valio category as the original pick. It must also be sold in the component's unit when the
 * original was, so a dessert by the kg is never replaced by bars by the piece.
 */
export function sameKind(c: MenuComponent, original: CatalogProduct, candidate: CatalogProduct): boolean {
  if (original.packUnit === c.requiredUnit && candidate.packUnit !== c.requiredUnit) return false;
  if (candidate.category === original.category) return true;
  const name = `${candidate.nameFi} ${candidate.nameEn}`.toLowerCase();
  return keyTokens(c).some((t) => name.includes(t));
}
