import type {
  AuditEntry, Draft, DraftChange, DraftDiff, Intake, IntakeSlot, Lang, LeftoverRecord, OrderSummary, Receipt,
} from '@/contracts';
import type { ThreadItem } from './thread';

export interface ApproveResult {
  receipt?: Receipt;
  problems?: Array<{ lineId: string; reason: string }>;
}

export interface OrderDetails {
  receipt: Receipt;
  leftovers: LeftoverRecord[];
}

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
  /** Lines with unknown allergens the buyer ticked on the review screen are sent along (the server requires them). */
  approve: (confirmedUnknownLineIds: string[]) => Promise<ApproveResult>;
  fastForward: () => void;
  reset: () => void;
  retry: () => void;
  submitCheckIn: (itemId: string, text: string) => void;
  confirmCheckIn: (itemId: string, entries: Array<{ lineId: string; leftoverQty: number }>) => Promise<void>;
  openOrder: (orderId: string) => Promise<OrderDetails | null>;
  /** Decision log for this conversation, or for one past order. */
  getAudit: (orderId?: string) => Promise<AuditEntry[]>;
}
