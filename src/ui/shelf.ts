import type { Intake, ProgressEvent, ProgressStepId } from '@/contracts';

/** Pictogram families for the "browsing the shelves" loaders. */
export type ShelfGroup = 'poultry' | 'grains' | 'dairy' | 'veg' | 'pantry' | 'generic';

/** Display fields only: what /api/catalog/sample returns and what the loaders show. */
export interface ShelfProduct {
  id: string;
  displayName: string;
  packDescription?: string;
  group: ShelfGroup;
  /** Readable supplier name, e.g. "Atria Suomi". */
  supplier?: string;
}

/** What the loader under a planning step adds next to the rolling names. */
export type ShelfMode = 'browse' | 'search' | 'prices' | 'allergens';

/** Normal roll speed, and the slowest a reduced-motion line may change. */
export const ROLL_MS = 400;
export const REDUCED_ROLL_MS = 2000;
/** Screen readers hear at most one loader update this often. */
export const ANNOUNCE_MS = 3000;

/**
 * Word-start match for English (the end stays open for plurals), anywhere for Finnish, whose compounds put
 * the head word last ("rypsiöljy" is rapeseed oil). Unicode-aware for ä/ö.
 */
const words = (en: string, fi: string) => new RegExp(`(?:^|[^\\p{L}])(?:${en})|${fi}`, 'iu');

// Strong pantry words win over the main ingredient ("chicken bouillon" is a seasoning).
const PANTRY_STRONG = words('bouillon|stock|broth|fond|gravy|oil|vinegar|salt(?!\\p{L})|spice|seasoning', 'liemi|öljy|suola|mauste');
const POULTRY = words('chicken|broiler|turkey|duck|poultry', 'kana|broileri|kalkkuna|ankka');
const DAIRY = words('milk|cream|cheese|butter|yog(?:h)?urt|quark|crème|creme|smetana|valio|voi(?!\\p{L})', 'maito|kerma|juusto|rahka');
const GRAINS = words(
  'rice|pasta|macaroni|spaghetti|penne|noodle|flour|bread|roll|bun(?!\\p{L})|oat|barley|couscous|bulgur|quinoa|wheat|rye(?!\\p{L})',
  'riisi|jauho|leipä|sämpylä|kaura|ohra|makaroni',
);
const VEG = words(
  'potato|tomato|lettuce|salad|onion|carrot|cucumber|cabbage|broccoli|cauliflower|vegetable|veg(?!\\p{L})|herb|mushroom|peas|bean|lemon|apple|berr|fruit|iceberg|frisée|spinach|leek|garlic',
  'peruna|tomaatti|salaatti|sipuli|porkkana|kurkku|kaali|kasvis|sieni|herne|papu|marja|omena',
);
const PANTRY = words('sauce|sugar|pepper|mustard|ketchup|mayo|dressing|paste', 'kastike|sokeri|pippuri|sinappi');

/** Pictogram family from a product name (any of fi/en/sv catalogue spellings). */
export function shelfGroup(name: string): ShelfGroup {
  if (PANTRY_STRONG.test(name)) return 'pantry';
  if (POULTRY.test(name)) return 'poultry';
  if (DAIRY.test(name)) return 'dairy';
  if (GRAINS.test(name)) return 'grains';
  if (VEG.test(name)) return 'veg';
  if (PANTRY.test(name)) return 'pantry';
  return 'generic';
}

const LEGAL_WORDS = new Set(['OY', 'OYJ', 'AB', 'ABP', 'LTD', 'LIMITED', 'GMBH', 'AS', 'A/S', 'B.V.', 'BV', 'INC', 'SA', 'S.A.', 'TUORE', 'KUIVA', 'PAKASTE']);

/** "ATRIA SUOMI OY TUORE" → "Atria Suomi"; "DUNI OY, PROFESSIONAL" → "Duni". */
export function supplierLabel(vendor: string | undefined | null): string | undefined {
  if (!vendor) return undefined;
  const head = vendor.split(',')[0].trim().split(/\s+/);
  const legal = head.findIndex((w, i) => i > 0 && LEGAL_WORDS.has(w.toUpperCase()));
  const words = (legal > 0 ? head.slice(0, legal) : head).filter((w) => !LEGAL_WORDS.has(w.toUpperCase()));
  if (!words.length) return undefined;
  const label = words
    .map((w) => (w === w.toUpperCase() && w.length > 2 ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(' ');
  return label.length > 24 ? undefined : label;
}

/**
 * Search terms for the current conversation, from the intake menu chips: lower case, deduplicated,
 * sorted so the same menu always maps to the same cache key. Empty means "use the staples".
 */
export function sampleTerms(intake: Pick<Intake, 'menu'> | null | undefined, max = 6): string[] {
  const terms = (intake?.menu ?? [])
    .map((m) => m.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((m) => m.length >= 2);
  return [...new Set(terms)].sort().slice(0, max);
}

/** The sample endpoint's `q`: comma-separated dishes ("salmon fillet,potato"), or plain words ("chicken rice"). */
export function parseSampleQuery(q: string): string[] {
  const parts = /[,|]/.test(q) ? q.split(/[,|]/) : q.split(/\s+/);
  return sampleTerms({ menu: parts }, 8);
}

/** Cache key for a term set ("" for the staples). */
export const termsKey = (terms: string[]) => terms.join('|');

/** Round-robin across lists, so one long list does not fill the roll with eight chickens in a row. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) out.push(list[i]);
  return out;
}

/** First occurrence of each display name wins (catalogues list the same product in many pack sizes). */
export function uniqueByName<T extends { displayName: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((p) => {
    const key = p.displayName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Spreads groups through the roll, keeping each group's own order. */
export function mixGroups(items: ShelfProduct[]): ShelfProduct[] {
  const order: ShelfGroup[] = [];
  const byGroup = new Map<ShelfGroup, ShelfProduct[]>();
  for (const p of items) {
    if (!byGroup.has(p.group)) {
      byGroup.set(p.group, []);
      order.push(p.group);
    }
    byGroup.get(p.group)!.push(p);
  }
  return interleave(order.map((g) => byGroup.get(g)!));
}

/** Names only (planning ticker, fixture names) turned into rollable products. */
export function productsFromNames(names: string[]): ShelfProduct[] {
  return uniqueByName(names.filter(Boolean).map((name, i) => ({ id: `n-${i}`, displayName: name, group: shelfGroup(name) })));
}

/** Which item a roll shows at a tick; offsets let several rolls (skeleton rows) show different items. */
export function rollIndex(tick: number, length: number, offset = 0): number {
  if (length <= 0) return 0;
  return (((tick + offset) % length) + length) % length;
}

/** True when enough time has passed since the last accepted update (throttle gate for text and reduced motion). */
export function throttleOpen(lastAt: number | null, now: number, minMs: number): boolean {
  return lastAt === null || now - lastAt >= minMs;
}

/** How long to wait before a pending update may be shown. */
export function throttleWait(lastAt: number | null, now: number, minMs: number): number {
  return lastAt === null ? 0 : Math.max(0, minMs - (now - lastAt));
}

/** A price-shaped string that changes each tick: clearly "being worked out", never a real price. */
export function scramblePrice(tick: number, seed = 0): string {
  // Small LCG so the same tick always gives the same digits (stable in tests and across re-renders).
  const x = (Math.imul(tick + 1, 1103515245) + Math.imul(seed + 7, 12345)) >>> 0;
  const euros = 2 + (x % 48);
  const cents = (x >>> 8) % 100;
  return `${euros},${String(cents).padStart(2, '0')}`;
}

// ───────────── Planning progress ─────────────

/** The step that has started and not finished yet, if any. */
export function activeStep(events: ProgressEvent[]): ProgressStepId | null {
  const open = new Map<ProgressStepId, boolean>();
  for (const e of events) open.set(e.step, e.status === 'start');
  let active: ProgressStepId | null = null;
  for (const [step, isOpen] of open) if (isOpen) active = step;
  return active;
}

/** The planning run has produced its draft. */
export const runFinished = (events: ProgressEvent[]) => events.some((e) => e.step === 'draft' && e.status === 'done');

/** The roll under a checklist step; steps without products to show get none. */
export function shelfModeFor(step: ProgressStepId): ShelfMode | null {
  if (step === 'search') return 'search';
  if (step === 'prices') return 'prices';
  if (step === 'allergens') return 'allergens';
  return null;
}

/** Candidate names reported by the latest search step, for the steps after it. */
export function tickerOf(events: ProgressEvent[]): string[] | undefined {
  let ticker: string[] | undefined;
  for (const e of events) if (e.step === 'search' && e.ticker?.length) ticker = e.ticker;
  return ticker;
}

/**
 * Whether the chat shows the "browsing the shelves" card: the turn is quiet (no new progress for a
 * moment), no checklist step is rolling its own products, and the reply has not started streaming.
 * Between planning steps (the product agent thinking) the card fills the gap even if a sentence came first.
 */
export function showShelfCard({ events, replyText }: { events: ProgressEvent[]; replyText: string }): boolean {
  if (activeStep(events)) return false;
  if (events.length && !runFinished(events)) return true;
  return !replyText;
}

// ───────────── Tool calls in the stream ─────────────

interface ToolishPart {
  type: string;
  toolName?: string;
  state?: string;
}

/** True while the named tool has been called in this message and has not answered yet. */
export function toolRunning(parts: ToolishPart[] | undefined, toolName: string): boolean {
  return (parts ?? []).some(
    (p) =>
      (p.type === `tool-${toolName}` || (p.type === 'dynamic-tool' && p.toolName === toolName)) &&
      p.state !== 'output-available' &&
      p.state !== 'output-error',
  );
}
