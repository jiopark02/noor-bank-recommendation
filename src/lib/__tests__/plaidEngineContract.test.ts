import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyEngineContract,
  readBankData,
  type ContractConnection,
  type PlaidReadCalls,
  type ReadAccount,
} from "../plaidEngineAdapter";
import type { EngineConnection, EngineRecurringStream } from "../financeEngine";

/**
 * The engine contract, applied by the adapter before the engine is called.
 *
 * Two outcomes are held apart. A value that is only descriptive is passed as
 * null and counted. A stream that would make the recurring charges wrong
 * fails the connection's recurring read instead, and that connection sends no
 * streams at all.
 *
 * Mutations that turn this file red:
 *   - an account dropped instead of its balanceAsOf or amount nulled   -> null cases
 *   - a cash account sending its current amount after its available
 *     amount was nulled, or a card losing its current amount           -> null cases
 *   - an account with no usable id or balances skipped while the rest
 *     of its connection is read                                        -> wiring
 *   - a bad balanceAsOf, amount, lastSuccessfulUpdate or outflow date
 *     passed through unchanged, or not counted                         -> null cases
 *   - an outflow date failing the recurring read instead of nulled     -> null cases
 *   - a bad outflow amount or stream id nulled or dropped instead of
 *     failing the recurring read                                       -> failed cases
 *   - a bad income date, amount or id nulled instead of failing it     -> failed cases
 *   - a failed connection still sending streams or income streams      -> failed cases
 *   - identical copies of one id failing a read, or the later copy
 *     kept                                                             -> repeated ids
 *   - differing copies, or copies in both lists, not failing every
 *     connection holding one                                           -> repeated ids
 *   - identical copies chosen before failed connections are removed    -> repeated ids
 *   - the input changed in place                                       -> purity
 *   - the per-connection log line missing, or carrying a value         -> wiring
 */

function engine(over: Partial<EngineConnection> = {}): EngineConnection {
  return {
    connectionKey: "c0",
    state: "ok",
    lastSuccessfulUpdate: "2026-11-11T10:00:00Z",
    recurringRead: "ok",
    transactionsTruncated: false,
    earliestTransactionDate: null,
    ...over,
  };
}

function acct(over: Partial<ReadAccount> = {}): ReadAccount {
  return {
    accountId: "acc-1",
    itemId: "item-0",
    institutionName: "Bank",
    name: "Checking",
    officialName: null,
    mask: "0000",
    type: "depository",
    subtype: "checking",
    currentCents: 10050,
    availableCents: 9025,
    limitCents: null,
    currency: "USD",
    balanceAsOf: "2026-11-11T09:00:00Z",
    fetchedAt: "2026-11-11T12:00:00.000Z",
    duplicateKey: null,
    connectionKey: "c0",
    ...over,
  };
}

function strm(id: string, over: Partial<EngineRecurringStream> = {}): EngineRecurringStream {
  return {
    streamId: id,
    label: "Netflix",
    frequency: "MONTHLY",
    averageAmountCents: 1549,
    lastAmountCents: 1549,
    currency: "USD",
    lastDate: "2026-10-20",
    predictedNextDate: "2026-11-20",
    isActive: true,
    status: "MATURE",
    accountId: "acc-1",
    pfcPrimary: null,
    pfcDetailed: null,
    legacyCategory: [],
    transactionIds: [],
    ...over,
  };
}

function conn(over: Partial<ContractConnection> = {}): ContractConnection {
  return {
    engine: engine(),
    accounts: [acct()],
    streams: [strm("s1")],
    incomeStreams: [strm("pay", { averageAmountCents: -250000, lastAmountCents: -250000 })],
    ...over,
  };
}

const UNSAFE = Number.MAX_SAFE_INTEGER + 2;

describe("values passed as null and counted", () => {
  it("an account keeps its place; a bad balanceAsOf becomes null", () => {
    for (const bad of ["2026-11-11T09:00Z", "2026-11-11 09:00:00Z", "1999-12-31T23:59:59Z", "2026-11-11T09:00:00"]) {
      const out = applyEngineContract([conn({ accounts: [acct({ balanceAsOf: bad })] })]);
      expect(out.connections[0].accounts, bad).toHaveLength(1);
      expect(out.connections[0].accounts[0].balanceAsOf, bad).toBeNull();
      expect(out.counts[0].balanceAsOfNulled, bad).toBe(1);
      expect(out.connections[0].engine.recurringRead, bad).toBe("ok");
    }
  });

  it("an amount that is not a safe integer of cents becomes null; the account stays", () => {
    const out = applyEngineContract([
      conn({ accounts: [acct({ currentCents: UNSAFE, availableCents: 1.5, limitCents: 500 })] }),
    ]);
    const a = out.connections[0].accounts[0];
    expect(a.currentCents).toBeNull();
    expect(a.availableCents).toBeNull();
    expect(a.limitCents).toBe(500);
    expect(out.counts[0].amountsNulled).toBe(2);
  });

  it("a cash account whose available amount is nulled sends no current amount either", () => {
    const out = applyEngineContract([
      conn({ accounts: [acct({ type: "depository", availableCents: UNSAFE, currentCents: 10050 })] }),
    ]);
    const a = out.connections[0].accounts[0];
    expect(a.availableCents).toBeNull();
    expect(a.currentCents).toBeNull();
    expect(out.counts[0].amountsNulled).toBe(2);
  });

  it("a card whose available amount is nulled keeps its current amount", () => {
    const out = applyEngineContract([
      conn({
        accounts: [
          acct({ type: "credit", subtype: "credit card", availableCents: UNSAFE, currentCents: 25000, limitCents: 100000 }),
        ],
      }),
    ]);
    const a = out.connections[0].accounts[0];
    expect(a.availableCents).toBeNull();
    expect(a.currentCents).toBe(25000);
    expect(out.counts[0].amountsNulled).toBe(1);
  });

  it("a cash account Plaid sent with no available amount keeps its current amount", () => {
    const out = applyEngineContract([
      conn({ accounts: [acct({ type: "depository", availableCents: null, currentCents: 10050 })] }),
    ]);
    expect(out.connections[0].accounts[0].currentCents).toBe(10050);
    expect(out.counts[0].amountsNulled).toBe(0);
  });

  it("a bad lastSuccessfulUpdate becomes null; the connection is otherwise untouched", () => {
    const out = applyEngineContract([conn({ engine: engine({ lastSuccessfulUpdate: "yesterday" }) })]);
    expect(out.connections[0].engine.lastSuccessfulUpdate).toBeNull();
    expect(out.connections[0].engine.state).toBe("ok");
    expect(out.connections[0].engine.recurringRead).toBe("ok");
    expect(out.counts[0].lastUpdateNulled).toBe(1);
  });

  it("an outflow stream's bad dates become null; the stream and the read stay", () => {
    const out = applyEngineContract([
      conn({ streams: [strm("s1", { lastDate: "2026-02-30", predictedNextDate: "1999-12-31" })] }),
    ]);
    const c = out.connections[0];
    expect(c.engine.recurringRead).toBe("ok");
    expect(c.streams).toHaveLength(1);
    expect(c.streams[0].lastDate).toBeNull();
    expect(c.streams[0].predictedNextDate).toBeNull();
    expect(out.counts[0].streamDatesNulled).toBe(2);
    expect(out.counts[0].recurringFailed).toBe("none");
  });

  it("valid values pass unchanged and count nothing", () => {
    const input = [conn()];
    const out = applyEngineContract(input);
    expect(out.connections).toEqual(input);
    expect(out.counts[0]).toEqual({
      balanceAsOfNulled: 0,
      amountsNulled: 0,
      streamDatesNulled: 0,
      lastUpdateNulled: 0,
      identicalStreamsDropped: 0,
      recurringFailed: "none",
    });
  });
});

describe("streams that fail the connection's recurring read", () => {
  const failedCases: Array<[string, ContractConnection]> = [
    ["outflow average amount not a safe integer", conn({ streams: [strm("s1", { averageAmountCents: UNSAFE })] })],
    ["outflow last amount not an integer", conn({ streams: [strm("s1", { lastAmountCents: 15.5 })] })],
    ["outflow stream id empty", conn({ streams: [strm("")] })],
    ["outflow stream id not a string", conn({ streams: [strm(7 as unknown as string)] })],
    ["income predicted date invalid", conn({ incomeStreams: [strm("pay", { predictedNextDate: "2026-13-01" })] })],
    ["income last date invalid", conn({ incomeStreams: [strm("pay", { lastDate: "11/01/2026" })] })],
    ["income amount not a safe integer", conn({ incomeStreams: [strm("pay", { averageAmountCents: -UNSAFE })] })],
    ["income stream id not a string", conn({ incomeStreams: [strm(null as unknown as string)] })],
  ];

  for (const [label, input] of failedCases) {
    it(`${label}: recurring read failed, and no streams are sent`, () => {
      const out = applyEngineContract([input, conn({ engine: engine({ connectionKey: "c1" }), streams: [strm("other")], incomeStreams: [] })]);
      const c = out.connections[0];
      expect(c.engine.recurringRead).toBe("failed");
      expect(c.streams).toEqual([]);
      expect(c.incomeStreams).toEqual([]);
      expect(out.counts[0].recurringFailed).toBe("stream_field");
      // The account data is kept: only the recurring read is lost.
      expect(c.accounts).toHaveLength(1);
      // Another connection is not touched.
      expect(out.connections[1].engine.recurringRead).toBe("ok");
      expect(out.connections[1].streams.map((s) => s.streamId)).toEqual(["other"]);
    });
  }

  it("a connection whose recurring read was not answered stays as it was", () => {
    const out = applyEngineContract([
      conn({ engine: engine({ recurringRead: null }), streams: [], incomeStreams: [] }),
    ]);
    expect(out.connections[0].engine.recurringRead).toBeNull();
    expect(out.counts[0].recurringFailed).toBe("none");
  });
});

describe("one stream id on two streams", () => {
  const c = (key: string, streams: EngineRecurringStream[], incomeStreams: EngineRecurringStream[] = []) =>
    conn({ engine: engine({ connectionKey: key }), streams, incomeStreams });

  it("identical copies keep the first, in connection order, and fail nothing", () => {
    const out = applyEngineContract([c("c0", [strm("x")]), c("c1", [strm("x"), strm("y")])]);
    expect(out.connections[0].streams.map((s) => s.streamId)).toEqual(["x"]);
    expect(out.connections[1].streams.map((s) => s.streamId)).toEqual(["y"]);
    expect(out.counts[1].identicalStreamsDropped).toBe(1);
    expect(out.counts[0].identicalStreamsDropped).toBe(0);
    expect(out.connections[0].engine.recurringRead).toBe("ok");
    expect(out.connections[1].engine.recurringRead).toBe("ok");
  });

  it("identical copies inside one connection keep the first", () => {
    const out = applyEngineContract([c("c0", [strm("x"), strm("x")])]);
    expect(out.connections[0].streams).toHaveLength(1);
    expect(out.counts[0].identicalStreamsDropped).toBe(1);
  });

  it("copies that differ fail every connection holding one, and only those", () => {
    const out = applyEngineContract([
      c("c0", [strm("x")]),
      c("c1", [strm("x", { averageAmountCents: 999 })]),
      c("c2", [strm("z")]),
    ]);
    expect(out.connections.map((k) => k.engine.recurringRead)).toEqual(["failed", "failed", "ok"]);
    expect(out.connections[0].streams).toEqual([]);
    expect(out.connections[1].streams).toEqual([]);
    expect(out.counts[0].recurringFailed).toBe("stream_id_conflict");
    expect(out.counts[1].recurringFailed).toBe("stream_id_conflict");
    expect(out.connections[2].streams.map((s) => s.streamId)).toEqual(["z"]);
  });

  it("an id in both the outflow and the income list fails the read, even when the fields match", () => {
    const out = applyEngineContract([c("c0", [strm("x")], [strm("x")])]);
    expect(out.connections[0].engine.recurringRead).toBe("failed");
    expect(out.connections[0].streams).toEqual([]);
    expect(out.connections[0].incomeStreams).toEqual([]);
  });

  it("a connection failed for one id does not cost another connection a stream it shared", () => {
    // x is identical on c0 and c1; y differs between c0 and c2. c0 and c2
    // fail, so c1's copy of x is the only one left and must be kept.
    const out = applyEngineContract([
      c("c0", [strm("x"), strm("y")]),
      c("c1", [strm("x")]),
      c("c2", [strm("y", { label: "Other" })]),
    ]);
    expect(out.connections.map((k) => k.engine.recurringRead)).toEqual(["failed", "ok", "failed"]);
    expect(out.connections[1].streams.map((s) => s.streamId)).toEqual(["x"]);
    expect(out.counts[1].identicalStreamsDropped).toBe(0);
  });

  it("a stream from a connection failed for its own fields is not compared", () => {
    const out = applyEngineContract([
      c("c0", [strm("x"), strm("bad", { averageAmountCents: UNSAFE })]),
      c("c1", [strm("x", { label: "Different" })]),
    ]);
    expect(out.connections[0].engine.recurringRead).toBe("failed");
    expect(out.connections[1].engine.recurringRead).toBe("ok");
    expect(out.connections[1].streams.map((s) => s.label)).toEqual(["Different"]);
  });
});

describe("purity", () => {
  it("does not change its input", () => {
    const input = [
      conn({
        accounts: [acct({ balanceAsOf: "bad", currentCents: UNSAFE })],
        streams: [strm("s1", { lastDate: "bad" })],
      }),
      conn({ engine: engine({ connectionKey: "c1" }), streams: [strm("s1", { label: "x" })] }),
    ];
    const before = JSON.stringify(input);
    applyEngineContract(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("wiring through readBankData", () => {
  afterEach(() => vi.restoreAllMocks());

  function plaid(balanceAsOf: string | null): PlaidReadCalls {
    return {
      itemGet: async () => ({
        data: {
          item: {} as never,
          status: { transactions: { last_successful_update: "2026-11-11T10:00Z", last_failed_update: null } },
          request_id: "r",
        },
      }),
      accountsGet: async () => ({
        data: {
          accounts: [
            {
              account_id: "acc-1",
              name: "Checking",
              official_name: null,
              mask: "0000",
              type: "depository",
              subtype: "checking",
              balances: {
                current: 100.5,
                available: 90.25,
                limit: null,
                iso_currency_code: "USD",
                unofficial_currency_code: null,
                last_updated_datetime: balanceAsOf,
              },
            },
          ],
          item: {} as never,
          request_id: "r",
        } as never,
      }),
      transactionsGet: async () => ({
        data: { accounts: [], transactions: [], total_transactions: 0, item: {} as never, request_id: "r" } as never,
      }),
      transactionsRecurringGet: async () => ({
        data: { inflow_streams: [], outflow_streams: [], updated_datetime: "x", request_id: "r" } as never,
      }),
    };
  }

  it("an account with no usable id or balances fails its connection; the others are read", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = plaid("2026-11-11T09:00:00Z");
    const goodAccounts = await good.accountsGet({ access_token: "x" });
    const malformedCases: unknown[] = [
      { name: "No id", balances: { current: 1, available: 1, limit: null, iso_currency_code: "USD" } },
      { account_id: "", name: "Empty id", balances: { current: 1, available: 1, limit: null, iso_currency_code: "USD" } },
      { account_id: "acc-x", name: "No balances" },
      null,
    ];
    for (const malformed of malformedCases) {
      const byToken: PlaidReadCalls = {
        ...good,
        accountsGet: async (req) =>
          req.access_token === "TOKEN_BAD"
            ? ({
                data: {
                  accounts: [goodAccounts.data.accounts[0], malformed],
                  item: {} as never,
                  request_id: "r",
                },
              } as never)
            : ({
                data: {
                  ...goodAccounts.data,
                  accounts: [{ ...goodAccounts.data.accounts[0], account_id: "acc-ok" }],
                },
              } as never),
      };
      const read = await readBankData(
        "user-1",
        [
          { access_token: "CIPHER_BAD", item_id: "item-bad", institution_name: "Bad" },
          { access_token: "CIPHER_OK", item_id: "item-ok", institution_name: "Ok" },
        ],
        { accounts: true, transactions: true, recurring: true },
        { start: "2026-08-14", end: "2026-11-11" },
        { plaid: byToken, decrypt: (s) => s.replace("CIPHER_", "TOKEN_") }
      );
      const label = JSON.stringify(malformed);
      expect(read.connections.map((c) => c.status), label).toEqual(["failed", "ok"]);
      expect(read.engineConnections[0].state, label).toBe("failed");
      expect(read.accounts.map((a) => a.accountId), label).toEqual(["acc-ok"]);
    }
  });

  it("the read carries the contract's values, and one count line per connection", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = await readBankData(
      "user-1",
      [{ access_token: "CIPHER", item_id: "item-0", institution_name: "Bank" }],
      { accounts: true, transactions: true, recurring: true },
      { start: "2026-08-14", end: "2026-11-11" },
      { plaid: plaid("2026-11-11T09:00:00.123456789123-05:00X"), decrypt: () => "TOKEN" }
    );
    expect(read.accounts[0].balanceAsOf).toBeNull();
    // The Item's update time had no seconds: null, counted.
    expect(read.engineConnections[0].lastSuccessfulUpdate).toBeNull();
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[bank-contract]"));
    expect(lines).toEqual([
      "[bank-contract] idx=0 invalid_txn=0 duplicate_txn=0 balance_as_of_nulled=1 amounts_nulled=0 " +
        "stream_dates_nulled=0 last_update_nulled=1 identical_streams_dropped=0 recurring_failed=none",
    ]);
  });
});
