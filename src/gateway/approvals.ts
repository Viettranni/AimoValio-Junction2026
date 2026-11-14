// Human sign-off for orders outside an agent's authority. Only the approval page / route calls decideApproval;
// no MCP tool can approve.
import { getDb } from '@/db/client';
import { appendAudit, now as clockNow } from '@/db/repo';
import { GatewayError, quote } from './offers';
import { diffOffers, submitOffer, supersede } from './orders';
import { getApproval, getOffer, listApprovalRows, saveApproval, saveOffer } from './store';
import type { Approval, ApprovalStatus, Change, GatewayContext, Offer } from './types';
import type { Receipt } from '@/contracts';

export function listApprovals(filter: { status?: ApprovalStatus; customerId?: string } = {}, db = getDb()) {
  return listApprovalRows(filter, db).map((approval) => ({ approval, offer: getOffer(approval.offerId, db) }));
}

export type DecisionResult =
  | { status: 'ordered'; approval: Approval; receipt: Receipt }
  | { status: 'rejected'; approval: Approval }
  | { status: 'requote'; approval: Approval; newOffer: Offer; changes: Change[] };

/**
 * Approve or reject a pending approval. Approve re-checks fresh Valio prices and availability first:
 * anything changed → a new offer (requote) goes back to the agent instead of an order at a different price.
 * The 15-minute offer validity is suspended while a human looks at it; the re-check is what protects the price.
 */
export async function decideApproval(
  approvalId: string, input: { decision: 'approve' | 'reject'; approverName: string; note?: string }, db = getDb(),
): Promise<DecisionResult> {
  const approverName = input.approverName.trim();
  if (!approverName) throw new GatewayError('approverName is required');
  const approval = getApproval(approvalId, db);
  if (!approval) throw new GatewayError(`No approval ${approvalId}`, 'not_found');
  if (approval.status !== 'pending') throw new GatewayError(`Approval ${approvalId} is already ${approval.status}`, 'conflict');
  const offer = getOffer(approval.offerId, db);
  if (!offer) throw new GatewayError(`No offer ${approval.offerId}`, 'not_found');
  const actor = `approver:${approverName}` as const;
  const note = input.note?.trim() || undefined;

  if (input.decision === 'reject') {
    const decided: Approval = { ...approval, status: 'rejected', decidedAt: clockNow(db).toISOString(), decidedBy: approverName, ...(note ? { note } : {}) };
    db.transaction((tx) => {
      const t = tx as unknown as typeof db;
      saveApproval(decided, t);
      saveOffer({ ...offer, status: 'rejected' }, t);
      appendAudit({ conversationId: offer.offerId, actor, action: 'reject', summary: `${approverName} rejected offer ${offer.offerId}${note ? `: ${note}` : ''}` }, t);
    });
    return { status: 'rejected', approval: decided };
  }

  const ctx: GatewayContext = { agent: { agentId: approval.agentId, customerId: approval.customerId, displayName: approval.agentName }, db };
  const fresh = await quote(offer.request, ctx);
  const nowDate = clockNow(db);
  const latest = getApproval(approvalId, db);
  if (!latest || latest.status !== 'pending') throw new GatewayError(`Approval ${approvalId} is already ${latest?.status}`, 'conflict');

  const changes = diffOffers(offer, fresh, nowDate, { ignoreExpiry: true });
  if (changes.length) {
    const newOffer = supersede(offer, fresh, changes, 'gateway', db);
    const decided: Approval = { ...latest, status: 'requoted', decidedAt: nowDate.toISOString(), decidedBy: approverName, newOfferId: newOffer.offerId, ...(note ? { note } : {}) };
    saveApproval(decided, db);
    appendAudit({
      conversationId: offer.offerId, actor, action: 'approveRequoted',
      summary: `${approverName} approved, but prices or stock changed since the offer; new offer ${newOffer.offerId} goes back to the agent`,
    }, db);
    return { status: 'requote', approval: decided, newOffer, changes };
  }

  appendAudit({ conversationId: offer.offerId, actor, action: 'approve', summary: `${approverName} approved offer ${offer.offerId}${note ? `: ${note}` : ''}` }, db);
  const receipt = submitOffer(offer, { actor, summary: `Ordered after ${approverName}'s sign-off` }, db);
  const decided: Approval = { ...latest, status: 'approved', decidedAt: nowDate.toISOString(), decidedBy: approverName, orderId: receipt.orderId, ...(note ? { note } : {}) };
  saveApproval(decided, db);
  return { status: 'ordered', approval: decided, receipt };
}
