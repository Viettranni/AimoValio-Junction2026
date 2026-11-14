/**
 * Shared contracts for Aimo Planner.
 * Every module builds against these types. Change them only with care:
 * other modules depend on the exact names and shapes. See spec.md.
 */

// ───────────────────────── Basics ─────────────────────────

/** ISO date, YYYY-MM-DD (delivery date, event date). */
export type ISODate = string;
/** BCP-47-ish language tag of the buyer's latest message, e.g. "fi", "en", "sv", "et". */
export type Lang = string;
/** Languages with translated fixed UI text. Anything else falls back to "en". */
export type UiLang = 'en' | 'fi' | 'sv';

export const EU_ALLERGENS = [
  'gluten', 'crustaceans', 'egg', 'fish', 'peanut', 'soy', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
] as const;
export type Allergen = (typeof EU_ALLERGENS)[number];

export type DietFlag = 'lactose_free' | 'gluten_free' | 'vegan' | 'vegetarian';
export type Temperature = 'frozen' | 'chilled' | 'ambient' | 'unknown';
export type MeasureUnit = 'kg' | 'l' | 'pcs';

export type EventType = 'wedding' | 'corporate_lunch' | 'party' | 'buffet' | 'school' | 'other';

/** What a menu component is, for portion rules and history fallback. */
export type PortionCategory =
  | 'poultry_main' | 'meat_main' | 'fish_main' | 'veg_main'
  | 'grain_side' | 'potato_side' | 'veg_side' | 'salad'
  | 'sauce' | 'bread' | 'dessert' | 'dairy' | 'beverage'
  | 'cooking_fat' | 'seasoning';

// ───────────────────────── Catalogue (index + MCP) ─────────────────────────

export interface CatalogProduct {
  id: string;
  nameEn: string;
  nameFi: string;
  nameSv?: string;
  category: string;               // Valio category code, e.g. "17301"
  salesUnit: string;              // technical code, e.g. "KI" (never shown to buyer)
  salesUnitLabel: { en: string; fi: string; sv: string }; // "box" / "laatikko" / "kartong"
  /** Net content of ONE sales unit, in packUnit. e.g. a 4×1.5 kg box → 6, 'kg'. */
  packSize: number;
  packUnit: MeasureUnit;
  packDescription: string;        // human, English: "4 × 1.5 kg box"
  allowedLotSize: number;         // minimum order step in packs (sales units; KG products normalised to packs)
  temperature: Temperature;
  vendor: string;
  /** Contains these allergens; 'unknown' when no ingredient data exists. Never treat 'unknown' as safe. */
  allergens: Allergen[] | 'unknown';
  /** false when allergens come only from the product name (no ingredient list): never enough to pass a check. */
  ingredientData: boolean;
  dietFlags: DietFlag[];
  keyIngredientsText?: string;    // English ingredient text, allergens in CAPS as in source
  reliability: number | null;     // 0..1 from delivery reliability CSV
  co2PerKg: number | null;        // product-group average
}

export interface SearchQuery {
  query: string;                  // any language; search runs on fi + en names
  categoryHint?: PortionCategory;
  excludeAllergens?: Allergen[];
  requireDiet?: DietFlag[];
  temperature?: Temperature;
  limit?: number;                 // default 8
}

export interface SearchHit {
  product: CatalogProduct;
  score: number;
  reasons: string[];              // short English reasons, e.g. "name match: chicken breast"
}

export type AllergenVerdict = 'pass' | 'fail' | 'unknown';

export interface AllergenCheck {
  productId: string;
  verdict: AllergenVerdict;
  /** Which constraints failed / could not be verified. */
  conflicts: Allergen[];
  unmetDiets: DietFlag[];
  /** Quoted ingredient evidence, e.g. "mayonnaise (... EGG YOLK ...)". */
  evidence?: string;
}

// ───────────────────────── Valio API (normalised) ─────────────────────────

export interface PriceInfo {
  productId: string;
  ok: boolean;                    // false when Valio returned error:true
  price?: number;                 // per sales unit, excl. VAT (catalogPrice.value)
  priceWithTax?: number;          // catalogPrice.valueWithTax
  taxRate?: number;               // e.g. 13.5
  comparisonPrice?: number;       // per comparisonUnit excl. VAT
  comparisonUnit?: string;        // "KG" | "L" | ...
  currency: string;               // "EUR"
  fetchedAt: string;              // ISO timestamp, for "price from 10:42"
}

export interface AvailabilityInfo {
  productId: string;
  deliverable: boolean;           // scheduleLines non-empty && !salesBlock && availableAmount > 0
  salesBlock: boolean;
  logisticModel: 'Stock' | 'Terminal' | null;
  availableAmount: number | null; // in sales units; null for Terminal (999999 = unknown)
  availableDate: ISODate | null;  // earliest date the amount is available
  closingTime: string | null;     // ISO order cut-off
  fetchedAt: string;
}

// ───────────────────────── Intake ─────────────────────────

/** A diet flag, or an allergen meaning "no <allergen>". */
export type DietKind = DietFlag | Allergen;
export interface DietNeed { diet: DietKind; guests: number } // allergen = "no <allergen>"

export interface Intake {
  deliveryDate?: ISODate;
  guests?: number;
  menu?: string[];                // free text dishes, e.g. ["chicken", "rice"]
  budget?: number | 'none';       // EUR excl. VAT, or 'none' when skipped
  diets?: DietNeed[] | 'none';
  /** Diets the buyer named without a guest count, in the order asked; the diets slot stays missing until each has one. */
  dietsPending?: DietKind[];
  eventType?: EventType;
  eventName?: string;             // "Wedding"
  lang?: Lang;
}

export type IntakeSlot = 'deliveryDate' | 'guests' | 'menu' | 'budget' | 'diets';
export const REQUIRED_SLOTS: IntakeSlot[] = ['deliveryDate', 'guests', 'menu', 'budget', 'diets'];

// ───────────────────────── Menu / quantities ─────────────────────────

export interface MenuComponent {
  id: string;                     // stable within a draft, e.g. "c-chicken"
  label: string;                  // in buyer's language, e.g. "Kana" / "Chicken"
  searchTerms: { fi: string; en: string };
  category: PortionCategory;
  origin: 'requested' | 'needed_for_cooking' | 'addon';
  /** Guests this component is for (diet variants cover a subset). */
  guests: number;
  dietVariantOf?: string;         // component id this is a diet variant of
  requiredDiet?: DietFlag[];
  excludeAllergens?: Allergen[];
  requiredAmount: number;         // in requiredUnit, before pack rounding
  requiredUnit: MeasureUnit;
}

export interface PackPlan {
  packs: number;                  // sales units to order
  quantity: number;               // packs × packSize, in packUnit
  unit: MeasureUnit;
}

// ───────────────────────── History ─────────────────────────

export interface LeftoverRecord {
  orderId: string;
  lineId: string;
  productId: string;
  category: PortionCategory;
  eventType: EventType;
  eventName: string;
  eventDate: ISODate;
  orderedQty: number;             // in unit
  /** + leftover, − shortfall, 0 = used up. Same unit as orderedQty. */
  leftoverQty: number;
  unit: MeasureUnit;
}

export type HistoryBasis = 'same_product' | 'same_category_event' | 'same_category';

export interface HistoryAdjustment {
  basis: HistoryBasis;
  sampleSize: number;             // events used
  /** Weighted leftover ratio: +0.10 = 10% over-ordered, −0.05 = 5% short. */
  ratio: number;
  suggestedQty: number;           // input, in unit
  adjustedQty: number;            // suggested × (1 − ratio), before pack rounding
  unit: MeasureUnit;
  last: { eventName: string; eventDate: ISODate; leftoverQty: number; guests?: number } | null;
}

// ───────────────────────── Draft ─────────────────────────

export type LineTag =
  | 'in_stock' | 'supplier_delivered' | 'may_deliver_short' | 'substitute'
  | 'needed_for_cooking' | 'addon' | 'diet_variant' | 'allergens_unknown'
  | 'unavailable' | 'updated';

export interface DraftLine {
  id: string;                     // e.g. "l-1"
  componentId: string;
  group: PortionCategory;
  productId: string;
  productName: string;            // in buyer's language where available
  packDescription: string;
  packs: number;
  quantity: number;               // packs × packSize
  unit: MeasureUnit;
  unitPrice: number | null;       // per pack excl. VAT; null when price unavailable
  unitPriceWithTax: number | null;
  tags: LineTag[];
  dietGuests?: number;            // shown as "12 guests" tag
  allergen: AllergenCheck;
  substituteFor?: { productId: string; productName: string; reason: string };
  alternatives: string[];         // productIds the product agent ranked next
  history?: {
    adjustment: HistoryAdjustment;
    historyPacks: number;         // packs if history applied
    suggestedPacks: number;       // packs as originally suggested
    choice: 'pending' | 'history' | 'suggested';
  };
  availability?: AvailabilityInfo;
  price?: PriceInfo;
}

export interface DraftTotals {
  low: number; high: number;                 // excl. VAT
  lowWithTax: number; highWithTax: number;
  collapsed: boolean;                        // true when no pending history choices
  budget: number | null;
  overBudget: boolean;
}

export interface Draft {
  id: string;
  conversationId: string;
  customerId: string;
  intake: Intake;
  components: MenuComponent[];
  lines: DraftLine[];
  totals: DraftTotals;
  cutoff: string | null;                     // earliest closingTime among lines
  status: 'building' | 'ready' | 'submitted';
  updatedAt: string;
}

/** Mutations the UI and the order agent can apply. Pure, see src/domain/draft.ts. */
export type DraftChange =
  | { kind: 'setPacks'; lineId: string; packs: number }
  | { kind: 'historyChoice'; lineId: string; choice: 'history' | 'suggested' }
  | { kind: 'removeLine'; lineId: string }
  | { kind: 'swapProduct'; lineId: string; product: CatalogProduct; price?: PriceInfo; availability?: AvailabilityInfo; allergen: AllergenCheck; reason: string }
  | { kind: 'addLine'; line: DraftLine }
  | { kind: 'scaleGuests'; guests: number };   // recompute packs from components

export interface DraftDiff { changedLineIds: string[]; removedLineIds: string[]; addedLineIds: string[] }

// ───────────────────────── Orders / receipts / audit ─────────────────────────

export interface Receipt {
  orderId: string;                // "VA-2026-01234"
  simulated: true;
  customerId: string;
  eventName: string;
  eventType: EventType;
  deliveryDate: ISODate;
  guests: number;
  lines: Array<{
    lineId: string; productId: string; productName: string; packs: number; quantity: number; unit: MeasureUnit; unitPrice: number; unitPriceWithTax: number; lineTotal: number; lineTotalWithTax: number;
    /** From the offer: Stock (Valio warehouse) or Terminal (ordered from the supplier). Absent on older orders. */
    logisticModel?: 'Stock' | 'Terminal' | null;
  }>;
  total: number; totalWithTax: number; vat: number;
  /** Effective order cut-off of the order (earliest among its lines), when known. */
  cutoff?: string | null;
  co2Kg: number | null;
  minutesSaved: number;
  submittedAt: string;
}

export interface OrderSummary {
  orderId: string; eventName: string; eventDate: ISODate; guests: number;
  total: number; submittedAt: string;
  /** Weighted average leftover ratio across lines, null until check-in recorded. */
  leftoverRatio: number | null;
  checkInDone: boolean;
  /** Simulated delivery progress (src/gateway/delivery.ts), when the gateway served the list. */
  delivery?: DeliverySummary;
}

export type DeliveryState = 'received' | 'confirmed' | 'picking' | 'out_for_delivery' | 'delivered';

export interface DeliverySummary {
  state: DeliveryState;
  /** ETA window on the delivery day (ISO). */
  eta: { from: string; to: string };
  /** Lines delivered short (known once delivered). */
  shortLines: number;
  lateRisk: boolean;
}

export type Actor = 'buyer' | 'orchestrator' | 'intake' | 'menu' | 'product' | 'allergen' | 'pricing' | 'history' | 'order' | 'system'
  // Agent gateway (src/gateway): an external purchasing agent, the gateway's own policy engine, a human approver.
  | `agent:${string}` | 'gateway' | `approver:${string}`
  // Simulated delivery (src/gateway/delivery.ts).
  | 'carrier';

export interface AuditEntry {
  id: string;
  conversationId: string;
  orderId?: string;
  at: string;
  actor: Actor;
  action: string;                 // tool or action id, e.g. "swapProduct"
  summary: string;                // human English sentence, e.g. "Swapped Jasmine rice → Basmati rice: not deliverable 6 Dec"
  data?: unknown;
}

// ───────────────────────── Stream data parts (server → UI) ─────────────────────────
// Emitted with writer.custom({ type: 'data-…', data }) from tools; rendered by the widget.

export type ProgressStepId = 'understand' | 'ingredients' | 'search' | 'allergens' | 'prices' | 'history' | 'draft';

export interface ProgressEvent { step: ProgressStepId; status: 'start' | 'done'; label: string; count?: number; ticker?: string[] }
export interface ChoicesEvent { id: string; question: string; options: Array<{ id: string; label: string }>; multi: boolean; allowFreeText: boolean }
export interface SlotsEvent { intake: Intake; missing: IntakeSlot[] }
export interface DraftEvent { draft: Draft; diff?: DraftDiff }
export interface ReceiptEvent { receipt: Receipt }
export interface CheckInEvent { orderId: string; eventName: string; lines: Array<{ lineId: string; productName: string; quantity: number; unit: MeasureUnit; leftoverQty?: number; deliveredShort?: { qty: number; reason: string } }> } // quantity = ordered; leftoverQty = parsed (+ left, − short) when known; deliveredShort = Valio delivered this much less (prefilled as a shortfall)

/** The copy-paste MCP link for Claude (src/gateway/connect.ts). */
export interface ConnectEvent { mcpUrl: string; localMcpUrl: string; isPublic: boolean }

export type AimoDataPart =
  | { type: 'data-progress'; data: ProgressEvent }
  | { type: 'data-choices'; data: ChoicesEvent }
  | { type: 'data-slots'; data: SlotsEvent }
  | { type: 'data-draft'; data: DraftEvent }
  | { type: 'data-receipt'; data: ReceiptEvent }
  | { type: 'data-checkin'; data: CheckInEvent }
  | { type: 'data-connect'; data: ConnectEvent };
