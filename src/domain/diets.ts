import type { Allergen, DietFlag, DietKind, DietNeed, Intake } from '@/contracts';

const DIET_FLAGS: ReadonlySet<string> = new Set<DietFlag>(['lactose_free', 'gluten_free', 'vegan', 'vegetarian']);
export const isDietFlag = (d: DietKind): d is DietFlag => DIET_FLAGS.has(d);

// ── Coverage (one-way) ──

/** Flags whose own ingredient rules guarantee another diet flag (one-way). */
const FLAG_COVERED_BY: Record<DietFlag, DietFlag[]> = {
  gluten_free: ['gluten_free'],
  lactose_free: ['lactose_free', 'vegan'],
  vegetarian: ['vegetarian', 'vegan'],
  vegan: ['vegan'],
};
/** An excluded allergen that is enough for a diet flag. Never for vegan/vegetarian (other animal ingredients). */
const FLAG_COVERED_BY_EXCLUSION: Partial<Record<DietFlag, Allergen>> = { gluten_free: 'gluten', lactose_free: 'milk' };
/** Allergens a diet flag guarantees absent. Lactose-free dairy still contains milk protein, so lactose_free covers none. */
const FLAG_EXCLUDES: Record<DietFlag, Allergen[]> = {
  gluten_free: ['gluten'],
  lactose_free: [],
  vegan: ['milk', 'egg', 'fish', 'crustaceans', 'molluscs'],
  vegetarian: ['fish', 'crustaceans', 'molluscs'],
};

export interface DietConstraints { requiredDiet?: DietFlag[] | null; excludeAllergens?: Allergen[] | null }

/** Whether food made to these constraints safely serves guests with this need (never inferred backwards). */
export function dietCovers(c: DietConstraints, need: DietKind): boolean {
  const flags = c.requiredDiet ?? [];
  const excluded = c.excludeAllergens ?? [];
  if (isDietFlag(need)) {
    const byExclusion = FLAG_COVERED_BY_EXCLUSION[need];
    return FLAG_COVERED_BY[need].some((f) => flags.includes(f)) || (!!byExclusion && excluded.includes(byExclusion));
  }
  return excluded.includes(need) || flags.some((f) => FLAG_EXCLUDES[f].includes(need));
}

// ── Asking for counts ──

export interface DietCountOption { kind: 'count' | 'share' | 'all'; guests: number }

const FIXED_COUNTS = [5, 10, 20];
const SHARE = 0.1;

/** Quick-pick guest counts for one diet: 5 / 10 / 20 (below the total), about 10 %, and everyone. */
export function dietCountOptions(guests: number): DietCountOption[] {
  if (!(guests >= 1)) return [];
  const fixed = FIXED_COUNTS.filter((n) => n < guests).map((n): DietCountOption => ({ kind: 'count', guests: n }));
  const share = Math.max(1, Math.round(guests * SHARE));
  const withShare = share < guests && !fixed.some((o) => o.guests === share) ? [...fixed, { kind: 'share' as const, guests: share }] : fixed;
  return [...withShare, { kind: 'all', guests }];
}

const ABOUT = '(?:about|approx\\.?|around|ca\\.?|noin|n\\.|ungefär|cirka|runt)';
const GUESTS = '(?:guests?|people|persons?|vierasta|vieras|henkeä|henkilöä|gäster|gäst|personer)';
const ALL = '(?:all|everyone|everybody|all of them|kaikki|kaikille|alla)';
const COUNT_RE = new RegExp(`^${ABOUT}?\\s*(\\d+)\\s*${GUESTS}?$`, 'i');
const SHARE_RE = new RegExp(`^${ABOUT}?\\s*(\\d+(?:[.,]\\d+)?)\\s*%(?:\\s*\\((\\d+)\\))?\\s*${GUESTS}?$`, 'i');
const ALL_RE = new RegExp(`^${ALL}(?:\\s+(\\d+))?\\s*${GUESTS}?$`, 'i');

/**
 * The guest count in a reply that is only a count ("12", "12 guests", "About 10% (12)", "All 120", "everyone"),
 * capped at the guest total. Anything else is null and goes to the intake agent.
 */
export function parseDietCount(text: string, guests: number): number | null {
  const s = text.trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  if (!s || !(guests >= 1)) return null;
  let n: number | null = null;
  const share = SHARE_RE.exec(s);
  const count = COUNT_RE.exec(s);
  if (share) n = share[2] ? Number(share[2]) : Math.round((guests * Number(share[1].replace(',', '.'))) / 100) || 1;
  else if (count) n = Number(count[1]);
  else if (ALL_RE.test(s)) n = guests;
  if (n === null || !(n >= 1)) return null;
  return Math.min(n, guests);
}

// ── Merging what the buyer said ──

export interface DietStatement {
  /** Counted diets in this message (guests 0 = withdrawn), or "none". */
  diets: DietNeed[] | 'none' | null;
  /** Diets named without a count. */
  named: DietKind[] | null;
}

type DietSlots = Pick<Intake, 'diets' | 'dietsPending'>;

/** Folds a message's diets into the slots: counts merge by diet, uncounted diets wait for a count, "none" clears all. */
export function mergeDiets(current: DietSlots, x: DietStatement): DietSlots {
  if (x.diets === 'none') return { diets: 'none' };
  if (x.diets === null && !x.named?.length) {
    return {
      ...(current.diets !== undefined ? { diets: current.diets } : {}),
      ...(current.dietsPending?.length ? { dietsPending: current.dietsPending } : {}),
    };
  }
  const counts = new Map<DietKind, number>(Array.isArray(current.diets) ? current.diets.map((d) => [d.diet, d.guests]) : []);
  const withdrawn = new Set<DietKind>();
  for (const d of x.diets ?? []) {
    if (d.guests > 0) counts.set(d.diet, Math.round(d.guests));
    else { counts.delete(d.diet); withdrawn.add(d.diet); }
  }
  const pending = [...new Set([...(current.dietsPending ?? []), ...(x.named ?? [])])]
    .filter((d) => !counts.has(d) && !withdrawn.has(d));
  const out: DietSlots = {};
  if (counts.size) out.diets = [...counts].map(([diet, guests]) => ({ diet, guests }));
  else if (current.diets === 'none' && !pending.length && !withdrawn.size) out.diets = 'none';
  if (pending.length) out.dietsPending = pending;
  return out;
}

// ── Splitting quantities by diet ──

export interface SplitPlan extends DietConstraints { id: string; guests: number; dietVariantOf?: string | null }

/**
 * Sizes the menu by the buyer's diet counts: each diet variant serves the guests of the diets it covers,
 * and its base serves the rest. A variant (or set of variants) serving everyone is folded into its base,
 * which then carries the constraint for all guests (see applyDietRules). Variants for no stated diet keep
 * the menu agent's count.
 */
export function fitDietSplit<P extends SplitPlan>(
  plans: P[], diets: Intake['diets'], total: number | undefined,
): { plans: P[]; merged: string[] } {
  if (!Array.isArray(diets) || !diets.length || !total || total < 1) return { plans, merged: [] };
  const sized = plans.map((p) => {
    if (!p.dietVariantOf) return p;
    const covered = diets.filter((d) => dietCovers(p, d.diet));
    return covered.length ? { ...p, guests: Math.min(total, covered.reduce((s, d) => s + d.guests, 0)) } : p;
  });
  const variantsOf = (id: string) => sized.filter((v) => v.dietVariantOf === id);
  const merged = new Set<string>();
  for (const base of sized.filter((p) => !p.dietVariantOf)) {
    const variants = variantsOf(base.id);
    if (variants.length && variants.reduce((s, v) => s + v.guests, 0) >= total) variants.forEach((v) => merged.add(v.id));
  }
  const out = sized
    .filter((p) => !merged.has(p.id))
    .map((p) => {
      if (p.dietVariantOf) return p;
      const rest = total - variantsOf(p.id).filter((v) => !merged.has(v.id)).reduce((s, v) => s + v.guests, 0);
      return p.guests === rest ? p : { ...p, guests: rest };
    });
  return { plans: out, merged: [...merged] };
}
