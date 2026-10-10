import { describe, it, expect } from "vitest";
import { computeCreditUtilization } from "../financeEngine/creditUtilization";
import type { EngineAccount, EngineInput } from "../financeEngine/types";

/**
 * Finance engine — credit utilization, descriptive only.
 *
 * Mutations that turn this file red:
 *   - Math.round removed from the per-card ratio       -> "rounds to whole basis points"
 *   - aggregate also includes no_limit / no_balance    -> "aggregates only measured and credit-balance cards"
 *   - other-currency card no longer listed             -> "lists other-currency and null-currency cards"
 */

function card(over: Partial<EngineAccount>): EngineAccount {
  return {
    accountId: "card",
    type: "credit",
    subtype: "credit card",
    currentCents: 60000,
    availableCents: null,
    limitCents: 200000,
    currency: "USD",
    balanceAsOf: null,
    fetchedAt: "2026-10-10T11:59:00Z",
    ...over,
  };
}

function input(accounts: EngineAccount[]): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    currency: "USD",
    accounts,
    transactions: [],
    period: { start: "2026-09-11", end: "2026-10-10", completeness: "complete" },
    recurring: { source: "unavailable" },
  };
}

describe("computeCreditUtilization", () => {
  it("60000 of 200000 is 3000 basis points (§6)", () => {
    const r = computeCreditUtilization(input([card({})]));
    expect(r.accounts[0]).toMatchObject({ state: "measured", ratioBasisPoints: 3000, asOfSource: "unknown" });
    expect(r.aggregate).toEqual({
      balanceCents: 60000,
      limitCents: 200000,
      ratioBasisPoints: 3000,
      accountsIncluded: 1,
      accountsExcluded: 0,
    });
  });

  it("rounds to whole basis points", () => {
    const r = computeCreditUtilization(input([card({ currentCents: 1, limitCents: 3 })]));
    expect(r.accounts[0].ratioBasisPoints).toBe(3333);
  });

  it("aggregates only measured and credit-balance cards", () => {
    const r = computeCreditUtilization(
      input([
        card({ accountId: "a", currentCents: 50000, limitCents: 100000 }),
        card({ accountId: "b", currentCents: -1000, limitCents: 100000 }),
        card({ accountId: "c", currentCents: 90000, limitCents: null }),
        card({ accountId: "d", currentCents: 90000, limitCents: 0 }),
        card({ accountId: "e", currentCents: null, limitCents: 100000 }),
      ])
    );
    expect(r.accounts.map((a) => [a.accountId, a.state, a.ratioBasisPoints])).toEqual([
      ["a", "measured", 5000],
      ["b", "credit_balance", 0],
      ["c", "no_limit", null],
      ["d", "no_limit", null],
      ["e", "no_balance", null],
    ]);
    expect(r.aggregate).toEqual({
      balanceCents: 50000,
      limitCents: 200000,
      ratioBasisPoints: 2500,
      accountsIncluded: 2,
      accountsExcluded: 3,
    });
  });

  it("reports the institution's as-of time when it is given", () => {
    const r = computeCreditUtilization(input([card({ balanceAsOf: "2026-10-09T08:00:00Z" })]));
    expect(r.accounts[0]).toMatchObject({ asOf: "2026-10-09T08:00:00Z", asOfSource: "institution" });
  });

  it("no cards: null aggregate ratio", () => {
    const r = computeCreditUtilization(input([]));
    expect(r.accounts).toEqual([]);
    expect(r.aggregate.ratioBasisPoints).toBeNull();
  });

  it("ignores non-credit accounts and counts other currencies as excluded", () => {
    const r = computeCreditUtilization(
      input([card({ accountId: "chk", type: "depository", subtype: "checking" }), card({ accountId: "cad", currency: "CAD" })])
    );
    expect(r.accounts).toEqual([]);
    expect(r.aggregate.accountsExcluded).toBe(1);
  });

  it("lists other-currency and null-currency cards and states it", () => {
    const r = computeCreditUtilization(
      input([card({}), card({ accountId: "cad", currency: "CAD" }), card({ accountId: "nocur", currency: null })])
    );
    expect(r.excludedAccounts).toEqual([
      { accountId: "cad", reason: "other_currency" },
      { accountId: "nocur", reason: "other_currency" },
    ]);
    expect(r.assumptions).toEqual(["other_currency_accounts_excluded"]);
    expect(r.aggregate.ratioBasisPoints).toBe(3000);
  });

  it("states nothing when every card is in the input currency", () => {
    const r = computeCreditUtilization(input([card({})]));
    expect(r.excludedAccounts).toEqual([]);
    expect(r.assumptions).toEqual([]);
  });
});
