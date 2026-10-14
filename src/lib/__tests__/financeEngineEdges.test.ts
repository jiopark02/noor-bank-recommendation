import { describe, it, expect } from "vitest";
import { computeFinancialSummary } from "../financeEngine/index";
import type {
  EngineAccount,
  EngineInput,
  EngineRecurringStream,
  EngineTransaction,
} from "../financeEngine/types";

/**
 * Finance engine — empty and malformed input through the entry point.
 *
 * Mutations that turn this file red:
 *   - isCents check dropped from isValidTransaction -> "bad items are skipped and reported"
 *   - now validation removed from computeFinancialSummary -> "throws on an unparseable now", "zone-less now throws"
 *   - creditUtilization iterates input.accounts directly  -> "a duplicate accountId: first wins …"
 *   - duplicate-account dataIssue removed                 -> "a duplicate accountId: first wins …"
 *   - each new dataIssue check removed                    -> the test named for that issue
 *   - year bound removed from parseYmd                    -> "a pre-2000 date reaches the existing failure paths"
 *   - computeRecurring iterates streams without uniqueStreams -> "a duplicate streamId: first copy wins …"
 *   - streamsById built last-wins                         -> "a duplicate streamId: first copy wins …"
 *   - null guard removed from uniqueStreams               -> "a null stream entry is skipped …"
 *   - uniqueStreams' seen made a plain object again       -> "a stream whose id is an Object.prototype name is kept"
 */

function empty(): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    currency: "USD",
    accounts: [],
    transactions: [],
    period: { start: "2026-09-11", end: "2026-10-10", completeness: "unknown" },
    recurring: { source: "unavailable" },
  };
}

function acct(over: Partial<EngineAccount>): EngineAccount {
  return {
    accountId: "chk",
    type: "depository",
    subtype: "checking",
    currentCents: 100,
    availableCents: 100,
    limitCents: null,
    currency: "USD",
    balanceAsOf: null,
    fetchedAt: "2026-10-10T11:59:00Z",
    ...over,
  };
}

function strm(over: Partial<EngineRecurringStream>): EngineRecurringStream {
  return {
    streamId: "s",
    label: "S",
    frequency: "MONTHLY",
    averageAmountCents: 1000,
    lastAmountCents: 1000,
    currency: "USD",
    lastDate: "2026-09-20",
    predictedNextDate: "2026-10-20",
    isActive: true,
    status: "MATURE",
    ...over,
  };
}

function txn(id: string, over: Partial<EngineTransaction>): EngineTransaction {
  return {
    transactionId: id,
    accountId: "chk",
    amountCents: 1000,
    currency: "USD",
    date: "2026-10-01",
    pending: false,
    pfcPrimary: "FOOD_AND_DRINK",
    pfcDetailed: null,
    legacyCategory: [],
    ...over,
  };
}

describe("computeFinancialSummary — edges", () => {
  it("completely empty input: no throw, zeros and nulls, unavailable", () => {
    const s = computeFinancialSummary(empty());
    expect(s.engineVersion).toBe("v1");
    expect(s.computedAt).toBe("2026-10-10T12:00:00Z");
    expect(s.cashFlow.netCents).toBe(0);
    expect(s.recurring.totalMonthlyCents).toBeNull();
    expect(s.safeToSpend.status).toBe("unavailable");
    expect(s.safeToSpend.amountCents).toBeNull();
    expect(s.creditUtilization.aggregate.ratioBasisPoints).toBeNull();
    expect(s.dataIssues).toEqual([]);
  });

  it("bad items are skipped and reported", () => {
    const input = empty();
    input.accounts = [
      {
        accountId: "chk", type: "depository", subtype: "checking", currentCents: 100, availableCents: 100,
        limitCents: null, currency: "USD", balanceAsOf: null, fetchedAt: "2026-10-10T11:59:00Z",
      },
    ];
    input.transactions = [
      txn("ok", {}),
      txn("frac", { amountCents: 10.5 }),
      txn("baddate", { date: "10/01/2026" }),
      txn("", {}),
      txn("ok", {}),
    ];
    const s = computeFinancialSummary(input);
    expect(s.cashFlow.spendingGrossCents).toBe(1000);
    expect(s.cashFlow.excluded.invalid.count).toBe(4);
    expect(s.dataIssues).toEqual([
      { kind: "transaction", id: "frac", reason: "invalid_amount" },
      { kind: "transaction", id: "baddate", reason: "invalid_date" },
      { kind: "transaction", id: "", reason: "missing_id" },
      { kind: "transaction", id: "ok", reason: "duplicate" },
    ]);
  });

  it("an invalid period is reported", () => {
    const input = empty();
    input.period = { start: "2026-02-30", end: "2026-10-10", completeness: "unknown" };
    expect(computeFinancialSummary(input).dataIssues).toEqual([
      { kind: "period", id: "period", reason: "invalid_period" },
    ]);
  });

  it("a fractional account or stream amount is reported", () => {
    const input = empty();
    input.accounts = [
      {
        accountId: "chk", type: "depository", subtype: "checking", currentCents: 1.5, availableCents: null,
        limitCents: null, currency: "USD", balanceAsOf: null, fetchedAt: "2026-10-10T11:59:00Z",
      },
    ];
    input.recurring = {
      source: "plaid_streams",
      streams: [
        {
          streamId: "s", label: "S", frequency: "MONTHLY", averageAmountCents: 2.5, lastAmountCents: null,
          currency: "USD", lastDate: null, predictedNextDate: null, isActive: true, status: "MATURE",
        },
      ],
    };
    const s = computeFinancialSummary(input);
    expect(s.dataIssues).toEqual([
      { kind: "account", id: "chk", reason: "invalid_amount" },
      { kind: "stream", id: "s", reason: "invalid_amount" },
    ]);
    expect(s.safeToSpend.status).toBe("unavailable");
    expect(s.recurring.excluded).toEqual([{ streamId: "s", reason: "no_amount" }]);
  });

  it("a duplicate accountId: first wins in every metric and is reported", () => {
    const input = empty();
    input.accounts = [
      acct({ accountId: "chk", availableCents: 100 }),
      acct({ accountId: "chk", type: "credit", subtype: "credit card", currentCents: 5000, availableCents: null, limitCents: 10000 }),
      acct({ accountId: "card", type: "credit", subtype: "credit card", currentCents: 1000, availableCents: null, limitCents: 10000 }),
    ];
    input.transactions = [txn("t1", {})];
    const s = computeFinancialSummary(input);
    // cash flow: the transaction is classified against the first (depository) chk
    expect(s.cashFlow.spendingGrossCents).toBe(1000);
    // safe-to-spend: chk counted once, as cash; the duplicate card balance is not reserved
    expect(s.safeToSpend.totals).toMatchObject({ spendableCashCents: 100, reservedCreditCents: 1000 });
    // credit utilization: only the real card
    expect(s.creditUtilization.accounts.map((a) => a.accountId)).toEqual(["card"]);
    expect(s.dataIssues).toEqual([{ kind: "account", id: "chk", reason: "duplicate" }]);
  });

  it("zone-less now throws", () => {
    const input = empty();
    input.now = "2026-10-10T12:00:00";
    expect(() => computeFinancialSummary(input)).toThrow(/^computeFinancialSummary: invalid now$/);
  });

  it("a zone-less fetchedAt is reported and treated as null", () => {
    const input = empty();
    input.accounts = [acct({ fetchedAt: "2026-10-10T11:59:00" })];
    const s = computeFinancialSummary(input);
    expect(s.dataIssues).toEqual([{ kind: "account", id: "chk", reason: "invalid_fetched_at" }]);
    expect(s.safeToSpend.inputs.balances[0].fetchedAt).toBeNull();
    expect(s.safeToSpend.freshness.oldestFetchedAt).toBeNull();
  });

  it("a zone-less balanceAsOf is reported and treated as null", () => {
    const input = empty();
    input.accounts = [acct({ balanceAsOf: "2026-10-09T08:00:00" })];
    const s = computeFinancialSummary(input);
    expect(s.dataIssues).toEqual([{ kind: "account", id: "chk", reason: "invalid_balance_as_of" }]);
    expect(s.safeToSpend.inputs.balances[0]).toMatchObject({ asOf: null, asOfSource: "unknown" });
  });

  it("a depository account with neither balance is reported", () => {
    const input = empty();
    input.accounts = [acct({ availableCents: null, currentCents: null })];
    expect(computeFinancialSummary(input).dataIssues).toEqual([
      { kind: "account", id: "chk", reason: "no_balance" },
    ]);
  });

  it("a non-string transaction accountId is reported", () => {
    const input = empty();
    input.transactions = [txn("t1", { accountId: 42 as unknown as string })];
    const s = computeFinancialSummary(input);
    expect(s.dataIssues).toEqual([{ kind: "transaction", id: "t1", reason: "invalid_account_id" }]);
    expect(s.cashFlow.excluded.invalid.count).toBe(1);
  });

  it("a duplicate streamId is reported", () => {
    const input = empty();
    input.recurring = { source: "plaid_streams", streams: [strm({}), strm({})] };
    expect(computeFinancialSummary(input).dataIssues).toEqual([
      { kind: "stream", id: "s", reason: "duplicate" },
    ]);
  });

  it("a duplicate streamId: first copy wins in every metric", () => {
    const input = empty();
    input.accounts = [acct({})];
    input.recurring = {
      source: "plaid_streams",
      streams: [
        strm({ averageAmountCents: 1000, predictedNextDate: "2026-10-20" }),
        strm({ averageAmountCents: 5000, predictedNextDate: "2026-10-15" }),
      ],
    };
    const s = computeFinancialSummary(input);
    expect(s.recurring.items.map((i) => [i.streamId, i.basisCents])).toEqual([["s", 1000]]);
    expect(s.recurring.totalMonthlyCents).toBe(1000);
    expect(s.safeToSpend.inputs.upcomingRecurring).toEqual([
      { streamId: "s", label: "S", dueDate: "2026-10-20", cents: 1000 },
    ]);
    expect(s.dataIssues).toEqual([{ kind: "stream", id: "s", reason: "duplicate" }]);
  });

  it("a duplicate whose first copy is inactive excludes the stream", () => {
    const input = empty();
    input.recurring = {
      source: "plaid_streams",
      streams: [strm({ isActive: false }), strm({})],
    };
    const s = computeFinancialSummary(input);
    expect(s.recurring.items).toEqual([]);
    expect(s.recurring.excluded).toEqual([{ streamId: "s", reason: "inactive" }]);
  });

  it("a stream whose id is an Object.prototype name is kept", () => {
    const input = empty();
    input.recurring = { source: "plaid_streams", streams: [strm({ streamId: "constructor" })] };
    const s = computeFinancialSummary(input);
    expect(s.recurring.items.map((i) => i.streamId)).toEqual(["constructor"]);
  });

  it("a null stream entry is skipped, not thrown on", () => {
    const input = empty();
    input.recurring = {
      source: "plaid_streams",
      streams: [null as unknown as EngineRecurringStream, strm({})],
    };
    const s = computeFinancialSummary(input);
    expect(s.recurring.items.map((i) => i.streamId)).toEqual(["s"]);
    expect(s.dataIssues).toEqual([{ kind: "stream", id: "", reason: "missing_id" }]);
  });

  it("a missing streamId is reported", () => {
    const input = empty();
    input.recurring = { source: "plaid_streams", streams: [strm({ streamId: "" })] };
    expect(computeFinancialSummary(input).dataIssues).toEqual([
      { kind: "stream", id: "", reason: "missing_id" },
    ]);
  });

  it("an invalid predictedNextDate is reported", () => {
    const input = empty();
    input.recurring = { source: "plaid_streams", streams: [strm({ predictedNextDate: "2026-13-01" })] };
    expect(computeFinancialSummary(input).dataIssues).toEqual([
      { kind: "stream", id: "s", reason: "invalid_predicted_next_date" },
    ]);
  });

  it("a pre-2000 date reaches the existing failure paths", () => {
    const input = empty();
    input.accounts = [acct({})];
    input.transactions = [txn("old", { date: "0026-10-01" })];
    const s = computeFinancialSummary(input);
    expect(s.dataIssues).toEqual([{ kind: "transaction", id: "old", reason: "invalid_date" }]);
    expect(s.cashFlow.excluded.invalid.count).toBe(1);

    const period = empty();
    period.period = { start: "0026-09-11", end: "2026-10-10", completeness: "unknown" };
    expect(computeFinancialSummary(period).dataIssues).toEqual([
      { kind: "period", id: "period", reason: "invalid_period" },
    ]);

    const now = empty();
    now.now = "0026-10-10T12:00:00Z";
    expect(() => computeFinancialSummary(now)).toThrow(/^computeFinancialSummary: invalid now$/);
  });

  it("throws on an unparseable now", () => {
    const input = empty();
    input.now = "yesterday";
    // Pinned to the entry point's own message: computeSafeToSpend has a
    // similar guard, and matching it would hide a removed check here.
    expect(() => computeFinancialSummary(input)).toThrow(
      /^computeFinancialSummary: invalid now$/
    );
  });
});
