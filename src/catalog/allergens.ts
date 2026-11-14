import type { Allergen, DietFlag } from '@/contracts';

/**
 * Keyword rules per allergen (EN + FI + SV: the catalogue mixes languages).
 * Matching is case-insensitive and substring-based so Finnish compounds such as
 * "täysMAITOjauhe" are caught; `strip` removes look-alikes first ("maitohappo" = lactic acid).
 */
const RULES: Record<Allergen, RegExp> = {
  gluten: /(?<![a-zäöå])(wheat|barley|rye|oats?|spelt|kamut|triticale|semolina|durum|gluten)|vehnä|vetemj|ohra|ruis|kaura|speltti|gluteen|(?<![a-zäöå])(vete|korn|råg|havre|glutenet)/i,
  crustaceans: /crustacean|shrimp|prawn|crab|lobster|crayfish|krill|shellfish|katkarap|(?<![a-zäöå])rapu|rapuja|taskurap|hummeri|äyriäis|räk|krabba|hummer|kräft|skaldjur/i,
  egg: /(?<![a-z])eggs?(?![a-z])|egg ?(yolk|white|powder)|yolk|albumen|muna|munia|(?<![a-zäöå])ägg|kananmun/i,
  fish: /(?<![a-z])(fish|salmon|tuna|cod(?![a-z])|herring|anchov\w*|trout|pike(?![a-z])|perch(?![a-z])|whitefish|mackerel|sardines?|haddock|pollock|surimi|eel(?![a-z])|roach(?![a-z])|vendace|burbot|roe(?![a-z])|lota lota|kaviaari|caviar)|(?<![a-zäöå])kala(?![a-zäöå])|kalaa|kalan|kalaf|lohi|tonnikala|silakka|(?<![a-zäöå])ahven|(?<![a-zäöå])(?:särki|särjen|särke|mäti|kutu|kampela|hauki|hauen|silli|kilohaili|lota)(?![a-zäöå])|gädda|abborre|strömming|siklöja|mört|(?<![a-zäöå])rom(?![a-zäöå])|(?<![a-zäöå])kuha|siika|muikku|anjovis|turska|(?<![a-zäöå])fisk|(?<![a-zäöå])lax(?![a-zäöå])|torsk|(?<![a-zäöå])sill(?![a-zäöå])|tonfisk/i,
  peanut: /peanut|groundnut|arachis|maapähkin|jordnöt/i,
  soy: /(?<![a-z])soy|soija|(?<![a-zäöå])soja/i,
  milk: /(?<![a-z])(milk|whey|lactose|casein|cream|butter|cheese|yog[h]?urt|curd|kefir)|maito|maidos|maidon|maidot|kerma|juusto|herajauhe|heraproteiin|laktoosi|kaseiini|jogurtti|rahka|viili|voiöljy|(?<![a-zäöå])voi(?=\s*(?:[,;()./%]|\d|$))|mjölk|grädde|(?<![a-zäöå])smör|vassle|laktos/i,
  nuts: /(?<![a-z])(almonds?|hazelnuts?|walnuts?|cashews?|pecans?|pistachios?|macadamia|brazil nuts?|tree nuts?|nuts)(?![a-z])|mantel|hasselpähkin|saksanpähkin|pähkin|pistaasi|pekaani|hasselnöt|valnöt|(?<![a-zäöå])nötter|mandel/i,
  celery: /celery|selleri/i,
  mustard: /mustard|sinappi|senap/i,
  sesame: /sesame|seesami|sesam/i,
  sulphites: /sulphite|sulfite|sulphur dioxide|sulfur dioxide|sulfiit|rikkidioksidi|svaveldioxid|sulfit|(?<![a-z0-9])e22[0-8](?![0-9])/i,
  lupin: /lupin/i,
  molluscs: /mollus|mussel|oyster|squid|octopus|clams?(?![a-z])|scallop|escargot|cockle|whelk|simpukka|osteri|mustekala|kalmari|mussla|ostron|bläckfisk/i,
};

/** Phrases that contain an allergen keyword but are not the allergen. */
const STRIP =
  /maitohappo|mjölksyra|lactic acid|milk thistle|(coconut|kookos)[ -]?(milk|maito|maid\w*|mjölk)|kookosmaito|kookosmaid\w*|cocoa butter|kaakaovoi|shea butter|sheavoi|peanut butter|kookospähkin\w*|coconut|muskottipähkin\w*|nutmeg|eggplant|aubergine|munakoiso|munuais\w*|kalamata|(?<![a-zäöå])mustekala|bläckfisk|lactose[- ]free|laktoositon|gluten[- ]?free|gluteenit\w*|glutenfri\w*|laktosfri|juustokumina|maitoherkku\w*|ei sisällä gluteenia|ruiskuk\w*|buttercup|butternut|buckwheat|mallasjuoma/gi;

// Finnish "MADE" (burbot) is only trusted in capitals: English "made" is everywhere.
const CAPS_ONLY: Partial<Record<Allergen, RegExp>> = { fish: /(?<![A-Za-zÄÖÅäöå])MADE(?![A-Za-zÄÖÅäöå])/ };

const PEANUT_STRIP = /peanut|groundnut|maapähkin\w*|jordnöt\w*/gi;

export function parseAllergens(
  keyIngredientsText: string | undefined,
  ingredientNames: string[],
): Allergen[] | 'unknown' {
  const text = [keyIngredientsText ?? '', ...ingredientNames].join(' ; ').trim();
  if (!text.replace(/[;\s]/g, '')) return 'unknown';
  const cleaned = text.replace(STRIP, ' ');
  const found: Allergen[] = [];
  for (const allergen of Object.keys(RULES) as Allergen[]) {
    // "peanut" must not also trigger the tree-nut rule via "nut"
    const haystack = allergen === 'nuts' ? cleaned.replace(PEANUT_STRIP, ' ') : cleaned;
    if (RULES[allergen].test(haystack) || CAPS_ONLY[allergen]?.test(haystack)) found.push(allergen);
  }
  return found;
}

/** First quoted snippet of the text that triggered `allergen`, for audit evidence. */
export function allergenEvidence(text: string | undefined, allergen: Allergen): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(STRIP, (m) => ' '.repeat(m.length));
  const haystack = allergen === 'nuts' ? cleaned.replace(PEANUT_STRIP, (m) => ' '.repeat(m.length)) : cleaned;
  const match = RULES[allergen].exec(haystack) ?? CAPS_ONLY[allergen]?.exec(haystack);
  if (!match) return undefined;
  const from = Math.max(0, match.index - 30);
  const to = Math.min(text.length, match.index + match[0].length + 30);
  return `${from > 0 ? '...' : ''}${text.slice(from, to).trim()}${to < text.length ? '...' : ''}`;
}

const ANIMAL_ALLERGENS: Allergen[] = ['milk', 'egg', 'fish', 'crustaceans', 'molluscs'];
const CLAIMS: Record<DietFlag, RegExp> = {
  lactose_free: /lactose[- ]?free|laktoositon|laktosfri|(?<![a-zäöå])hyla(?![a-zäöå])/i,
  gluten_free: /gluten[- ]?free|gluteeniton|glutenfri/i,
  vegan: /(?<![a-z])vegan|vegaani|växtbaserad|plant[- ]based|kasvipohjai/i,
  vegetarian: /vegetarian|vegetaari|kasvis(?!liemi)/i,
};

/** Diets a product demonstrably satisfies; a name claim counts unless known allergens contradict it. */
export function deriveDietFlags(p: {
  nameEn: string;
  nameFi: string;
  allergens: Allergen[] | 'unknown';
  /** false when allergens came only from the product name: then only explicit name claims count. */
  ingredientData?: boolean;
}): DietFlag[] {
  const names = `${p.nameEn} ${p.nameFi}`;
  const known = p.allergens === 'unknown' ? null : p.allergens;
  const proven = known !== null && p.ingredientData !== false;
  const has = (a: Allergen) => known?.includes(a) ?? false;
  const flags: DietFlag[] = [];

  // Lactose-free dairy still contains milk protein: the claim stands (a milk allergy is checked separately).
  if (CLAIMS.lactose_free.test(names) || (proven && !has('milk'))) flags.push('lactose_free');
  if (!has('gluten') && (CLAIMS.gluten_free.test(names) || proven)) flags.push('gluten_free');

  const animal = ANIMAL_ALLERGENS.some(has);
  const vegan = CLAIMS.vegan.test(names) && !animal;
  if (vegan) flags.push('vegan');
  const seafood = has('fish') || has('crustaceans') || has('molluscs');
  if (vegan || (CLAIMS.vegetarian.test(names) && !seafood)) flags.push('vegetarian');
  return flags;
}

const SALES_NOTE = /myyntier|laatikko|pakkaus|förpackning|säljenhet|sold in|per box|kg:n|\bbox\b/i;

/** Real ingredient lists have separators or percentages; sales/packaging notes do not. */
export function looksLikeIngredientList(text: string): boolean {
  const t = text.trim();
  if (!t || SALES_NOTE.test(t)) return false;
  if (/[,;%()]/.test(t)) return true;
  const found = parseAllergens(t, []);
  return t.length >= 12 || (found !== 'unknown' && found.length > 0);
}

/**
 * Allergens from ingredient texts (one per language) plus the product names.
 * Without a real ingredient list the result is 'unknown' unless a name alone reveals an allergen;
 * `ingredientData` tells callers whether the answer rests on an ingredient list.
 */
export function deriveAllergens(
  keyTexts: string[],
  ingredientNames: string[],
  names: string[],
): { allergens: Allergen[] | 'unknown'; ingredientData: boolean } {
  const ingredientData = ingredientNames.length > 0 || keyTexts.some(looksLikeIngredientList);
  const fromNames = parseAllergens(names.join(' ; '), []);
  const named = fromNames === 'unknown' ? [] : fromNames;
  if (!ingredientData) return { allergens: named.length ? named : 'unknown', ingredientData: false };
  const fromText = parseAllergens(keyTexts.filter(looksLikeIngredientList).join(' ; '), ingredientNames);
  const text = fromText === 'unknown' ? [] : fromText;
  return { allergens: [...new Set([...text, ...named])], ingredientData: true };
}

/** Whether a known allergen set rules out a diet outright (as opposed to merely not proving it). */
export function dietContradicted(diet: DietFlag, allergens: Allergen[]): boolean {
  switch (diet) {
    case 'gluten_free': return allergens.includes('gluten');
    case 'lactose_free': return allergens.includes('milk');
    case 'vegan': return ANIMAL_ALLERGENS.some((a) => allergens.includes(a));
    case 'vegetarian': return ['fish', 'crustaceans', 'molluscs'].some((a) => allergens.includes(a as Allergen));
  }
}
