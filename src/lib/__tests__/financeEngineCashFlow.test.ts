import { describe, it, expect } from "vitest";
import { computeCashFlow } from "../financeEngine/cashFlow";
import type {
  EngineAccount,
  EngineInput,
  EngineTransaction,
} from "../financeEngine/types";

/**
 * Finance engine — cash flow over the caller's period (plan §6 scenario).
 *
 * Mutations that turn this file red:
 *   - pending check removed from classifyTransaction -> "the §6 scenario" (gross 160500)
 *   - refund counted as income                       -> "the §6 scenario"
 *   - ownership assumption code no longer emitted    -> "exposes the ownership assumption"
 */

const FETCHED = "2026-10-10T11:59:00Z";

function account(over: Partial<EngineAccount>): EngineAccount {
  return {
    accountId: "chk",
    type: "depository",
    subtype: "checking",
    currentCents: 200000,
    availableCents: 180000,
    limitCents: null,
    currency: "USD",
    balanceAsOf: null,
    fetchedAt: FETCHED,
    ...over,
  };
}

function txn(id: string, over: Partial<EngineTransaction>): EngineTransaction {
  return {
    transactionId: id,
    accountId: "chk",
    amountCents: 0,
    currency: "USD",
    date: "2026-10-01",
    pending: false,
    pfcPrimary: null,
    pfcDetailed: null,
    legacyCategory: [],
    ...over,
  };
}

function scenario(): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    currency: "USD",
    accounts: [
      account({}),
      account({ accountId: "sav", subtype: "savings", currentCents: 500000, availableCents: 500000 }),
      account({ accountId: "card", type: "credit", subtype: "credit card", currentCents: 60000, availableCents: null, limitCents: 200000 }),
    ],
    transactions: [
      txn("pay", { amountCents: -250000, pfcPrimary: "INCOME", pfcDetailed: "INCOME_WAGES" }),
      txn("rent", { amountCents: 120000, pfcPrimary: "RENT_AND_UTILITIES", pfcDetailed: "RENT_AND_UTILITIES_RENT" }),
      txn("groc", { accountId: "card", amountCents: 40000, date: "2026-10-03", pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: "FOOD_AND_DRINK_GROCERIES" }),
      txn("ccp-out", { amountCents: 50000, date: "2026-10-05", pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
      txn("ccp-in", { accountId: "card", amountCents: -50000, date: "2026-10-05", pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
      txn("sav-out", { amountCents: 30000, date: "2026-10-06", pfcPrimary: "TRANSFER_OUT", pfcDetailed: "TRANSFER_OUT_SAVINGS" }),
      txn("sav-in", { accountId: "sav", amountCents: -30000, date: "2026-10-06", pfcPrimary: "TRANSFER_IN", pfcDetailed: "TRANSFER_IN_SAVINGS" }),
      txn("refund", { accountId: "card", amountCents: -5000, date: "2026-10-07", pfcPrimary: "GENERAL_MERCHANDISE", pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE" }),
      txn("coffee", { amountCents: 500, date: "2026-10-09", pending: true, pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: "FOOD_AND_DRINK_COFFEE" }),
    ],
    period: { start: "2026-09-11", end: "2026-10-10", completeness: "complete" },
    recurring: { source: "unavailable" },
  };
}

describe("computeCashFlow", () => {
  it("the §6 scenario", () => {
    const r = computeCashFlow(scenario());
    expect(r.incomeCents).toBe(250000);
    expect(r.spendingGrossCents).toBe(160000);
    expect(r.refundsCents).toBe(5000);
    expect(r.spendingNetCents).toBe(155000);
    expect(r.netCents).toBe(95000);
    expect(r.unclassifiedInflowCents).toBe(0);
    expect(r.excluded.pending).toEqual({ count: 1, cents: 500 });
    expect(r.excluded.betweenAccounts).toEqual({ count: 2, cents: 60000 });
    expect(r.excluded.cardPayments).toEqual({ count: 2, cents: 100000 });
    expect(r.classificationSource).toEqual({ pfc: 9, legacy: 0, none: 0 });
    expect(r.period).toEqual({ start: "2026-09-11", end: "2026-10-10", days: 30, completeness: "complete" });
  });

  it("exposes the ownership assumption when anything was excluded as movement between accounts", () => {
    const r = computeCashFlow(scenario());
    expect(r.assumptions).toContain("account_to_account_excluded_ownership_unknown");
    expect(r.assumptions).toContain("dates_utc");
  });

  it("does not claim the ownership assumption when nothing was excluded for it", () => {
    const input = scenario();
    input.transactions = input.transactions.filter((t) => t.pfcPrimary !== "TRANSFER_IN" && t.pfcPrimary !== "TRANSFER_OUT");
    expect(computeCashFlow(input).assumptions).not.toContain("account_to_account_excluded_ownership_unknown");
  });

  it("counts out-of-period, other-currency and invalid items instead of using them", () => {
    const input = scenario();
    input.transactions.push(
      txn("old", { amountCents: 999, date: "2026-09-10" }),
      txn("cad", { amountCents: 999, currency: "CAD" }),
      txn("nullcur", { amountCents: 999, currency: null }),
      txn("frac", { amountCents: 9.5 }),
      txn("baddate", { amountCents: 999, date: "2026-10-32" })
    );
    const r = computeCashFlow(input);
    expect(r.excluded.outsidePeriod.count).toBe(1);
    expect(r.excluded.otherCurrency.count).toBe(2);
    expect(r.excluded.invalid.count).toBe(2);
    expect(r.spendingGrossCents).toBe(160000);
  });

  it("labels legacy and uncategorized data", () => {
    const input = scenario();
    input.transactions = [
      txn("a", { amountCents: -100, legacyCategory: ["Shops"] }),
      txn("b", { amountCents: -200 }),
    ];
    const r = computeCashFlow(input);
    expect(r.unclassifiedInflowCents).toBe(300);
    expect(r.incomeCents).toBe(0);
    expect(r.classificationSource).toEqual({ pfc: 0, legacy: 1, none: 1 });
    expect(r.assumptions).toEqual(["dates_utc", "legacy_categories_used", "no_category_data"]);
  });

  it("empty transactions give zero totals and keep the period", () => {
    const input = scenario();
    input.transactions = [];
    const r = computeCashFlow(input);
    expect(r.incomeCents).toBe(0);
    expect(r.spendingNetCents).toBe(0);
    expect(r.netCents).toBe(0);
    expect(r.period.days).toBe(30);
  });

  it("an invalid period counts everything as outside it", () => {
    const input = scenario();
    input.period = { start: "2026-10-10", end: "2026-09-01", completeness: "unknown" };
    const r = computeCashFlow(input);
    expect(r.period.days).toBe(0);
    expect(r.excluded.outsidePeriod.count).toBe(9);
  });
});
