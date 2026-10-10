import { describe, it, expect } from "vitest";
import { computeSafeToSpend } from "../financeEngine/safeToSpend";
import { computeRecurring } from "../financeEngine/recurring";
import { DEFAULT_POLICY } from "../financeEngine/index";
import type {
  EngineAccount,
  EngineInput,
  EnginePolicy,
  EngineRecurringStream,
} from "../financeEngine/types";

/**
 * Finance engine — safe-to-spend, the single definition (plan D4).
 *
 * Mutations that turn this file red:
 *   - available and current swapped                -> "the §6 scenario"
 *   - result clamped with Math.max(0, …)            -> "a negative result stays negative"
 *   - credit-card reserve removed                   -> "the §6 scenario"
 *   - "savings" added to DEFAULT_POLICY subtypes    -> "savings and money market are not spendable cash"
 *   - other-currency push removed                   -> "other-currency and null-currency accounts are listed"
 *   - accounts iterated without uniqueAccounts      -> "a duplicate accountId is counted once"
 *   - bufferCents check removed                     -> "a non-integer buffer is a caller bug"
 *   - SEMI_MONTHLY assumption push removed          -> "states the SEMI_MONTHLY spacing approximation"
 *   - due-today assumption push removed             -> "a charge due today is flagged"
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

const netflix: EngineRecurringStream = {
  streamId: "netflix",
  label: "Netflix",
  frequency: "MONTHLY",
  averageAmountCents: 1549,
  lastAmountCents: 1549,
  currency: "USD",
  lastDate: "2026-09-20",
  predictedNextDate: "2026-10-20",
  isActive: true,
  status: "MATURE",
};
const insurance: EngineRecurringStream = {
  ...netflix,
  streamId: "ins",
  label: "Insurance",
  frequency: "ANNUALLY",
  averageAmountCents: 60000,
  lastAmountCents: 60000,
  lastDate: "2026-03-01",
  predictedNextDate: "2027-03-01",
};

function scenario(): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    currency: "USD",
    accounts: [
      account({}),
      account({ accountId: "sav", subtype: "savings", currentCents: 500000, availableCents: 500000 }),
      account({ accountId: "card", type: "credit", subtype: "credit card", currentCents: 60000, availableCents: null, limitCents: 200000 }),
    ],
    transactions: [],
    period: { start: "2026-09-11", end: "2026-10-10", completeness: "complete" },
    recurring: { source: "plaid_streams", streams: [netflix, insurance] },
  };
}

function run(input: EngineInput, policy: EnginePolicy = DEFAULT_POLICY) {
  return computeSafeToSpend(input, policy, computeRecurring(input));
}

describe("computeSafeToSpend", () => {
  it("the §6 scenario", () => {
    const r = run(scenario());
    expect(r.status).toBe("computed");
    expect(r.amountCents).toBe(118451);
    expect(r.uncoveredObligationsCents).toBe(0);
    expect(r.obligationsExceedCash).toBe(false);
    expect(r.horizon).toEqual({ from: "2026-10-10", to: "2026-10-31", rule: "end_of_calendar_month_utc" });
    expect(r.inputs.balances).toEqual([
      { accountId: "chk", subtype: "checking", field: "available", cents: 180000, asOf: null, fetchedAt: FETCHED, asOfSource: "unknown" },
    ]);
    expect(r.inputs.upcomingRecurring).toEqual([
      { streamId: "netflix", label: "Netflix", dueDate: "2026-10-20", cents: 1549 },
    ]);
    expect(r.inputs.creditCardBalances).toEqual([
      { accountId: "card", cents: 60000, asOf: null, fetchedAt: FETCHED, asOfSource: "unknown" },
    ]);
    expect(r.totals).toEqual({
      spendableCashCents: 180000,
      upcomingRecurringCents: 1549,
      reservedCreditCents: 60000,
      bufferCents: 0,
    });
    expect(r.policy).toEqual(DEFAULT_POLICY);
    expect(r.freshness).toEqual({ oldestAsOf: null, oldestFetchedAt: FETCHED, anyAsOfUnknown: true });
    expect(r.assumptions).toEqual([
      "dates_utc",
      "available_reflects_pending",
      "credit_balances_reserved_in_full",
      "balance_as_of_unknown",
    ]);
  });

  it("savings and money market are not spendable cash", () => {
    const input = scenario();
    input.accounts.push(account({ accountId: "mm", subtype: "money market", currentCents: 100000, availableCents: 100000 }));
    const r = run(input);
    expect(r.inputs.balances.map((b) => b.accountId)).toEqual(["chk"]);
    expect(r.totals.spendableCashCents).toBe(180000);
  });

  it("a depository account with no subtype is left out and the omission is stated", () => {
    const input = scenario();
    input.accounts.push(account({ accountId: "x", subtype: null }));
    const r = run(input);
    expect(r.totals.spendableCashCents).toBe(180000);
    expect(r.assumptions).toContain("unknown_subtype_excluded");
  });

  it("falls back to the current balance and says so", () => {
    const input = scenario();
    input.accounts[0] = account({ availableCents: null });
    const r = run(input);
    expect(r.inputs.balances[0]).toMatchObject({ field: "current", cents: 200000 });
    expect(r.assumptions).toContain("current_used_when_available_missing");
    expect(r.assumptions).not.toContain("available_reflects_pending");
  });

  it("a negative result stays negative (§6 variant)", () => {
    const input = scenario();
    input.accounts[0] = account({ availableCents: -20000 });
    input.accounts[1] = account({ accountId: "sav", subtype: "savings", currentCents: 0, availableCents: 0 });
    const r = run(input);
    expect(r.amountCents).toBe(-81549);
    expect(r.uncoveredObligationsCents).toBe(81549);
    expect(r.obligationsExceedCash).toBe(true);
  });

  it("no spendable cash account: unavailable, not zero", () => {
    const input = scenario();
    input.accounts = input.accounts.filter((a) => a.accountId !== "chk");
    const r = run(input);
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("no_spendable_balance");
    expect(r.amountCents).toBeNull();
    expect(r.uncoveredObligationsCents).toBeNull();
    expect(r.obligationsExceedCash).toBe(false);
  });

  it("computes without recurring data and states it", () => {
    const input = scenario();
    input.recurring = { source: "unavailable" };
    const r = run(input);
    expect(r.amountCents).toBe(120000);
    expect(r.assumptions).toContain("recurring_unavailable");
  });

  it("lists recurring streams it could not date or include", () => {
    const input = scenario();
    input.recurring = {
      source: "plaid_streams",
      streams: [
        netflix,
        { ...netflix, streamId: "nodate", predictedNextDate: null, lastDate: null },
        { ...netflix, streamId: "unk", frequency: "UNKNOWN" },
      ],
    };
    const r = run(input);
    expect(r.inputs.excludedRecurring).toEqual([
      { streamId: "unk", reason: "unknown_frequency" },
      { streamId: "nodate", reason: "no_next_date" },
    ]);
    expect(r.assumptions).toContain("recurring_without_next_date_excluded");
  });

  it("policy: no card reserve and a buffer are honored and echoed", () => {
    const policy: EnginePolicy = { ...DEFAULT_POLICY, reserveCreditCardBalances: false, bufferCents: 10000 };
    const r = run(scenario(), policy);
    expect(r.amountCents).toBe(180000 - 1549 - 10000);
    expect(r.inputs.creditCardBalances).toEqual([]);
    expect(r.policy).toEqual(policy);
    expect(r.assumptions).not.toContain("credit_balances_reserved_in_full");
  });

  it("reports the oldest institution as-of time when every balance has one", () => {
    const input = scenario();
    input.accounts[0] = account({ balanceAsOf: "2026-10-09T08:00:00Z" });
    input.accounts[2] = account({
      accountId: "card", type: "credit", subtype: "credit card", currentCents: 60000, availableCents: null,
      limitCents: 200000, balanceAsOf: "2026-10-08T08:00:00Z",
    });
    const r = run(input);
    expect(r.freshness).toEqual({ oldestAsOf: "2026-10-08T08:00:00Z", oldestFetchedAt: FETCHED, anyAsOfUnknown: false });
    expect(r.assumptions).not.toContain("balance_as_of_unknown");
  });

  it("other-currency and null-currency accounts are listed, not skipped", () => {
    const input = scenario();
    input.accounts.push(
      account({ accountId: "cadchk", currency: "CAD" }),
      account({ accountId: "nocur", type: "credit", subtype: "credit card", currency: null, currentCents: 90000, availableCents: null })
    );
    const r = run(input);
    expect(r.amountCents).toBe(118451);
    expect(r.inputs.excludedAccounts).toEqual([
      { accountId: "cadchk", reason: "other_currency" },
      { accountId: "nocur", reason: "other_currency" },
    ]);
    expect(r.assumptions).toContain("other_currency_accounts_excluded");
  });

  it("a spendable account with no balance at all is listed", () => {
    const input = scenario();
    input.accounts.push(account({ accountId: "empty", availableCents: null, currentCents: null }));
    const r = run(input);
    expect(r.inputs.excludedAccounts).toEqual([{ accountId: "empty", reason: "no_balance" }]);
    expect(r.amountCents).toBe(118451);
  });

  it("a duplicate accountId is counted once (first wins)", () => {
    const input = scenario();
    input.accounts.push(account({ availableCents: 999999 }));
    expect(run(input).totals.spendableCashCents).toBe(180000);
  });

  it("a non-integer buffer is a caller bug", () => {
    expect(() => run(scenario(), { ...DEFAULT_POLICY, bufferCents: 1.5 })).toThrow(/invalid bufferCents/);
    expect(() => run(scenario(), { ...DEFAULT_POLICY, bufferCents: NaN })).toThrow(/invalid bufferCents/);
  });

  it("states the SEMI_MONTHLY spacing approximation when such a stream is used", () => {
    const input = scenario();
    input.recurring = {
      source: "plaid_streams",
      streams: [{ ...netflix, streamId: "semi", frequency: "SEMI_MONTHLY", predictedNextDate: "2026-10-15" }],
    };
    const r = run(input);
    expect(r.inputs.upcomingRecurring.map((u) => u.dueDate)).toEqual(["2026-10-15", "2026-10-30"]);
    expect(r.assumptions).toContain("semi_monthly_spacing_approximated");
    expect(run(scenario()).assumptions).not.toContain("semi_monthly_spacing_approximated");
  });

  it("a charge due today is flagged when an available balance is used", () => {
    const input = scenario();
    input.recurring = { source: "plaid_streams", streams: [{ ...netflix, predictedNextDate: "2026-10-10" }] };
    const r = run(input);
    // Arithmetic unchanged: the charge is still subtracted.
    expect(r.amountCents).toBe(180000 - 1549 - 60000);
    expect(r.assumptions).toContain("recurring_due_today_may_already_be_pending");

    input.accounts[0] = account({ availableCents: null });
    expect(run(input).assumptions).not.toContain("recurring_due_today_may_already_be_pending");
  });

  it("throws only on an unparseable now", () => {
    const input = scenario();
    input.now = "not a time";
    expect(() => run(input)).toThrow();
    input.now = "2026-10-10T12:00:00";
    expect(() => run(input)).toThrow(/invalid now/);
  });
});
