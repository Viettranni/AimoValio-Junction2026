// Orders: commit an offer within the agent's authority, or route it to a human. Never a silent price change.
import type { CatalogProduct, Draft, PortionCategory, Receipt } from '@/contracts';
import { getProduct } from '@/catalog';
import { getDb, type Db } from '@/db/client';
import { appendAudit, getDraftById, getReceipt, listAudit, nextOrderId, now as clockNow, saveDraft, storeOrder } from '@/db/repo';
import { actorFor, getOwnOffer, GatewayError, quote } from './offers';
import { policyFor } from './policies';
import { evaluatePolicy } from './policy';
import { getApproval, getOffer, listOffers, newId, saveApproval, saveOffer } from './store';
import type { Approval, Change, GatewayContext, HumanConfirmations, Offer, OrderPreferences, PlaceOrderResult } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rough buyer time saved against ordering by hand, shown on the receipt. */
export const minutesSaved = (lineCount: number) => Math.min(60, 5 + 3 * lineCount);

/** Why a fresh quote differs from the offer: expiry, any price change, any availability change. */
export function diffOffers(old: Offer, fresh: Offer, now: Date, opts: { ignoreExpiry?: boolean } = {}): Change[] {
  const changes: Change[] = [];
  if (!opts.ignoreExpiry && now.getTime() > Date.parse(old.validUntil)) {
    changes.push({ field: 'expired', from: old.validUntil, to: now.toISOString(), message: `Offer ${old.offerId} expired at ${old.validUntil}` });
  }
  old.lines.forEach((l, i) => {
    const f = fresh.lines[i];
    if (!f || f.productId !== l.productId) return;
    if (f.unitPrice !== l.unitPrice || f.unitPriceWithTax !== l.unitPriceWithTax) {
      changes.push({
        lineId: l.lineId, productId: l.productId, field: 'price', from: l.unitPrice, to: f.unitPrice,
        message: `${l.productName}: price per pack ${l.unitPrice ?? 'none'} → ${f.unitPrice ?? 'none'} EUR excl. VAT`,
      });
    }
    if (f.status !== l.status) {
      changes.push({
        lineId: l.lineId, productId: l.productId, field: 'availability', from: l.status, to: f.status,
        message: `${l.productName}: ${l.status} → ${f.status}${f.reason ? ` (${f.reason})` : ''}`,
      });
    }
  });
  return changes;
}

/** Portion category for order history; agent orders have no menu, so it is inferred roughly from the product. */
function categoryOf(p: CatalogProduct | undefined): PortionCategory {
  if (!p) return 'veg_side';
  if (p.allergens !== 'unknown' && p.allergens.includes('milk')) return 'dairy';
  return p.packUnit === 'l' ? 'beverage' : 'veg_side';
}

function buildReceipt(offer: Offer, orderId: string, submittedAt: string, draft: Draft | null): Receipt {
  const lines = offer.lines.filter((l) => l.available).map((l) => ({
    lineId: l.lineId, productId: l.productId, productName: l.productName, packs: l.packs, quantity: l.quantity, unit: l.unit,
    unitPrice: l.unitPrice as number, unitPriceWithTax: l.unitPriceWithTax as number, lineTotal: l.lineTotal, lineTotalWithTax: l.lineTotalWithTax,
    ...(l.logisticModel !== undefined ? { logisticModel: l.logisticModel } : {}),
  }));
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const totalWithTax = round2(lines.reduce((s, l) => s + l.lineTotalWithTax, 0));
  let co2: number | null = null;
  for (const l of lines) {
    const factor = l.unit === 'kg' ? getProduct(l.productId)?.co2PerKg : null;
    if (factor != null) co2 = (co2 ?? 0) + l.quantity * factor;
  }
  return {
    orderId, simulated: true, customerId: offer.customerId,
    eventName: draft?.intake.eventName ? `${draft.intake.eventName} (${offer.offerId})` : `Agent order ${offer.offerId}`,
    eventType: draft?.intake.eventType ?? 'other', deliveryDate: offer.deliveryDate, guests: draft?.intake.guests ?? 0, lines, total, totalWithTax, vat: round2(totalWithTax - total),
    co2Kg: co2 === null ? null : round2(co2), minutesSaved: minutesSaved(lines.length), submittedAt,
    cutoff: offer.cutoff,
  };
}

/**
 * Writes the simulated order for the offer's deliverable lines. Synchronous and transaction-free:
 * callers wrap it in their own transaction together with their other writes. Refuses an offer already ordered.
 */
export function writeOrder(offer: Offer, by: { actor: `agent:${string}` | `approver:${string}`; summary: string }, db: Db): Receipt {
  const current = getOffer(offer.offerId, db);
  if (current?.status === 'ordered') throw new GatewayError(`Offer ${offer.offerId} is already ordered (${current.orderId})`, 'conflict');
  const orderable = offer.lines.filter((l) => l.available);
  if (!orderable.length) throw new GatewayError('Nothing in this offer can be delivered; request a new offer', 'conflict');
  const draft = offer.draftId ? getDraftById(offer.draftId, db) : null;
  if (draft?.status === 'submitted') throw new GatewayError(`Draft ${draft.id} was already ordered; this offer can't be placed`, 'conflict');
  const receipt = buildReceipt(offer, nextOrderId(db), clockNow(db).toISOString(), draft);
  const groups = new Map(draft?.lines.map((l) => [l.id, l.group]) ?? []);
  const categories = new Map(orderable.map((l) => [l.lineId, groups.get(l.lineId) ?? categoryOf(getProduct(l.productId))]));
  storeOrder(receipt, categories, db);
  saveOffer({ ...offer, status: 'ordered', orderId: receipt.orderId }, db);
  if (draft) {
    saveDraft({ ...draft, status: 'submitted', updatedAt: receipt.submittedAt }, db);
    // Other open quotes of the same draft (e.g. from a requote) can never be placed now.
    for (const o of listOffers(offer.customerId, db)) {
      if (o.draftId === draft.id && o.offerId !== offer.offerId && o.status === 'open') saveOffer({ ...o, status: 'void', orderId: receipt.orderId }, db);
    }
  }
  appendAudit({
    conversationId: offer.offerId, orderId: receipt.orderId, actor: by.actor, action: 'submitOrder',
    summary: `${by.summary}: simulated order ${receipt.orderId}, ${receipt.lines.length} line(s), €${receipt.total.toFixed(2)} excl. VAT`,
    data: { total: receipt.total, excludedLineIds: offer.lines.filter((l) => !l.available).map((l) => l.lineId), draftId: offer.draftId ?? null },
  }, db);
  if (draft) {
    appendAudit({
      conversationId: draft.conversationId, orderId: receipt.orderId, actor: by.actor, action: 'submitOrder',
      summary: `Draft checked out as order ${receipt.orderId} (offer ${offer.offerId})`,
    }, db);
  }
  return receipt;
}

/** writeOrder in its own transaction. */
export function submitOffer(offer: Offer, by: { actor: `agent:${string}` | `approver:${string}`; summary: string }, db: Db = getDb()): Receipt {
  return db.transaction((tx) => writeOrder(offer, by, tx as unknown as Db));
}

/** Saves a fresh quote that replaces `old`, and marks `old` superseded. */
export function supersede(old: Offer, fresh: Offer, changes: Change[], actor: 'gateway', db?: Db): Offer {
  const next: Offer = { ...fresh, replaces: old.offerId, ...(old.draftId ? { draftId: old.draftId } : {}) };
  saveOffer(next, db);
  saveOffer({ ...old, status: 'superseded', supersededBy: next.offerId }, db);
  appendAudit({
    conversationId: old.offerId, actor, action: 'requote',
    summary: `Offer ${old.offerId} re-quoted as ${next.offerId}: ${changes.map((c) => c.message).join('; ')}`,
    data: { newOfferId: next.offerId, changes },
  }, db);
  return next;
}

const excluded = (offer: Offer) => offer.lines.filter((l) => !l.available).map((l) => ({ lineId: l.lineId, productId: l.productId, reason: l.reason }));

function pendingResult(offer: Offer, approval: Approval): PlaceOrderResult {
  return {
    status: 'pending_approval', offerId: offer.offerId, approvalId: approval.approvalId, approver: approval.approver, reasons: approval.reasons,
    message: `Outside the agent's authority: waiting for ${approval.approver.name} (${approval.approver.role}) to sign off. Poll getOrderStatus("${approval.approvalId}").`,
  };
}

/** Answer for an offer that is no longer open (idempotent repeat calls). */
function settled(offer: Offer, db?: Db): PlaceOrderResult {
  if (offer.status === 'ordered' && offer.orderId) {
    const receipt = getReceipt(offer.orderId, db ?? getDb());
    if (receipt) return { status: 'ordered', offerId: offer.offerId, receipt, excludedLines: excluded(offer) };
  }
  if (offer.status === 'pending_approval' && offer.approvalId) {
    const approval = getApproval(offer.approvalId, db);
    if (approval) return pendingResult(offer, approval);
  }
  if (offer.status === 'superseded' && offer.supersededBy) {
    const newOffer = getOffer(offer.supersededBy, db);
    if (newOffer) return { status: 'requote', offerId: offer.offerId, newOffer, changes: [], message: `Offer ${offer.offerId} was replaced by ${newOffer.offerId}` };
  }
  if (offer.status === 'void') {
    return { status: 'rejected', offerId: offer.offerId, message: `Offer ${offer.offerId} is void: its draft was already ordered${offer.orderId ? ` (${offer.orderId})` : ''}` };
  }
  return { status: 'rejected', offerId: offer.offerId, ...(offer.approvalId ? { approvalId: offer.approvalId } : {}), message: `Offer ${offer.offerId} was rejected` };
}

/**
 * The split-order guard: this customer's agent offers ordered or pending approval today (demo clock, UTC day)
 * for the same delivery date, other than this one. Their sum counts against the auto-approve limit.
 */
export function committedToday(offer: Offer, now: Date, db?: Db): number {
  const today = now.toISOString().slice(0, 10);
  const sum = listOffers(offer.customerId, db)
    .filter((o) => o.offerId !== offer.offerId && o.deliveryDate === offer.deliveryDate && o.createdAt.slice(0, 10) === today)
    .filter((o) => o.status === 'ordered' || o.status === 'pending_approval')
    .reduce((s, o) => s + o.totals.total, 0);
  return round2(sum);
}

/**
 * placeOrder: re-checks fresh prices and availability, then applies the customer's authority policy.
 * Changed or expired → requote (new offer, list of changes). Within authority → ordered. Otherwise → pending_approval.
 * The one rule set for every client: external agents over MCP and the Aimo widget alike. humanConfirmations count
 * only for an agent with humanInTheLoop (the widget's server-side identity); from anyone else they are ignored.
 */
export async function placeOrder(
  input: { offerId: string; preferences?: OrderPreferences; humanConfirmations?: HumanConfirmations }, ctx: GatewayContext,
): Promise<PlaceOrderResult> {
  const db = ctx.db ?? getDb();
  const offer = getOwnOffer(input.offerId, ctx);
  if (offer.status !== 'open') return settled(offer, db);

  const fresh = await quote(offer.request, ctx, { draftId: offer.draftId });
  // From here on everything is one synchronous transaction: the re-read, the split-order total, the decision and
  // its writes, so a concurrent placeOrder can neither order the same offer twice nor slip under the limit.
  return db.transaction((tx): PlaceOrderResult => {
    const t = tx as unknown as Db;
    const tctx: GatewayContext = { ...ctx, db: t };
    const nowDate = clockNow(t);
    const latest = getOwnOffer(input.offerId, tctx);
    if (latest.status !== 'open') return settled(latest, t);

    const changes = diffOffers(latest, fresh, nowDate);
    if (changes.length) {
      const newOffer = supersede(latest, fresh, changes, 'gateway', t);
      return { status: 'requote', offerId: latest.offerId, newOffer, changes, message: 'Prices, availability or validity changed: review the new offer and place it instead. Nothing was ordered.' };
    }

    const orderable = latest.lines.filter((l) => l.available);
    if (!orderable.length) {
      const reasons = latest.lines.map((l) => `${l.productName}: ${l.reason ?? l.status}`);
      appendAudit({ conversationId: latest.offerId, actor: 'gateway', action: 'notOrderable', summary: `Nothing in offer ${latest.offerId} can be delivered`, data: { reasons } }, t);
      return { status: 'not_orderable', offerId: latest.offerId, reasons, message: 'No line of this offer can be delivered in full on the date; nothing was ordered and no approval was requested. Use the alternatives or another date.' };
    }

    const confirmed = confirmedAllergenLines(latest, input.humanConfirmations, ctx);
    if (confirmed.size) {
      appendAudit({
        conversationId: latest.offerId, actor: 'buyer', action: 'confirmAllergens',
        summary: `The buyer checked and confirmed the allergens of ${confirmed.size} line(s) with no allergen data on the review screen (${ctx.agent.displayName})`,
        data: { lineIds: [...confirmed] },
      }, t);
    }
    const decision = evaluatePolicy(latest, {
      preferences: input.preferences, now: nowDate, committedEur: committedToday(latest, nowDate, t), confirmedAllergenLineIds: confirmed,
    });
    appendAudit({
      conversationId: latest.offerId, actor: 'gateway', action: 'evaluatePolicy',
      summary: decision.decision === 'auto'
        ? `Within ${ctx.agent.displayName}'s authority: ordering automatically`
        : `Needs sign-off: ${decision.reasons.map((r) => r.message).join('; ')}`,
      data: { decision: decision.decision, reasons: decision.reasons, preferences: input.preferences ?? null },
    }, t);

    if (decision.decision === 'auto') {
      const receipt = writeOrder(latest, { actor: actorFor(ctx), summary: `${ctx.agent.displayName} placed offer ${latest.offerId} within its authority` }, t);
      return { status: 'ordered', offerId: latest.offerId, receipt, excludedLines: excluded(latest) };
    }

    const policy = policyFor(latest.customerId);
    const approval: Approval = {
      approvalId: newId('AP'), offerId: latest.offerId, customerId: latest.customerId, agentId: ctx.agent.agentId,
      agentName: ctx.agent.displayName, approver: policy.approver, reasons: decision.reasons,
      ...(input.preferences ? { preferences: input.preferences } : {}), status: 'pending', createdAt: nowDate.toISOString(),
    };
    saveApproval(approval, t);
    saveOffer({ ...latest, status: 'pending_approval', approvalId: approval.approvalId }, t);
    appendAudit({
      conversationId: latest.offerId, actor: actorFor(ctx), action: 'requestApproval',
      summary: `${ctx.agent.displayName} asked ${policy.approver.name} to sign off offer ${latest.offerId} (approval ${approval.approvalId})`,
      data: { approvalId: approval.approvalId },
    }, t);
    return pendingResult(latest, approval);
  });
}

/** The allergen sign-offs that count: a human in the loop, lines of this offer whose allergens are unknown (never failed). */
function confirmedAllergenLines(offer: Offer, confirmations: HumanConfirmations | undefined, ctx: GatewayContext): Set<string> {
  if (!ctx.agent.humanInTheLoop || !confirmations?.allergenLineIds?.length) return new Set();
  const wanted = new Set(confirmations.allergenLineIds);
  return new Set(offer.lines.filter((l) => l.available && l.allergen?.verdict === 'unknown' && wanted.has(l.lineId)).map((l) => l.lineId));
}

/** getOrderStatus: an order id (VA-…), approval id (AP-…) or offer id (OF-…) of the caller's own customer. */
export function getOrderStatus(id: string, ctx: GatewayContext) {
  const db = ctx.db ?? getDb();
  const notFound = () => new GatewayError(`No order, approval or offer ${id}`, 'not_found');
  let offer: Offer | null = null;
  let approval: Approval | null = null;
  let receipt: Receipt | null = null;
  if (id.startsWith('AP-')) {
    approval = getApproval(id, db);
    if (!approval || approval.customerId !== ctx.agent.customerId) throw notFound();
    offer = getOffer(approval.offerId, db);
  } else if (id.startsWith('OF-')) {
    offer = getOffer(id, db);
    if (!offer || offer.customerId !== ctx.agent.customerId) throw notFound();
    approval = offer.approvalId ? getApproval(offer.approvalId, db) : null;
  } else {
    receipt = getReceipt(id, db);
    if (!receipt || receipt.customerId !== ctx.agent.customerId) throw notFound();
    const offerId = /\b(OF-[0-9A-F]+)\b/.exec(receipt.eventName)?.[1];
    offer = offerId ? getOffer(offerId, db) : null;
    approval = offer?.approvalId ? getApproval(offer.approvalId, db) : null;
  }
  const orderId = receipt?.orderId ?? approval?.orderId ?? offer?.orderId;
  receipt ??= orderId ? getReceipt(orderId, db) : null;
  const status = receipt ? 'ordered'
    : approval?.status === 'pending' ? 'pending_approval'
    : approval?.status === 'rejected' ? 'rejected'
    : approval?.status === 'requoted' || offer?.status === 'superseded' ? 'requote'
    : offer?.status ?? 'unknown';
  const newOfferId = approval?.newOfferId ?? offer?.supersededBy;
  return {
    id, status,
    ...(offer ? { offer: { offerId: offer.offerId, status: offer.status, deliveryDate: offer.deliveryDate, total: offer.totals.total, validUntil: offer.validUntil } } : {}),
    ...(approval ? { approval: { approvalId: approval.approvalId, status: approval.status, approver: approval.approver, reasons: approval.reasons, decidedBy: approval.decidedBy, note: approval.note } } : {}),
    ...(newOfferId ? { newOfferId } : {}),
    receipt,
    audit: offer ? listAudit({ conversationId: offer.offerId }, db).map((a) => ({ at: a.at, actor: a.actor, action: a.action, summary: a.summary })) : [],
  };
}
