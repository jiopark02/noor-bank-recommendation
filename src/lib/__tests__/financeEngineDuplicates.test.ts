import { describe, it, expect } from "vitest";
import { computeFinancialSummary } from "../financeEngine/index";
import { dropDuplicateAccountCopies } from "../financeEngine/duplicates";
import type {
  EngineAccount,
  EngineConnection,
  EngineInput,
  EngineRecurringStream,
  EngineTransaction,
} from "../financeEngine/types";

/**
 * Finance engine — one bank account reached through two connections.
 *
 * Mutations that turn this file red:
 *   - the first copy kept instead of the freshest      -> "keeps the copy whose balance …"
 *   - fetchedAt or accountId tie-break removed          -> "falls back to …"
 *   - accounts with no key merged                       -> "never merges an account without a key"
 *   - copies on one connection merged                   -> "never merges two accounts on one connection"
 *   - the dropped copy's transactions or streams kept   -> "leaves out the dropped copy's …"
 *   - the counts not reported                           -> "leaves out the dropped copy's …"
 *   - the input changed in place                        -> "does not change its input"
 */

const KEY = "k-checking";

function acct(over: Partial<EngineAccount>): EngineAccount {
  return {
    accountId: "a1",
    type: "depository",
    subtype: "checking",
    currentCents: 100000,
    availableCents: 100000,
    limitCents: null,
    currency: "USD",
    balanceAsOf: null,
    fetchedAt: "2026-10-10T11:59:00Z",
    duplicateKey: KEY,
    connectionKey: "c0",
    ...over,
  };
}

function txn(id: string, accountId: string): EngineTransaction {
  return {
    transactionId: id,
    accountId,
    amountCents: 1000,
    currency: "USD",
    date: "2026-10-01",
    pending: false,
    pfcPrimary: "FOOD_AND_DRINK",
    pfcDetailed: null,
    legacyCategory: [],
    merchantEntityId: null,
  };
}

function stream(id: string, accountId: string | null): EngineRecurringStream {
  return {
    streamId: id,
    label: id,
    frequency: "MONTHLY",
    averageAmountCents: 1500,
    lastAmountCents: 1500,
    currency: "USD",
    lastDate: "2026-09-20",
    predictedNextDate: "2026-10-20",
    isActive: true,
    status: "MATURE",
    accountId,
    pfcPrimary: null,
    pfcDetailed: null,
    legacyCategory: [],
    transactionIds: [],
  };
}

function conn(connectionKey: string): EngineConnection {
  return {
    connectionKey,
    state: "ok",
    lastSuccessfulUpdate: null,
    recurringRead: "ok",
    transactionsTruncated: false,
    earliestTransactionDate: null,
  };
}

function input(accounts: EngineAccount[]): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    today: "2026-10-10",
    dateBasis: "utc",
    currency: "USD",
    accounts,
    transactions: [],
    readWindow: { start: "2026-09-11", end: "2026-10-10" },
    period: { start: "2026-09-11", end: "2026-10-10" },
    connections: [conn("c0"), conn("c1")],
    recurring: { streams: [], incomeStreams: [] },
  };
}

const kept = (i: EngineInput) => dropDuplicateAccountCopies(i).input.accounts.map((a) => a.accountId);

describe("dropDuplicateAccountCopies", () => {
  it("keeps the copy whose balance the institution measured most recently", () => {
    const older = acct({ accountId: "a1", balanceAsOf: "2026-10-09T08:00:00Z" });
    const newer = acct({ accountId: "a2", connectionKey: "c1", balanceAsOf: "2026-10-10T08:00:00Z" });
    expect(kept(input([older, newer]))).toEqual(["a2"]);
    expect(kept(input([newer, older]))).toEqual(["a2"]);
    // A known measurement beats none.
    const unknown = acct({ accountId: "a3", connectionKey: "c1", balanceAsOf: null });
    expect(kept(input([unknown, older]))).toEqual(["a1"]);
  });

  it("falls back to when our server received it, then to the smaller account id", () => {
    const early = acct({ accountId: "a1", fetchedAt: "2026-10-10T11:00:00Z" });
    const late = acct({ accountId: "a2", connectionKey: "c1", fetchedAt: "2026-10-10T11:30:00Z" });
    expect(kept(input([early, late]))).toEqual(["a2"]);

    const x = acct({ accountId: "b-x" });
    const y = acct({ accountId: "a-y", connectionKey: "c1" });
    expect(kept(input([x, y]))).toEqual(["a-y"]);
    expect(kept(input([y, x]))).toEqual(["a-y"]);
  });

  it("never merges an account without a key", () => {
    const a = acct({ accountId: "a1", duplicateKey: null });
    const b = acct({ accountId: "a2", connectionKey: "c1", duplicateKey: null });
    expect(kept(input([a, b]))).toEqual(["a1", "a2"]);
    expect(dropDuplicateAccountCopies(input([a, b])).dropped).toEqual({
      accounts: 0,
      transactions: 0,
      streams: 0,
    });
  });

  it("never merges two accounts on one connection, nor that key anywhere", () => {
    const a = acct({ accountId: "a1" });
    const b = acct({ accountId: "a2" });
    expect(kept(input([a, b]))).toEqual(["a1", "a2"]);
    // The same key once more on another connection: still ambiguous, nothing merged.
    const c = acct({ accountId: "a3", connectionKey: "c1" });
    expect(kept(input([a, b, c]))).toEqual(["a1", "a2", "a3"]);
  });

  it("leaves out the dropped copy's transactions and streams, and counts them", () => {
    const i = input([
      acct({ accountId: "a1", balanceAsOf: "2026-10-10T08:00:00Z" }),
      acct({ accountId: "a2", connectionKey: "c1" }),
      acct({ accountId: "card", type: "credit", subtype: "credit card", duplicateKey: "k-card" }),
    ]);
    i.transactions = [txn("t1", "a1"), txn("t1-copy", "a2"), txn("t2-copy", "a2"), txn("t3", "card")];
    i.recurring = {
      streams: [stream("s1", "a1"), stream("s1-copy", "a2"), stream("s-none", null)],
      incomeStreams: [stream("pay", "a1"), stream("pay-copy", "a2")],
    };
    const { input: out, dropped } = dropDuplicateAccountCopies(i);
    expect(out.accounts.map((a) => a.accountId)).toEqual(["a1", "card"]);
    expect(out.transactions.map((t) => t.transactionId)).toEqual(["t1", "t3"]);
    expect(out.recurring.streams.map((s) => s.streamId)).toEqual(["s1", "s-none"]);
    expect(out.recurring.incomeStreams.map((s) => s.streamId)).toEqual(["pay"]);
    expect(dropped).toEqual({ accounts: 1, transactions: 2, streams: 2 });
  });

  it("does not change its input", () => {
    const i = input([acct({ accountId: "a1" }), acct({ accountId: "a2", connectionKey: "c1" })]);
    const before = JSON.stringify(i);
    dropDuplicateAccountCopies(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});

describe("computeFinancialSummary — duplicate copies", () => {
  it("counts the account once in every figure and reports what it left out", () => {
    const i = input([
      acct({ accountId: "a1", balanceAsOf: "2026-10-10T08:00:00Z" }),
      acct({ accountId: "a2", connectionKey: "c1" }),
    ]);
    i.transactions = [txn("t1", "a1"), txn("t1-copy", "a2")];
    i.recurring = { streams: [stream("s1", "a1"), stream("s1-copy", "a2")], incomeStreams: [] };
    const s = computeFinancialSummary(i);
    expect(s.safeToSpend.totals.spendableCashCents).toBe(100000);
    expect(s.cashFlow.spendingGrossCents).toBe(1000);
    expect(s.recurring.items.map((r) => r.streamId)).toEqual(["s1"]);
    expect(s.coverage.duplicateCopiesDropped).toEqual({ accounts: 1, transactions: 1, streams: 1 });
    expect(s.dataIssues).toEqual([]);
  });
});
