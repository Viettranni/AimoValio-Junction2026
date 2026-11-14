// Per-customer authority policies: what a purchasing agent may order on its own, and who signs off the rest.
// Data, not code paths: the gateway evaluates these (src/gateway/policy.ts); no language model ever decides.

export interface AuthorityPolicy {
  customerId: string;
  customerName: string;
  currency: 'EUR';
  /** An order whose total excl. VAT is above this needs a human sign-off. */
  autoApproveLimitEur: number;
  approver: { name: string; role: string };
  /** Valio category codes the agent may buy without sign-off; undefined = any category. */
  allowedCategories?: string[];
  /** An order this close to its cut-off needs sign-off (a human may not make it in time later). */
  cutoffMarginMinutes: number;
  /** Fixed catalogue prices only: there is no negotiation input anywhere in the gateway. */
  negotiation: false;
  /** How long a quoted offer holds its prices, at most until the order cut-off. */
  offerValidityMinutes: number;
}

export const POLICIES: Record<string, AuthorityPolicy> = {
  'helsinki-juhlapalvelu': {
    customerId: 'helsinki-juhlapalvelu',
    customerName: 'Helsinki Juhlapalvelu Oy',
    currency: 'EUR',
    autoApproveLimitEur: 1000,
    approver: { name: 'Anna Virtanen', role: 'Purchasing manager' },
    cutoffMarginMinutes: 60,
    negotiation: false,
    offerValidityMinutes: 15,
  },
};

/** Customers without their own policy: small orders only, everything else goes to a human. */
export function policyFor(customerId: string): AuthorityPolicy {
  return POLICIES[customerId] ?? {
    customerId,
    customerName: customerId,
    currency: 'EUR',
    autoApproveLimitEur: 250,
    approver: { name: 'Purchasing manager', role: 'Purchasing manager' },
    cutoffMarginMinutes: 60,
    negotiation: false,
    offerValidityMinutes: 15,
  };
}

/** The rules the gateway applies, in the order it applies them. Shown to agents as machine-readable policy. */
export const POLICY_RULES = [
  { id: 'total_over_limit', description: 'Order total excl. VAT is above autoApproveLimitEur.' },
  { id: 'allergen_unverified', description: 'A line fails, or cannot be verified against, the stated allergen and diet requirements.' },
  { id: 'substitution_outside_preferences', description: 'A line replaces another product (substituteFor) and the preferences do not allow substitutes.' },
  { id: 'late_delivery', description: 'The delivery date is later than preferences.latestDeliveryDate.' },
  { id: 'cutoff_risk', description: 'The order cut-off is less than cutoffMarginMinutes away.' },
  { id: 'unavailable_lines', description: 'A line cannot be delivered in full on the date; only the deliverable lines would be ordered.' },
  { id: 'category_not_allowed', description: 'A product is outside allowedCategories.' },
] as const;
