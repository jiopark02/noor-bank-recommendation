const CARD_PAYMENT_DETAILED = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Whether a category marks a credit-card payment: the PFC detailed category
 * LOAN_PAYMENTS_CREDIT_CARD_PAYMENT, or, only when there is no PFC at all,
 * the legacy category Payment / Credit Card. The adapter uses it to count
 * card-payment streams in its log.
 */
export function isCardPaymentCategory(c: {
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  legacyCategory: string[];
}): boolean {
  if (c.pfcDetailed === CARD_PAYMENT_DETAILED) return true;
  if (nonEmpty(c.pfcPrimary) || nonEmpty(c.pfcDetailed)) return false;
  const legacy = Array.isArray(c.legacyCategory) ? c.legacyCategory : [];
  return legacy[0] === "Payment" && legacy[1] === "Credit Card";
}
