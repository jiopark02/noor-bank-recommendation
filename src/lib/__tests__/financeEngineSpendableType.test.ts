import { describe, it, expect } from "vitest";
import { computeFinancialSummary, DEFAULT_POLICY } from "../financeEngine";
import type { EngineAccount } from "../financeEngine";

/**
 * Spendable cash is decided by account type first, then by subtype. "paypal"
 * is a spendable subtype, and Plaid can report it on more than one account
 * type: only a depository account with that subtype is cash. A credit account
 * whose subtype reads "paypal" (a PayPal credit line) is money owed, not money
 * held, and must never be counted as cash.
 *
 * Mutations that turn this file red:
 *   - the depository type check removed from the spendable-cash branch
 *     -> "a credit account with subtype paypal is not cash"
 *   - "paypal" removed from the default spendable subtypes
 *     -> "a depository account with subtype paypal is cash"
 */

function account(type: EngineAccount["type"], subtype: string, cents: number): EngineAccount {
  return {
    accountId: `${type}-${subtype}`,
    type,
    subtype,
    currentCents: cents,
    availableCents: cents,
    limitCents: type === "credit" ? 500000 : null,
    currency: "USD",
    balanceAsOf: null,
    fetchedAt: "2026-11-11T11:59:00Z",
    duplicateKey: null,
    connectionKey: "c0",
  };
}

function spendableCash(accounts: EngineAccount[], policy = DEFAULT_POLICY): number {
  return computeFinancialSummary(
    {
      now: "2026-11-11T12:00:00Z",
      today: "2026-11-11",
      dateBasis: "utc",
      readWindow: { start: "2026-08-14", end: "2026-11-11" },
      currency: "USD",
      accounts,
      transactions: [],
      period: { start: "2026-08-14", end: "2026-11-11" },
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
    },
    policy
  ).safeToSpend.totals.spendableCashCents;
}

describe("spendable cash: account type before subtype", () => {
  it("the default policy lists paypal as a spendable subtype", () => {
    expect(DEFAULT_POLICY.spendableSubtypes).toContain("paypal");
  });

  it("a credit account with subtype paypal is not cash", () => {
    expect(spendableCash([account("credit", "paypal", 40000)])).toBe(0);
    expect(
      spendableCash([account("depository", "checking", 10000), account("credit", "paypal", 40000)])
    ).toBe(10000);
  });

  it("is not cash whether or not card balances are reserved", () => {
    for (const reserveCreditCardBalances of [true, false]) {
      expect(
        spendableCash([account("credit", "paypal", 40000)], {
          ...DEFAULT_POLICY,
          reserveCreditCardBalances,
        })
      ).toBe(0);
    }
  });

  it("a depository account with subtype paypal is cash", () => {
    expect(spendableCash([account("depository", "paypal", 7000)])).toBe(7000);
    expect(
      spendableCash([account("depository", "paypal", 7000), account("credit", "paypal", 40000)])
    ).toBe(7000);
  });
});
