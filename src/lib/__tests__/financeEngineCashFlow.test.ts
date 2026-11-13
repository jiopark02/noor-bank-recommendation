import { describe, it, expect } from "vitest";
import { computeCashFlow } from "../financeEngine/cashFlow";
import { computeFinancialSummary } from "../financeEngine";
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
 *   - a connection's duplicate or invalid count not added,
 *     or only the first connection's added            -> "transactions the caller left out"
 *   - a missing or malformed count added as is         -> "transactions the caller left out"
 *   - safe-to-spend or coverage reading the counts     -> "leaves every total ... as they were"
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
    duplicateKey: null,
    connectionKey: "c0",
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
    merchantEntityId: null,
    ...over,
  };
}

function scenario(): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    today: "2026-10-10",
    dateBasis: "utc",
    readWindow: { start: "2026-09-11", end: "2026-10-10" },
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
    period: { start: "2026-09-11", end: "2026-10-10" },
    connections: [
      {
        connectionKey: "c0",
        state: "ok",
        lastSuccessfulUpdate: null,
        recurringRead: "empty",
        transactionsTruncated: false,
        earliestTransactionDate: null,
      },
    ],
    recurring: { streams: [], incomeStreams: [] },
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

  it("states dates_utc only when today was taken in UTC", () => {
    const input = scenario();
    input.dateBasis = "user_time_zone";
    expect(computeCashFlow(input).assumptions).not.toContain("dates_utc");
  });

  // The read window is longer than the cash-flow period; only the period counts.
  it("counts only the period of a longer read window", () => {
    const input = scenario();
    input.readWindow = { start: "2025-09-09", end: "2026-10-10" };
    input.transactions.push(txn("last-year", { amountCents: 999, date: "2025-10-01" }));
    const r = computeCashFlow(input);
    expect(r.spendingGrossCents).toBe(160000);
    expect(r.excluded.outsidePeriod.count).toBe(1);
    expect(r.period.days).toBe(30);
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
    input.period = { start: "2026-10-10", end: "2026-09-01" };
    const r = computeCashFlow(input);
    expect(r.period.days).toBe(0);
    expect(r.excluded.outsidePeriod.count).toBe(9);
  });
});

describe("transactions the caller left out", () => {
  function withCounts(
    counts: Array<{ duplicate: unknown; invalid: unknown } | undefined>
  ): EngineInput {
    const input = scenario();
    const base = input.connections[0];
    input.connections = counts.map((c, i) => {
      const conn = { ...base, connectionKey: "c" + i };
      if (c !== undefined) {
        (conn as { invalidTransactions?: unknown }).invalidTransactions = c;
      }
      return conn;
    });
    return input;
  }

  it("adds every connection's duplicate and invalid counts to the invalid bucket", () => {
    const input = withCounts([
      { duplicate: 1, invalid: 2 },
      { duplicate: 0, invalid: 3 },
    ]);
    input.transactions.push(
      txn("frac", { amountCents: 9.5 }),
      txn("baddate", { amountCents: 999, date: "2026-10-32" })
    );
    expect(computeCashFlow(input).excluded.invalid.count).toBe(8);
  });

  it("a connection without counts adds nothing", () => {
    const r = computeCashFlow(withCounts([undefined, undefined]));
    expect(r.excluded.invalid.count).toBe(0);
  });

  it("a count that is not a non-negative safe integer adds nothing", () => {
    const input = withCounts([
      { duplicate: -1, invalid: Number.NaN },
      { duplicate: "2", invalid: 1.5 },
      { duplicate: Number.POSITIVE_INFINITY, invalid: null },
    ]);
    expect(computeCashFlow(input).excluded.invalid.count).toBe(0);
  });

  it("leaves every total, safe-to-spend and coverage as they were", () => {
    const without = computeFinancialSummary(withCounts([undefined]));
    const withThem = computeFinancialSummary(withCounts([{ duplicate: 2, invalid: 5 }]));
    expect(withThem.cashFlow.excluded.invalid.count).toBe(
      without.cashFlow.excluded.invalid.count + 7
    );
    expect(withThem.safeToSpend).toEqual(without.safeToSpend);
    expect(withThem.coverage).toEqual(without.coverage);
    expect(withThem.recurring).toEqual(without.recurring);
    expect(withThem.creditUtilization).toEqual(without.creditUtilization);
    expect(withThem.dataIssues).toEqual(without.dataIssues);
    const { excluded: exA, ...restA } = withThem.cashFlow;
    const { excluded: exB, ...restB } = without.cashFlow;
    expect(restA).toEqual(restB);
    expect({ ...exA, invalid: null }).toEqual({ ...exB, invalid: null });
  });
});
