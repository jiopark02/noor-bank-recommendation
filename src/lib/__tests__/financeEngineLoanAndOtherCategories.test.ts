import { describe, it, expect } from "vitest";
import { classifyTransaction } from "../financeEngine/classify";
import { computeCashFlow } from "../financeEngine/cashFlow";
import { computeFinancialSummary } from "../financeEngine/index";
import type {
  EngineAccount,
  EngineInput,
  EngineTransaction,
} from "../financeEngine/types";

/**
 * Finance engine — the two PFC v2 primaries that are neither income nor
 * spending: LOAN_DISBURSEMENTS (borrowed money arriving) and OTHER (Plaid's
 * catch-all, which v1 filed as miscellaneous transfers).
 *
 * Mutations that turn this file red:
 *   - the LOAN_DISBURSEMENTS branch removed from classify -> an inflow falls
 *     through to "refund" and lowers net spending
 *   - the branch made sign-dependent                     -> the outflow case
 *   - the OTHER branch removed                           -> outflow counts as
 *     spending, inflow as a refund
 *   - a bucket's accumulation removed from cashFlow      -> the bucket totals
 *   - the dataIssues loop removed from the entry point   -> the issue list
 *   - issues collected by pfcPrimary alone, not from what the cash flow
 *     counted                                            -> the pending and
 *     out-of-period cases
 */

const checking: EngineAccount = {
  accountId: "chk",
  type: "depository",
  subtype: "checking",
  currentCents: 100000,
  availableCents: 100000,
  limitCents: null,
  currency: "USD",
  balanceAsOf: null,
  fetchedAt: "2026-10-10T11:59:00Z",
};

function txn(id: string, over: Partial<EngineTransaction>): EngineTransaction {
  return {
    transactionId: id,
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

function input(transactions: EngineTransaction[]): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    today: "2026-10-10",
    dateBasis: "utc",
    readWindow: { start: "2026-09-11", end: "2026-10-10" },
    currency: "USD",
    accounts: [checking],
    transactions,
    period: { start: "2026-09-11", end: "2026-10-10", completeness: "complete" },
    recurring: { source: "unavailable" },
  };
}

const loanIn = (id: string, over: Partial<EngineTransaction> = {}) =>
  txn(id, {
    amountCents: -500000,
    pfcPrimary: "LOAN_DISBURSEMENTS",
    pfcDetailed: "LOAN_DISBURSEMENTS_CASH_ADVANCES",
    ...over,
  });
const other = (id: string, over: Partial<EngineTransaction> = {}) =>
  txn(id, { pfcPrimary: "OTHER", pfcDetailed: "OTHER_OTHER", ...over });

describe("classifyTransaction — loan disbursements and the catch-all category", () => {
  it("a loan disbursement arriving is not income or a refund", () => {
    expect(classifyTransaction(loanIn("l"), checking)).toEqual({
      cls: "excluded_loan_disbursement",
      source: "pfc",
    });
  });

  it("a loan disbursement leaving is excluded the same way", () => {
    expect(classifyTransaction(loanIn("l", { amountCents: 500000 }), checking).cls).toBe(
      "excluded_loan_disbursement"
    );
  });

  it("the catch-all category is excluded at either sign", () => {
    expect(classifyTransaction(other("o", { amountCents: 1000 }), checking).cls).toBe(
      "excluded_unclassified_category"
    );
    expect(classifyTransaction(other("o", { amountCents: -1000 }), checking).cls).toBe(
      "excluded_unclassified_category"
    );
  });

  it("pending still wins over either category", () => {
    expect(classifyTransaction(other("o", { pending: true }), checking).cls).toBe(
      "excluded_pending"
    );
  });
});

describe("computeCashFlow — loan disbursements and the catch-all category", () => {
  it("both stay out of income, spending and refunds and land in their own buckets", () => {
    const cf = computeCashFlow(
      input([
        loanIn("l1"),
        other("o1", { amountCents: 1000 }),
        other("o2", { amountCents: -1000 }),
      ])
    );
    expect(cf.incomeCents).toBe(0);
    expect(cf.spendingGrossCents).toBe(0);
    expect(cf.refundsCents).toBe(0);
    expect(cf.unclassifiedInflowCents).toBe(0);
    expect(cf.excluded.loanDisbursements).toEqual({ count: 1, cents: 500000 });
    expect(cf.excluded.unclassifiedCategory).toEqual({ count: 2, cents: 2000 });
  });

  it("ordinary spending next to them is unchanged", () => {
    const cf = computeCashFlow(
      input([txn("s", { amountCents: 2500, pfcPrimary: "FOOD_AND_DRINK" }), other("o1")])
    );
    expect(cf.spendingGrossCents).toBe(2500);
  });
});

describe("computeFinancialSummary — catch-all transactions are reported", () => {
  it("lists each counted catch-all transaction once, and nothing it did not count", () => {
    const summary = computeFinancialSummary(
      input([
        other("o1"),
        other("o2", { amountCents: -700 }),
        other("o-pending", { pending: true }),
        other("o-old", { date: "2026-01-01" }),
        loanIn("l1"),
      ])
    );
    const issues = summary.dataIssues.filter((d) => d.reason === "unclassified_category");
    expect(issues).toEqual([
      { kind: "transaction", id: "o1", reason: "unclassified_category" },
      { kind: "transaction", id: "o2", reason: "unclassified_category" },
    ]);
    expect(issues.length).toBe(summary.cashFlow.excluded.unclassifiedCategory.count);
  });

  it("a summary without catch-all transactions carries no such issue", () => {
    const summary = computeFinancialSummary(input([loanIn("l1")]));
    expect(summary.dataIssues.filter((d) => d.reason === "unclassified_category")).toEqual([]);
  });
});
