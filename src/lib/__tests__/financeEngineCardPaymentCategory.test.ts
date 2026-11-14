import { describe, it, expect } from "vitest";
import { isCardPaymentCategory } from "../financeEngine/classify";

/**
 * The card-payment category rule the adapter logs recurring streams by.
 *
 * Mutations that turn this file red:
 *   - the legacy fallback removed, or used when PFC is present
 *   - the PFC detailed category no longer decisive on its own
 */

const CARD_PAYMENT = {
  pfcPrimary: "LOAN_PAYMENTS",
  pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
};

describe("the category rule", () => {
  it("PFC detailed decides; the legacy category counts only without PFC", () => {
    expect(isCardPaymentCategory({ ...CARD_PAYMENT, legacyCategory: [] })).toBe(true);
    expect(isCardPaymentCategory({ pfcPrimary: null, pfcDetailed: null, legacyCategory: ["Payment", "Credit Card"] })).toBe(true);
    expect(
      isCardPaymentCategory({ pfcPrimary: "ENTERTAINMENT", pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES", legacyCategory: ["Payment", "Credit Card"] })
    ).toBe(false);
    expect(isCardPaymentCategory({ pfcPrimary: null, pfcDetailed: null, legacyCategory: ["Payment"] })).toBe(false);
  });
});
