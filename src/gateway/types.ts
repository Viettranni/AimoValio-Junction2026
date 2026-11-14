// Shared types of the agent gateway: what an external purchasing agent sees over MCP.
import type { Allergen, AllergenCheck, DietFlag, ISODate, MeasureUnit, Receipt } from '@/contracts';
import type { Db } from '@/db/client';

/** Who is calling: resolved from the agent's API key, never from tool input. */
export interface AgentIdentity {
  agentId: string;
  customerId: string;
  displayName: string;
}

export interface GatewayContext {
  agent: AgentIdentity;
  db?: Db;
}

/** The buyer's stated requirements, checked per line (allergen verdicts). */
export interface Requirements {
  excludeAllergens?: Allergen[];
  requireDiet?: DietFlag[];
}

/** What the agent was told it may accept without a human, checked by the policy at order time. */
export interface OrderPreferences {
  /** Lines that replace another product (requestOffer line `substituteFor`) are fine without sign-off. */
  allowSubstitutes?: boolean;
  /** Latest acceptable delivery date; a later offer needs sign-off. */
  latestDeliveryDate?: ISODate;
}

export type QuantityUnit = 'packs' | MeasureUnit;

export interface OfferRequestLine {
  productId: string;
  quantity: number;
  /** 'packs' (default) = sales units; 'kg' | 'l' | 'pcs' = net amount, rounded up to whole packs. */
  unit?: QuantityUnit;
  /** Set when this line replaces another product the agent first wanted (e.g. a suggested alternative). */
  substituteFor?: string;
  /** Internal: the line id to use (draft checkout keeps the draft's line ids). Not exposed over MCP. */
  ref?: string;
}

export interface OfferRequest {
  deliveryDate: ISODate;
  lines: OfferRequestLine[];
  requirements?: Requirements;
}

export type PriceBasis = 'per_pack' | 'per_kg';

export interface Alternative {
  productId: string;
  name: string;
  packDescription: string;
  unitPrice: number;
  unitPriceWithTax: number;
  comparisonPrice: number | null;
  comparisonUnit: string | null;
  availablePacks: number | null;
  reason: string;
}

export type LineStatus = 'available' | 'partial' | 'unavailable';

export interface OfferLine {
  lineId: string;
  productId: string;
  productName: string;
  packDescription: string;
  requested: { quantity: number; unit: QuantityUnit };
  packs: number;
  /** packs × pack size, in `unit`. */
  quantity: number;
  unit: MeasureUnit;
  /** Fixed Valio catalogue price of ONE pack, excl. VAT (null when Valio gave no price). */
  unitPrice: number | null;
  unitPriceWithTax: number | null;
  /** per_kg: Valio prices this product per kg; unitPrice = price per kg × pack weight. */
  priceBasis: PriceBasis;
  valioPrice: number | null;
  lineTotal: number;
  lineTotalWithTax: number;
  status: LineStatus;
  available: boolean;
  reason?: string;
  availablePacks: number | null;
  availableDate: ISODate | null;
  cutoff: string | null;
  substituteFor?: string;
  allergen?: AllergenCheck;
  /** Same-kind suggestions when the line can't be delivered in full. Never swapped in automatically. */
  alternatives?: Alternative[];
}

export type OfferStatus = 'open' | 'ordered' | 'pending_approval' | 'rejected' | 'superseded';

export interface Offer {
  offerId: string;
  customerId: string;
  agentId: string;
  deliveryDate: ISODate;
  /** Effective requirements: the customer's defaults plus what the agent stated. */
  requirements?: Requirements;
  /** Set when the offer is the checkout of an event draft (checkoutDraft). */
  draftId?: string;
  lines: OfferLine[];
  /** Over the lines that can be delivered in full, excl. / incl. VAT. */
  totals: { currency: 'EUR'; total: number; totalWithTax: number; vat: number; orderableLines: number; excludedLines: number };
  /** Earliest effective order cut-off among the orderable lines. */
  cutoff: string | null;
  createdAt: string;
  /** createdAt + 15 min, never after the cut-off. */
  validUntil: string;
  status: OfferStatus;
  pricing: string;
  request: OfferRequest;
  orderId?: string;
  approvalId?: string;
  supersededBy?: string;
  replaces?: string;
}

export interface PolicyReason {
  rule: 'total_over_limit' | 'allergen_unverified' | 'substitution_outside_preferences' | 'late_delivery' | 'cutoff_risk' | 'unavailable_lines' | 'category_not_allowed';
  message: string;
  lineIds?: string[];
}

export interface PolicyDecision {
  decision: 'auto' | 'needs_approval';
  reasons: PolicyReason[];
}

export interface Change {
  lineId?: string;
  productId?: string;
  field: 'expired' | 'price' | 'availability';
  from: unknown;
  to: unknown;
  message: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'requoted';

export interface Approval {
  approvalId: string;
  offerId: string;
  customerId: string;
  agentId: string;
  agentName: string;
  approver: { name: string; role: string };
  reasons: PolicyReason[];
  preferences?: OrderPreferences;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
  orderId?: string;
  newOfferId?: string;
}

export type PlaceOrderResult =
  | { status: 'ordered'; offerId: string; receipt: Receipt; excludedLines: Array<{ lineId: string; productId: string; reason?: string }> }
  | { status: 'pending_approval'; offerId: string; approvalId: string; approver: { name: string; role: string }; reasons: PolicyReason[]; message: string }
  | { status: 'requote'; offerId: string; newOffer: Offer; changes: Change[]; message: string }
  | { status: 'rejected'; offerId: string; approvalId?: string; message: string }
  | { status: 'not_orderable'; offerId: string; reasons: string[]; message: string };
