// The Aimo chat widget as a gateway client. Its API routes call these with the server-side widget identity
// (agents.ts WIDGET_AGENT); the rules are the gateway's own: quoteDraft → placeOrder → (approval) → order.
import type { Draft, Receipt } from '@/contracts';
import { getDraftByConversation, now as clockNow } from '@/db/repo';
import { widgetAgent } from './agents';
import { getOwnDraft, pendingOfferFor, quoteDraft } from './drafts';
import { getOwnOffer, GatewayError } from './offers';
import { getOrderStatus, placeOrder } from './orders';
import { policyFor } from './policies';
import { getApproval, getOffer, listOffers } from './store';
import type { Change, GatewayContext, Offer, PlaceOrderResult, PolicyReason } from './types';

export const widgetContext = (): GatewayContext => ({ agent: widgetAgent() });

/** The offer card the Review screen shows. `now` is the demo clock, so the widget's countdown matches the gateway. */
export type WidgetOffer = (
  | { status: 'offer'; offer: Offer; changes: Change[]; draft: Draft; limitEur: number }
  | { status: 'pending_approval'; offerId: string; approvalId: string; approver: { name: string; role: string }; reasons: PolicyReason[]; total: number; limitEur: number }
  | { status: 'ordered'; receipt: Receipt }
) & { now: string };

export type WidgetPlaceResult = PlaceOrderResult & { limitEur: number; total: number; now: string };

export type WidgetStatus =
  | { status: 'ordered'; receipt: Receipt }
  | { status: 'pending_approval'; approvalId: string; approver: { name: string; role: string }; reasons: PolicyReason[] }
  | { status: 'rejected'; note?: string; decidedBy?: string }
  | { status: 'requote'; newOffer: Offer | null }
  | { status: 'unknown' };

function conversationDraft(conversationId: string, ctx: GatewayContext): Draft {
  const found = getDraftByConversation(conversationId, ctx.db);
  if (!found) throw new GatewayError('No draft for this conversation', 'not_found');
  return getOwnDraft(found.id, ctx); // the widget's own customer and conversation, or not found
}

/** An open quote of this draft that is still valid and newer than the draft's last change: reused, not re-quoted. */
function reusableOffer(draft: Draft, ctx: GatewayContext): Offer | undefined {
  const nowMs = clockNow(ctx.db).getTime();
  return listOffers(draft.customerId, ctx.db).find((o) => o.draftId === draft.id && o.agentId === ctx.agent.agentId && o.status === 'open'
    && Date.parse(o.validUntil) > nowMs && o.createdAt >= draft.updatedAt);
}

/** Review opened: a fixed-price offer for the conversation's draft (or where it already stands). */
export async function widgetOffer(conversationId: string, ctx: GatewayContext = widgetContext()): Promise<WidgetOffer> {
  const r = await offerFor(conversationId, ctx);
  return { ...r, now: clockNow(ctx.db).toISOString() } as WidgetOffer;
}

async function offerFor(conversationId: string, ctx: GatewayContext) {
  const draft = conversationDraft(conversationId, ctx);
  const limitEur = policyFor(draft.customerId).autoApproveLimitEur;
  const pending = pendingOfferFor(draft);
  if (pending?.approvalId) {
    const approval = getApproval(pending.approvalId, ctx.db);
    if (approval) {
      return { status: 'pending_approval' as const, offerId: pending.offerId, approvalId: approval.approvalId, approver: approval.approver, reasons: approval.reasons, total: pending.totals.total, limitEur };
    }
  }
  if (draft.status === 'submitted') {
    const ordered = listOffers(draft.customerId, ctx.db).find((o) => o.draftId === draft.id && o.status === 'ordered' && o.orderId);
    const status = ordered?.orderId ? getOrderStatus(ordered.orderId, ctx) : null;
    if (status?.receipt) return { status: 'ordered' as const, receipt: status.receipt };
    throw new GatewayError('This draft was already ordered', 'conflict');
  }
  const reuse = reusableOffer(draft, ctx);
  if (reuse) return { status: 'offer' as const, offer: reuse, changes: [] as Change[], draft, limitEur };
  const q = await quoteDraft({ draftId: draft.id }, ctx);
  return { status: 'offer' as const, offer: q.offer, changes: q.changes, draft: q.draft, limitEur };
}

/**
 * Approve: placeOrder through the gateway, the same policy as every agent. The buyer's ticks on unknown-allergen
 * lines are passed as humanConfirmations (honoured because the widget is a human in the loop); substitutes were
 * listed on the Review screen the buyer approved, so they are pre-approved the same way an agent can pre-approve them.
 */
export async function widgetPlaceOrder(
  input: { conversationId: string; offerId: string; allergenLineIds?: string[] }, ctx: GatewayContext = widgetContext(),
): Promise<WidgetPlaceResult> {
  const draft = conversationDraft(input.conversationId, ctx);
  const offer = getOwnOffer(input.offerId, ctx);
  if (offer.draftId !== draft.id) throw new GatewayError(`No offer ${input.offerId} for this draft`, 'not_found');
  const result = await placeOrder({
    offerId: offer.offerId,
    preferences: { allowSubstitutes: true },
    humanConfirmations: { allergenLineIds: input.allergenLineIds ?? [] },
  }, ctx);
  return { ...result, limitEur: policyFor(draft.customerId).autoApproveLimitEur, total: offer.totals.total, now: clockNow(ctx.db).toISOString() };
}

/** Polled while an approval is pending: where the order stands now. */
export function widgetOrderStatus(id: string, ctx: GatewayContext = widgetContext()): WidgetStatus {
  const s = getOrderStatus(id, ctx);
  if (s.status === 'ordered' && s.receipt) return { status: 'ordered', receipt: s.receipt };
  if (s.status === 'pending_approval' && s.approval) return { status: 'pending_approval', approvalId: s.approval.approvalId, approver: s.approval.approver, reasons: s.approval.reasons };
  if (s.status === 'rejected') return { status: 'rejected', ...(s.approval?.note ? { note: s.approval.note } : {}), ...(s.approval?.decidedBy ? { decidedBy: s.approval.decidedBy } : {}) };
  if (s.status === 'requote') return { status: 'requote', newOffer: s.newOfferId ? getOffer(s.newOfferId, ctx.db) : null };
  return { status: 'unknown' };
}
