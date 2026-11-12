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
 *   - the connection's last update or the accountId
 *     tie-break removed                                 -> "falls back to …"
 *   - fetchedAt compared again                          -> "when our server received a copy …"
 *   - the last update looked up by list position, or the
 *     first-read connection preferred                   -> "the same copy whatever order …"
 *   - a missing connection or time ranked first         -> "a connection that cannot be found …"
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

/** An input whose connections are the given ones, in the given order. */
function withConnections(accounts: EngineAccount[], connections: unknown[]): EngineInput {
  const i = input(accounts);
  i.connections = connections as EngineConnection[];
  return i;
}

function updated(connectionKey: string, lastSuccessfulUpdate: string | null): EngineConnection {
  return { ...conn(connectionKey), lastSuccessfulUpdate };
}

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

  it("falls back to the connection's last update, then to the smaller account id", () => {
    // The account ids point the other way, so only the last update can decide.
    const stale = acct({ accountId: "a1", connectionKey: "c1" });
    const fresh = acct({ accountId: "a2", connectionKey: "c0" });
    const connections = [updated("c0", "2026-10-10T06:00:00Z"), updated("c1", "2026-10-09T06:00:00Z")];
    expect(kept(withConnections([stale, fresh], connections))).toEqual(["a2"]);
    expect(kept(withConnections([fresh, stale], connections))).toEqual(["a2"]);

    const x = acct({ accountId: "b-x" });
    const y = acct({ accountId: "a-y", connectionKey: "c1" });
    expect(kept(input([x, y]))).toEqual(["a-y"]);
    expect(kept(input([y, x]))).toEqual(["a-y"]);
  });

  it("when our server received a copy does not decide which is kept", () => {
    const late = acct({ accountId: "b-x", fetchedAt: "2026-10-10T11:30:00Z" });
    const early = acct({ accountId: "a-y", connectionKey: "c1", fetchedAt: "2026-10-10T11:00:00Z" });
    expect(kept(input([late, early]))).toEqual(["a-y"]);
    expect(kept(input([early, late]))).toEqual(["a-y"]);
  });

  it("keeps the same copy whatever order the connections were read in", () => {
    const NEW = "2026-10-10T06:00:00Z";
    const OLD = "2026-10-08T06:00:00Z";
    // Read one way: the fresher connection is c0.
    const first = withConnections(
      [acct({ accountId: "z-fresh", connectionKey: "c0" }), acct({ accountId: "a-stale", connectionKey: "c1" })],
      [updated("c0", NEW), updated("c1", OLD)]
    );
    // Read the other way: the keys follow the read order, so the same
    // connections swap keys, and both lists come in the opposite order.
    const second = withConnections(
      [acct({ accountId: "a-stale", connectionKey: "c0" }), acct({ accountId: "z-fresh", connectionKey: "c1" })],
      [updated("c1", NEW), updated("c0", OLD)]
    );
    expect(kept(first)).toEqual(["z-fresh"]);
    expect(kept(second)).toEqual(["z-fresh"]);

    // A key listed twice is not taken from whichever entry comes first.
    const copies = [
      acct({ accountId: "a-twice", connectionKey: "c0" }),
      acct({ accountId: "b-once", connectionKey: "c1" }),
    ];
    const mid = "2026-10-09T06:00:00Z";
    const oneWay = withConnections(copies, [updated("c0", NEW), updated("c0", OLD), updated("c1", mid)]);
    const otherWay = withConnections(copies, [updated("c0", OLD), updated("c0", NEW), updated("c1", mid)]);
    expect(kept(oneWay)).toEqual(["b-once"]);
    expect(kept(otherWay)).toEqual(["b-once"]);
  });

  it("a connection that cannot be found, or a time that is not one, ranks last", () => {
    const valid = updated("c1", "2026-10-09T06:00:00Z");
    // Not among the connections at all.
    const missing = withConnections(
      [acct({ accountId: "a-missing", connectionKey: "c9" }), acct({ accountId: "b-found", connectionKey: "c1" })],
      [updated("c0", "2026-10-10T06:00:00Z"), valid]
    );
    expect(kept(missing)).toEqual(["b-found"]);
    // An unreadable time, and an entry that is not a connection, which is skipped.
    const unreadable = withConnections(
      [acct({ accountId: "a-bad", connectionKey: "c0" }), acct({ accountId: "b-good", connectionKey: "c1" })],
      [null, updated("c0", "not-a-time"), valid]
    );
    expect(kept(unreadable)).toEqual(["b-good"]);
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
