import type {
  AuditEntry, Draft, DraftChange, DraftDiff, Intake, IntakeSlot, Lang, LeftoverRecord, OrderSummary, Receipt,
} from '@/contracts';
import type { DeliveryStatus } from '@/gateway/delivery';
import type { Change, Offer, PolicyReason } from '@/gateway/types';
import type { ThreadItem } from './thread';

export interface OrderDetails {
  receipt: Receipt;
  leftovers: LeftoverRecord[];
  /** Simulated delivery from the gateway; fetched separately for a fresh receipt. */
  delivery?: DeliveryStatus;
}

/**
 * Where the Review → Approve flow stands. The widget is a gateway client: Review shows a fixed-price offer
 * (quoteDraft), Approve is the gateway's placeOrder with the same policy as every agent.
 */
export type Checkout =
  | { kind: 'idle' }
  | { kind: 'quoting' }
  /** skewMs: demo clock minus the browser clock, so the countdown matches the gateway's validUntil. */
  | { kind: 'offer'; offer: Offer; changes: Change[]; limitEur: number; skewMs: number; requoted?: boolean; placing?: boolean }
  | { kind: 'pending'; offerId: string; approvalId: string; approver: { name: string; role: string }; reasons: PolicyReason[]; total: number; limitEur: number }
  | { kind: 'rejected'; decidedBy?: string; note?: string; message?: string }
  | { kind: 'not_orderable'; reasons: string[] }
  | { kind: 'error' };

/** What the widget needs from a conversation, whether scripted (fixture) or backed by the API (live). */
export interface WidgetSession {
  items: ThreadItem[];
  /** The assistant is working with nothing else on screen saying so: the chat shows the shelf card. */
  typing: boolean;
  busy: boolean;
  /** Planning has started and its draft has not arrived: the sheet opens with skeleton rows. */
  planning: boolean;
  /** An edit is in flight: the line ids it touches ("" or an empty list: the whole sheet, e.g. a chat edit); null when idle. */
  editing: string[] | null;
  lang: Lang | undefined;
  intake: Intake | null;
  missing: IntakeSlot[];
  draft: Draft | null;
  diff: DraftDiff | null;
  /** The order submitted in this conversation, if any. */
  receipt: Receipt | null;
  orders: OrderSummary[];
  /** Fast mode exists only for the scripted demo; live mode has no such switch. */
  fast?: boolean;
  setFast?: (on: boolean) => void;
  send: (text: string) => void;
  choose: (itemId: string, ids: string[], freeText?: string) => void;
  change: (change: DraftChange) => void;
  checkout: Checkout;
  /** Review opened (or "Refresh offer"): ask the gateway for a fixed-price offer for the draft. */
  requestOffer: () => void;
  /** Approve: place the current offer; the buyer's allergen ticks go along as the human-in-the-loop sign-off. */
  placeOrder: (allergenLineIds: string[]) => void;
  /** Back to an editable draft after a rejection. */
  clearCheckout: () => void;
  getDelivery: (orderId: string) => Promise<DeliveryStatus | null>;
  /** Demo: advance the clock to the next delivery state of the latest order. */
  nextDeliveryStep: () => Promise<{ orderId: string; delivery: DeliveryStatus } | null>;
  fastForward: () => void;
  reset: () => void;
  retry: () => void;
  submitCheckIn: (itemId: string, text: string) => void;
  confirmCheckIn: (itemId: string, entries: Array<{ lineId: string; leftoverQty: number }>) => Promise<void>;
  openOrder: (orderId: string) => Promise<OrderDetails | null>;
  /** Decision log for this conversation, or for one past order. */
  getAudit: (orderId?: string) => Promise<AuditEntry[]>;
}
