import { describe, it, expect } from "vitest";
import { classifyTransaction } from "../financeEngine/classify";
import type {
  EngineAccount,
  EngineTransaction,
} from "../financeEngine/types";

/**
 * Finance engine — transaction classification (plan D2, option B).
 *
 * Mutations that turn this file red:
 *   - legacy checked before PFC                    -> "PFC wins over legacy"
 *   - legacy Transfer/Payroll exception removed    -> "legacy payroll is income"
 *   - card-payment branch removed                  -> "card payment, both legs"
 *   - detailed-only rule removed from sourceOf     -> "card payment from pfcDetailed alone"
 */

const checking: EngineAccount = {
  accountId: "chk",
  type: "depository",
  subtype: "checking",
  currentCents: 0,
  availableCents: 0,
  limitCents: null,
  currency: "USD",
  balanceAsOf: null,
  fetchedAt: "2026-10-10T11:59:00Z",
};
const card: EngineAccount = { ...checking, accountId: "card", type: "credit", subtype: "credit card" };
const loan: EngineAccount = { ...checking, accountId: "loan", type: "loan", subtype: "student" };

function txn(over: Partial<EngineTransaction>): EngineTransaction {
  return {
    transactionId: "t",
    accountId: "chk",
    amountCents: 1000,
    currency: "USD",
    date: "2026-10-01",
    pending: false,
    pfcPrimary: null,
    pfcDetailed: null,
    legacyCategory: [],
    ...over,
  };
}

describe("classifyTransaction — PFC", () => {
  it("INCOME inflow is income", () => {
    expect(
      classifyTransaction(txn({ amountCents: -250000, pfcPrimary: "INCOME", pfcDetailed: "INCOME_WAGES" }), checking)
    ).toEqual({ cls: "income", source: "pfc" });
  });

  it("account transfers are excluded as movement between accounts", () => {
    expect(
      classifyTransaction(txn({ pfcPrimary: "TRANSFER_OUT", pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" }), checking).cls
    ).toBe("excluded_between_accounts");
  });

  it("v2 transfer-to-app is excluded the same way", () => {
    expect(
      classifyTransaction(txn({ pfcPrimary: "TRANSFER_OUT", pfcDetailed: "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS" }), checking).cls
    ).toBe("excluded_between_accounts");
  });

  it("card payment, both legs", () => {
    const pfc = { pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" };
    expect(classifyTransaction(txn({ ...pfc, amountCents: 50000 }), checking).cls).toBe("excluded_card_payment");
    expect(classifyTransaction(txn({ ...pfc, accountId: "card", amountCents: -50000 }), card).cls).toBe(
      "excluded_card_payment"
    );
  });

  it("card payment from pfcDetailed alone", () => {
    expect(
      classifyTransaction(txn({ amountCents: 50000, pfcPrimary: null, pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }), checking)
    ).toEqual({ cls: "excluded_card_payment", source: "pfc" });
  });

  it("other loan payments are spending", () => {
    expect(
      classifyTransaction(txn({ pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT" }), checking).cls
    ).toBe("spending");
  });

  it("a spending-category inflow is a refund", () => {
    expect(
      classifyTransaction(txn({ amountCents: -5000, pfcPrimary: "GENERAL_MERCHANDISE" }), card).cls
    ).toBe("refund");
  });

  it("PFC wins over legacy", () => {
    expect(
      classifyTransaction(
        txn({ amountCents: -5000, pfcPrimary: "GENERAL_MERCHANDISE", legacyCategory: ["Transfer", "Deposit"] }),
        checking
      )
    ).toEqual({ cls: "refund", source: "pfc" });
  });
});

describe("classifyTransaction — legacy fallback", () => {
  it("legacy payroll is income", () => {
    expect(
      classifyTransaction(txn({ amountCents: -250000, legacyCategory: ["Transfer", "Payroll"] }), checking)
    ).toEqual({ cls: "income", source: "legacy" });
  });

  it("other legacy transfers are excluded", () => {
    expect(classifyTransaction(txn({ legacyCategory: ["Transfer", "Deposit"] }), checking).cls).toBe(
      "excluded_between_accounts"
    );
  });

  it("legacy card payment is excluded", () => {
    expect(classifyTransaction(txn({ legacyCategory: ["Payment", "Credit Card"] }), checking).cls).toBe(
      "excluded_card_payment"
    );
  });

  it("legacy inflow cannot be called income", () => {
    expect(classifyTransaction(txn({ amountCents: -100, legacyCategory: ["Shops"] }), checking).cls).toBe(
      "unclassified_inflow"
    );
  });
});

describe("classifyTransaction — no category, accounts, pending", () => {
  it("an uncategorized inflow stays unclassified", () => {
    expect(classifyTransaction(txn({ amountCents: -100 }), checking)).toEqual({
      cls: "unclassified_inflow",
      source: "none",
    });
    expect(classifyTransaction(txn({ amountCents: 100 }), checking).cls).toBe("spending");
  });

  it("pending is excluded", () => {
    expect(classifyTransaction(txn({ pending: true, pfcPrimary: "FOOD_AND_DRINK" }), checking).cls).toBe(
      "excluded_pending"
    );
  });

  it("a loan account's transactions are excluded", () => {
    expect(classifyTransaction(txn({ accountId: "loan" }), loan).cls).toBe("excluded_non_cash_account");
  });

  it("an unknown account is excluded", () => {
    expect(classifyTransaction(txn({ accountId: "nope" }), undefined).cls).toBe("excluded_unknown_account");
  });
});
