// The gateway's authority check. Deterministic: the policy data decides, never a language model.
import { getProduct } from '@/catalog';
import { POLICY_RULES, policyFor, type AuthorityPolicy } from './policies';
import type { Offer, OrderPreferences, PolicyDecision, PolicyReason, Requirements } from './types';

const eur = (n: number) => `€${n.toFixed(2)}`;

export interface PolicyContext {
  policy?: AuthorityPolicy;
  preferences?: OrderPreferences;
  /** Current time (demo clock), for the cut-off margin. */
  now: Date;
  /** Agent orders of this customer placed or pending today for the same delivery date (excl. VAT), excluding this offer. */
  committedEur?: number;
  /**
   * Unknown-allergen lines a human in the loop checked and ticked (only passed for agents with humanInTheLoop).
   * They count as the allergen sign-off; a failed check never does.
   */
  confirmedAllergenLineIds?: ReadonlySet<string>;
}

/** Requirements merged as a union (customer defaults + what the agent states). */
export function mergeRequirements(...rs: Array<Requirements | undefined>): Requirements | undefined {
  const excludeAllergens = [...new Set(rs.flatMap((r) => r?.excludeAllergens ?? []))];
  const requireDiet = [...new Set(rs.flatMap((r) => r?.requireDiet ?? []))];
  if (!excludeAllergens.length && !requireDiet.length) return undefined;
  return { ...(excludeAllergens.length ? { excludeAllergens } : {}), ...(requireDiet.length ? { requireDiet } : {}) };
}

export function evaluatePolicy(offer: Offer, ctx: PolicyContext): PolicyDecision {
  const policy = ctx.policy ?? policyFor(offer.customerId);
  const prefs = ctx.preferences ?? {};
  const reasons: PolicyReason[] = [];
  const orderable = offer.lines.filter((l) => l.available);

  const committed = ctx.committedEur ?? 0;
  if (offer.totals.total + committed > policy.autoApproveLimitEur) {
    reasons.push({
      rule: 'total_over_limit',
      message: committed > 0
        ? `Total ${eur(offer.totals.total)} excl. VAT plus ${eur(committed)} already ordered or pending today for ${offer.deliveryDate} is above the agent's limit of ${eur(policy.autoApproveLimitEur)}`
        : `Total ${eur(offer.totals.total)} excl. VAT is above the agent's limit of ${eur(policy.autoApproveLimitEur)}`,
    });
  }

  const confirmed = ctx.confirmedAllergenLineIds;
  const unverified = orderable.filter((l) => l.allergen && l.allergen.verdict !== 'pass'
    && !(l.allergen.verdict === 'unknown' && confirmed?.has(l.lineId)));
  if (unverified.length) {
    reasons.push({
      rule: 'allergen_unverified',
      message: unverified.map((l) => `${l.productName}: allergens ${l.allergen!.verdict === 'fail' ? 'conflict with' : 'cannot be verified against'} the requirements`).join('; '),
      lineIds: unverified.map((l) => l.lineId),
    });
  }

  const substitutes = orderable.filter((l) => l.substituteFor);
  if (substitutes.length && !prefs.allowSubstitutes) {
    reasons.push({
      rule: 'substitution_outside_preferences',
      message: `${substitutes.length} line(s) replace the originally wanted product and substitutes were not pre-approved`,
      lineIds: substitutes.map((l) => l.lineId),
    });
  }

  if (prefs.latestDeliveryDate && offer.deliveryDate > prefs.latestDeliveryDate) {
    reasons.push({ rule: 'late_delivery', message: `Delivery ${offer.deliveryDate} is later than the requested ${prefs.latestDeliveryDate}` });
  }

  if (offer.cutoff) {
    const minutesLeft = (Date.parse(offer.cutoff) - ctx.now.getTime()) / 60_000;
    if (minutesLeft < policy.cutoffMarginMinutes) {
      reasons.push({ rule: 'cutoff_risk', message: `Order cut-off ${offer.cutoff} is less than ${policy.cutoffMarginMinutes} min away` });
    }
  }

  const missing = offer.lines.filter((l) => !l.available);
  if (missing.length) {
    reasons.push({
      rule: 'unavailable_lines',
      message: `${missing.length} line(s) can't be delivered in full on ${offer.deliveryDate} (${missing.map((l) => `${l.productName}: ${l.reason ?? l.status}`).join('; ')}); only the rest would be ordered`,
      lineIds: missing.map((l) => l.lineId),
    });
  }

  if (policy.allowedCategories) {
    const allowed = new Set(policy.allowedCategories);
    const outside = orderable.filter((l) => !allowed.has(getProduct(l.productId)?.category ?? ''));
    if (outside.length) {
      reasons.push({ rule: 'category_not_allowed', message: `${outside.length} product(s) outside the allowed categories`, lineIds: outside.map((l) => l.lineId) });
    }
  }

  return { decision: reasons.length ? 'needs_approval' : 'auto', reasons };
}

/** The policy as agents and humans read it (MCP resource aimo://policy and getAuthorityPolicy). */
export function describePolicy(customerId: string) {
  const policy = policyFor(customerId);
  return {
    ...policy,
    rules: POLICY_RULES,
    decidedBy: 'The Aimo gateway evaluates these rules deterministically on every placeOrder. Language models never decide.',
    approvals: `Orders that need sign-off wait for ${policy.approver.name} (${policy.approver.role}) on the Aimo approval page. No MCP tool can approve.`,
    pricing: 'Fixed Valio catalogue prices excl. VAT. An offer holds its prices for at most ' +
      `${policy.offerValidityMinutes} min and never past the order cut-off; any price or stock change returns a new offer (requote).`,
  };
}
