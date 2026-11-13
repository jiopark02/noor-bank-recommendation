import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AccountSubtype,
  AccountType,
  ItemUpdateTypeEnum,
  PersonalFinanceCategoryVersion,
  RecurringTransactionFrequency,
  TransactionPaymentChannelEnum,
  TransactionStreamStatus,
  type AccountBalance,
  type AccountBase,
  type AccountsGetResponse,
  type Item,
  type ItemGetResponse,
  type Transaction,
  type TransactionStream,
  type TransactionsGetResponse,
  type TransactionsRecurringGetResponse,
} from "plaid";
import {
  MAX_TRANSACTION_PAGES,
  READ_WINDOW_DAYS,
  TRANSACTIONS_PAGE_SIZE,
  bankWindow,
  displayTransactions,
  isUsableTransaction,
  readBankData,
  resolveToday,
  toDisplayTransaction,
  toEngineInput,
  type EngineInputDates,
  type BankAdapterDeps,
  type PlaidReadCalls,
  type StoredConnectionRow,
} from "../plaidEngineAdapter";
import {
  computeCoverage,
  computeFinancialSummary,
  dropDuplicateAccountCopies,
} from "../financeEngine";
import { PlaidTokenCryptoError } from "../plaidTokenCrypto";

/**
 * Plaid -> engine adapter, executed against a fake Plaid client.
 *
 * Every fake Plaid object below is built as the SDK's own type (AccountBase,
 * Transaction, TransactionStream and the three responses), so a fixture cannot
 * carry a field the SDK does not declare. Test files are outside the build's
 * type-check; type-check this file directly when changing a fixture.
 *
 * Mutations that turn this file red:
 *   - amounts converted by truncation, or passed through as dollars -> cents
 *   - a missing balance read as 0 (`?? 0`, `|| 0`)                 -> null balances
 *   - the app's collapsed type mapping reused ("checking")         -> account types
 *   - the page loop removed, or its cap removed / truncation unset -> paging
 *   - the empty-page stop removed                                  -> empty page
 *   - the PFC version option dropped from either call              -> version
 *   - recurring frequency or status normalized                     -> streams
 *   - an expired login skipped without a status                    -> login required
 *   - a failed bank's partial data kept                            -> failed
 *   - some rows failing to decrypt thrown for the whole read       -> decrypt, some rows
 *   - a row that would not decrypt sent to Plaid, or reported ok   -> decrypt, some rows
 *   - the throw when every row fails to decrypt removed            -> decrypt, every row
 *   - the decrypt log line carrying the message or stored value    -> decrypt log
 *   - the decrypt log line indistinguishable from a Plaid failure  -> decrypt log
 *   - recurring failure or an empty stream list sent as streams    -> recurring
 *   - PRODUCT_NOT_READY reported as failed                         -> syncing
 *   - the account-currency fill for a stream with no code removed  -> stream currency
 *   - the fill applied over a code Plaid sent                      -> stream currency
 *   - a stream currency shape miscounted in the log                -> stream currency log
 *   - any usability condition dropped (a numeric-string or null
 *     amount accepted included)                                    -> transaction filter
 *   - a field read before the element is known to be an object     -> transaction filter
 *   - a later copy of a transaction id kept, or the repeat check
 *     made per connection                                          -> transaction filter
 *   - the same id on another account counted as a duplicate        -> transaction filter
 *   - counts moved between connections, or logged with an id       -> transaction filter
 *   - the earliest date taken before the repeat check              -> transaction filter
 *   - the page offset advanced by the elements kept                -> transaction filter
 */

const RANGE = { start: "2026-08-14", end: "2026-11-11" };
const DATES: EngineInputDates = {
  nowIso: "2026-11-11T12:00:00Z",
  today: "2026-11-11",
  dateBasis: "utc",
  readWindow: RANGE,
  period: RANGE,
};
const ALL ={ accounts: true, transactions: true, recurring: true };
const USER = "user-1";

/** How complete the engine finds a read, from its connections. */
function readCompleteness(read: Awaited<ReturnType<typeof readBankData>>) {
  return computeCoverage(read.engineConnections, read.streams.length).completeness;
}

/** The engine's recurring answer for a read, with DATES. */
function engineRecurringOf(read: Awaited<ReturnType<typeof readBankData>>) {
  return computeFinancialSummary(toEngineInput(read, DATES)).recurring;
}

function row(n: number): StoredConnectionRow {
  return { access_token: `CIPHER_${n}`, item_id: `item-${n}`, institution_name: `Bank ${n}` };
}

function plaidError(code: string): Error {
  const e = new Error("Request failed with status code 400") as Error & {
    response: unknown;
    isAxiosError: boolean;
  };
  e.isAxiosError = true;
  e.response = { status: 400, data: { error_code: code, error_type: "ITEM_ERROR" } };
  return e;
}

const ITEM: Item = {
  item_id: "item-x",
  webhook: null,
  error: null,
  available_products: [],
  billed_products: [],
  consent_expiration_time: null,
  update_type: ItemUpdateTypeEnum.Background,
};

function account(over: Partial<AccountBase> = {}, balances: Partial<AccountBalance> = {}): AccountBase {
  return {
    account_id: "acc-1",
    name: "Checking",
    official_name: null,
    mask: "0000",
    type: AccountType.Depository,
    subtype: AccountSubtype.Checking,
    balances: {
      current: 100.5,
      available: 90.25,
      limit: null,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
      ...balances,
    },
    ...over,
  };
}

function txn(id: string, over: Partial<Transaction> = {}): Transaction {
  return {
    transaction_id: id,
    account_id: "acc-1",
    amount: 12.34,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    date: "2026-11-01",
    pending: false,
    pending_transaction_id: null,
    account_owner: null,
    name: "Coffee",
    merchant_name: "Cafe",
    logo_url: null,
    category: ["Food and Drink"],
    personal_finance_category: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_COFFEE",
      version: PersonalFinanceCategoryVersion.V2,
    },
    location: {
      address: null,
      city: null,
      region: null,
      postal_code: null,
      country: null,
      lat: null,
      lon: null,
      store_number: null,
    },
    payment_meta: {
      reference_number: null,
      ppd_id: null,
      payee: null,
      by_order_of: null,
      payer: null,
      payment_method: null,
      payment_processor: null,
      reason: null,
    },
    authorized_date: null,
    authorized_datetime: null,
    datetime: null,
    payment_channel: TransactionPaymentChannelEnum.InStore,
    transaction_code: null,
    ...over,
  };
}

function stream(id: string, over: Partial<TransactionStream> = {}): TransactionStream {
  return {
    stream_id: id,
    account_id: "acc-1",
    category: null,
    category_id: null,
    description: "NETFLIX",
    merchant_name: "Netflix",
    first_date: "2026-08-20",
    last_date: "2026-10-20",
    predicted_next_date: "2026-11-20",
    frequency: RecurringTransactionFrequency.Monthly,
    transaction_ids: [],
    average_amount: { amount: 15.49, iso_currency_code: "USD", unofficial_currency_code: null },
    last_amount: { amount: 15.49, iso_currency_code: "USD", unofficial_currency_code: null },
    is_active: true,
    status: TransactionStreamStatus.Mature,
    is_user_modified: false,
    ...over,
  };
}

type Script = {
  accounts?: AccountBase[] | Error;
  /** One entry per page call, in order; the last repeats. */
  pages?: Array<{ transactions: Transaction[]; total: number } | Error>;
  streams?: TransactionStream[] | Error;
  inflow?: TransactionStream[];
  /** /item/get: the last successful update, an error, or "throw" to fail before the call. */
  item?: { lastSuccessfulUpdate: string | null } | Error | "throw";
};

function fakePlaid(scripts: Record<string, Script>) {
  const calls = {
    accounts: [] as unknown[],
    transactions: [] as any[],
    recurring: [] as any[],
    item: [] as any[],
  };
  const pageIndex: Record<string, number> = {};
  const plaid: PlaidReadCalls = {
    itemGet(req) {
      calls.item.push(req);
      const s = scripts[req.access_token] ?? {};
      if (s.item === "throw") throw new Error("thrown before the call");
      if (s.item instanceof Error) return Promise.reject(s.item);
      const last = s.item ? s.item.lastSuccessfulUpdate : null;
      const data: ItemGetResponse = {
        item: { ...ITEM, available_products: [], billed_products: [] },
        status: { transactions: { last_successful_update: last, last_failed_update: null } },
        request_id: "req",
      };
      return Promise.resolve({ data });
    },
    async accountsGet(req) {
      calls.accounts.push(req);
      const s = scripts[req.access_token] ?? {};
      if (s.accounts instanceof Error) throw s.accounts;
      const data: AccountsGetResponse = {
        accounts: s.accounts ?? [account()],
        item: ITEM,
        request_id: "req",
      };
      return { data };
    },
    async transactionsGet(req, options) {
      calls.transactions.push({ req, options });
      const s = scripts[req.access_token] ?? {};
      const pages = s.pages ?? [{ transactions: [txn("t1")], total: 1 }];
      const i = pageIndex[req.access_token] ?? 0;
      pageIndex[req.access_token] = i + 1;
      const page = pages[Math.min(i, pages.length - 1)];
      if (page instanceof Error) throw page;
      const data: TransactionsGetResponse = {
        accounts: [],
        transactions: page.transactions,
        total_transactions: page.total,
        item: ITEM,
        request_id: "req",
      };
      return { data };
    },
    async transactionsRecurringGet(req) {
      calls.recurring.push(req);
      const s = scripts[req.access_token] ?? {};
      if (s.streams instanceof Error) throw s.streams;
      const data: TransactionsRecurringGetResponse = {
        inflow_streams: s.inflow ?? [],
        outflow_streams: s.streams ?? [stream("s1")],
        updated_datetime: "2026-11-11T00:00:00Z",
        request_id: "req",
      };
      return { data };
    },
  };
  return { plaid, calls };
}

function deps(plaid: PlaidReadCalls): BankAdapterDeps {
  return {
    plaid,
    decrypt: (stored) => {
      if (!stored.startsWith("CIPHER_")) throw new Error("decrypt failed");
      return stored.replace("CIPHER_", "TOKEN_");
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("bankWindow", () => {
  it("ends on the given day and spans the given days, inclusive of both ends", () => {
    expect(bankWindow("2026-11-11", 90)).toEqual({ start: "2026-08-14", end: "2026-11-11" });
    expect(bankWindow("2026-11-11", READ_WINDOW_DAYS)).toEqual({
      start: "2025-10-11",
      end: "2026-11-11",
    });
    expect(bankWindow("2026-11-11", 1)).toEqual({ start: "2026-11-11", end: "2026-11-11" });
    expect(READ_WINDOW_DAYS).toBe(397);
  });

  it("crosses a leap day", () => {
    expect(bankWindow("2028-03-01", 2)).toEqual({ start: "2028-02-29", end: "2028-03-01" });
  });

  it("refuses an invalid day or length (caller bug)", () => {
    expect(() => bankWindow("2026-11-31", 90)).toThrow(/invalid today/);
    expect(() => bankWindow("2026-11-11", 0)).toThrow(/invalid days/);
    expect(() => bankWindow("2026-11-11", 1.5)).toThrow(/invalid days/);
  });
});

/*
 * The user's today from the time zone the client sent.
 *
 * Mutations that turn this block red:
 *   - the character check skipped (an offset like "+05:30" is a valid zone
 *     for the platform)                                -> "refuses …"
 *   - today taken in UTC whatever the zone             -> "takes the date …"
 *   - a refused value answered as user_time_zone       -> "refuses …"
 */
describe("resolveToday", () => {
  const AT_0500Z = new Date("2026-11-11T05:00:00Z");

  it("takes the date in the given zone", () => {
    expect(resolveToday("America/Los_Angeles", AT_0500Z)).toEqual({
      today: "2026-11-10",
      dateBasis: "user_time_zone",
    });
    expect(resolveToday("Asia/Seoul", AT_0500Z)).toEqual({
      today: "2026-11-11",
      dateBasis: "user_time_zone",
    });
    expect(resolveToday("Pacific/Kiritimati", new Date("2026-11-11T12:00:00Z"))).toEqual({
      today: "2026-11-12",
      dateBasis: "user_time_zone",
    });
  });

  it("accepts aliases and any letter case, as the platform does", () => {
    for (const zone of ["america/los_angeles", "US/Pacific", "UTC", "Etc/UTC"]) {
      expect(resolveToday(zone, AT_0500Z).dateBasis, zone).toBe("user_time_zone");
    }
    expect(resolveToday("US/Pacific", AT_0500Z).today).toBe("2026-11-10");
  });

  it("refuses anything else and falls back to the UTC date", () => {
    const refused: unknown[] = [
      undefined,
      null,
      123,
      {},
      "",
      " ",
      "Etc/Unknown",
      "Mars/Base",
      "+05:30",
      "America/Los Angeles",
      "America/Los_Angeles\n",
      "A".repeat(65),
    ];
    for (const raw of refused) {
      expect(resolveToday(raw, AT_0500Z), JSON.stringify(raw)).toEqual({
        today: "2026-11-11",
        dateBasis: "utc",
      });
    }
  });
});

describe("account mapping", () => {
  it("converts dollars to rounded integer cents", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: { accounts: [account({}, { current: 15.49, available: -0.5 })] },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.accounts[0].currentCents).toBe(1549);
    expect(read.accounts[0].availableCents).toBe(-50);
  });

  it("keeps a missing balance null rather than 0", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: { accounts: [account({}, { current: null, available: null, limit: null })] },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.accounts[0].currentCents).toBeNull();
    expect(read.accounts[0].availableCents).toBeNull();
    expect(read.accounts[0].limitCents).toBeNull();
  });

  it("keeps Plaid's own account type", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        accounts: [
          account({ account_id: "a", type: AccountType.Depository }),
          account({ account_id: "b", type: AccountType.Brokerage }),
          account({ account_id: "c", type: AccountType.Credit }),
          // Deliberately outside the SDK's enum: a type a later API version adds.
          account({ account_id: "d", type: "something-new" as unknown as AccountType }),
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.accounts.map((a) => a.type)).toEqual([
      "depository",
      "brokerage",
      "credit",
      "other",
    ]);
  });
});

describe("transaction paging", () => {
  it("reads every page up to total_transactions", async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => txn(`t${from + i}`));
    const { plaid, calls } = fakePlaid({
      TOKEN_1: {
        pages: [
          { transactions: page(0, 500), total: 1200 },
          { transactions: page(500, 500), total: 1200 },
          { transactions: page(1000, 200), total: 1200 },
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(calls.transactions.map((c) => c.req.options.offset)).toEqual([0, 500, 1000]);
    expect(calls.transactions.every((c) => c.req.options.count === TRANSACTIONS_PAGE_SIZE)).toBe(true);
    expect(read.transactions).toHaveLength(1200);
    expect(read.engineConnections[0].transactionsTruncated).toBe(false);
    expect(readCompleteness(read)).toBe("complete");
  });

  it("stops at the page cap and reports the window as possibly truncated", async () => {
    const full = Array.from({ length: 500 }, (_, i) => txn(`t${i}`));
    const { plaid, calls } = fakePlaid({
      TOKEN_1: { pages: [{ transactions: full, total: 99_999 }] },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(calls.transactions).toHaveLength(MAX_TRANSACTION_PAGES);
    expect(read.engineConnections[0].transactionsTruncated).toBe(true);
    expect(readCompleteness(read)).toBe("possibly_truncated");
  });

  it("stops on an empty page that should not be empty, and reports truncation", async () => {
    const { plaid, calls } = fakePlaid({
      TOKEN_1: {
        pages: [
          { transactions: [txn("a"), txn("b")], total: 1000 },
          { transactions: [], total: 1000 },
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(calls.transactions).toHaveLength(2);
    expect(read.engineConnections[0].transactionsTruncated).toBe(true);
    expect(readCompleteness(read)).toBe("possibly_truncated");
  });

  it("asks both Plaid calls for PFC v2 and carries PFC on each transaction", async () => {
    const { plaid, calls } = fakePlaid({});
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(calls.transactions[0].req.options.personal_finance_category_version).toBe("v2");
    expect(calls.recurring[0].options.personal_finance_category_version).toBe("v2");
    expect(calls.transactions[0].options).toEqual({ timeout: 10_000 });
    expect(calls.transactions[0].req.start_date).toBe(RANGE.start);
    expect(calls.transactions[0].req.end_date).toBe(RANGE.end);
    expect(read.transactions[0]).toMatchObject({
      amountCents: 1234,
      pfcPrimary: "FOOD_AND_DRINK",
      pfcDetailed: "FOOD_AND_DRINK_COFFEE",
      category: ["Food and Drink"],
    });
  });
});

describe("recurring streams", () => {
  it("keeps frequency, status, is_active and last_amount as Plaid sent them", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        streams: [
          stream("bi", { frequency: RecurringTransactionFrequency.Biweekly }),
          stream("semi", { frequency: RecurringTransactionFrequency.SemiMonthly }),
          stream("gone", {
            is_active: false,
            status: TransactionStreamStatus.Tombstoned,
            last_amount: { amount: 9.99, iso_currency_code: "USD", unofficial_currency_code: null },
          }),
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.engineConnections[0].recurringRead).toBe("ok");
    expect(engineRecurringOf(read).source).toBe("plaid_streams");
    const streams = read.streams;
    expect(streams.map((s) => s.frequency)).toEqual(["BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"]);
    expect(streams[2]).toMatchObject({ isActive: false, status: "TOMBSTONED", lastAmountCents: 999, averageAmountCents: 1549 });
  });

  it("a failed recurring call leaves the bank read but recurring unknown", async () => {
    const { plaid } = fakePlaid({ TOKEN_1: { streams: plaidError("INTERNAL_SERVER_ERROR") } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.connections[0].status).toBe("ok");
    expect(read.engineConnections[0]).toMatchObject({ state: "ok", recurringRead: "failed" });
    expect(read.streams).toEqual([]);
    expect(engineRecurringOf(read)).toMatchObject({ source: "unavailable", totalMonthlyCents: null });
  });

  it("an empty stream list is unknown, not zero", async () => {
    const { plaid } = fakePlaid({ TOKEN_1: { streams: [] } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.engineConnections[0].recurringRead).toBe("empty");
    expect(engineRecurringOf(read)).toMatchObject({ source: "unavailable", totalMonthlyCents: null });
  });

  it("is not called when not requested", async () => {
    const { plaid, calls } = fakePlaid({});
    await readBankData(USER, [row(1)], { accounts: false, transactions: true, recurring: false }, RANGE, deps(plaid));
    expect(calls.recurring).toHaveLength(0);
    expect(calls.accounts).toHaveLength(0);
  });
});

describe("stream currency", () => {
  // A shape the SDK allows: iso_currency_code is `string | null` on both amounts.
  const noCode = (amount: number) => ({
    amount,
    iso_currency_code: null,
    unofficial_currency_code: null,
  });
  const iso = (amount: number, code: string) => ({
    amount,
    iso_currency_code: code,
    unofficial_currency_code: null,
  });
  const unofficial = (amount: number, code: string) => ({
    amount,
    iso_currency_code: null,
    unofficial_currency_code: code,
  });
  const streamsOf = (read: Awaited<ReturnType<typeof readBankData>>) => read.streams;
  const engineRecurring = (read: Awaited<ReturnType<typeof readBankData>>) =>
    computeFinancialSummary(toEngineInput(read, DATES)).recurring;
  const bankReadLine = (spy: unknown) =>
    (spy as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[bank-read]"));

  beforeEach(() => {
    vi.mocked(console.log).mockClear();
    vi.mocked(console.warn).mockClear();
  });

  it("a USD account's stream with no currency on either amount is counted as a USD charge", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        streams: [stream("s-none", { average_amount: noCode(15.49), last_amount: noCode(15.49) })],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(streamsOf(read)[0].currency).toBe("USD");
    const recurring = engineRecurring(read);
    expect(recurring.items.map((i) => i.streamId)).toEqual(["s-none"]);
    expect(recurring.excluded).toEqual([]);
    expect(recurring.totalMonthlyCents).toBe(1549);
  });

  it("stays without a currency when its account is missing or has no ISO code", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        accounts: [
          account(),
          account({ account_id: "acc-btc" }, { iso_currency_code: null, unofficial_currency_code: "BTC" }),
        ],
        streams: [
          stream("s-orphan", { account_id: "acc-elsewhere", average_amount: noCode(5), last_amount: noCode(5) }),
          stream("s-btc", { account_id: "acc-btc", average_amount: noCode(5), last_amount: noCode(5) }),
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(streamsOf(read).map((s) => s.currency)).toEqual([null, null]);
    const recurring = engineRecurring(read);
    expect(recurring.items).toEqual([]);
    expect(recurring.excluded).toEqual([
      { streamId: "s-orphan", reason: "other_currency" },
      { streamId: "s-btc", reason: "other_currency" },
    ]);
  });

  it("does not take a currency from another connection's account", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        streams: [stream("s-cross", { account_id: "acc-2", average_amount: noCode(5), last_amount: noCode(5) })],
      },
      TOKEN_2: { accounts: [account({ account_id: "acc-2" })], streams: [] },
    });
    const read = await readBankData(USER, [row(1), row(2)], ALL, RANGE, deps(plaid));
    expect(streamsOf(read).map((s) => [s.streamId, s.currency])).toEqual([["s-cross", null]]);
  });

  it("keeps a code Plaid sent: an unofficial or differently cased code stays excluded", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        streams: [
          stream("s-btc", { average_amount: unofficial(5, "BTC"), last_amount: unofficial(5, "BTC") }),
          stream("s-lower", { average_amount: iso(5, "usd"), last_amount: iso(5, "usd") }),
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(streamsOf(read).map((s) => s.currency)).toEqual([null, "usd"]);
    const recurring = engineRecurring(read);
    expect(recurring.items).toEqual([]);
    expect(recurring.excluded).toEqual([
      { streamId: "s-btc", reason: "other_currency" },
      { streamId: "s-lower", reason: "other_currency" },
    ]);
  });

  it("logs a count per currency shape, judged by the first amount that carries a code", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        streams: [
          stream("a"),
          stream("b", { average_amount: noCode(5), last_amount: iso(5, "USD") }),
          stream("c", { average_amount: iso(5, "EUR"), last_amount: iso(5, "EUR") }),
          stream("d", { average_amount: iso(5, "usd"), last_amount: iso(5, "usd") }),
          stream("e", { average_amount: unofficial(5, "BTC"), last_amount: unofficial(5, "BTC") }),
          stream("f", { average_amount: noCode(5), last_amount: noCode(5) }),
          stream("g", { average_amount: unofficial(5, "BTC"), last_amount: iso(5, "USD") }),
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    const lines = bankReadLine(console.log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("streams=7 stream_ccy=usd:2,other_iso:2,unofficial:2,none:1");
    expect(lines[0]).not.toMatch(/acc-1|Netflix|NETFLIX|EUR|BTC|15\.49/);
    // The mapping follows the same rule as the count.
    expect(streamsOf(read).map((s) => s.currency)).toEqual(["USD", "USD", "EUR", "usd", null, "USD", null]);
  });

  it("logs zero counts when recurring was not read", async () => {
    const failed = fakePlaid({ TOKEN_1: { streams: plaidError("INTERNAL_SERVER_ERROR") } });
    await readBankData(USER, [row(1)], ALL, RANGE, deps(failed.plaid));
    const down = fakePlaid({ TOKEN_2: { accounts: plaidError("INSTITUTION_DOWN") } });
    await readBankData(USER, [row(2)], ALL, RANGE, deps(down.plaid));
    const zero = "stream_ccy=usd:0,other_iso:0,unofficial:0,none:0";
    expect(bankReadLine(console.log)).toEqual([expect.stringContaining(`recurring=failed streams=0 ${zero}`)]);
    expect(bankReadLine(console.warn)).toEqual([expect.stringContaining(`recurring=skipped streams=0 ${zero}`)]);
  });
});

describe("connection status", () => {
  /** console.error silenced for one test, starting with no recorded calls. */
  function silenceErrors() {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    spy.mockClear();
    return spy;
  }

  afterEach(() => {
    if (vi.isMockFunction(console.error)) vi.mocked(console.error).mockRestore();
  });

  it("an expired login is reported with its item id, and other banks still count", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: { accounts: plaidError("ITEM_LOGIN_REQUIRED") },
      TOKEN_2: { accounts: [account({ account_id: "acc-2" })] },
    });
    const read = await readBankData(USER, [row(1), row(2)], ALL, RANGE, deps(plaid));
    expect(read.connections).toEqual([
      { itemId: "item-1", institutionName: "Bank 1", status: "login_required" },
      { itemId: "item-2", institutionName: "Bank 2", status: "ok" },
    ]);
    expect(read.accounts.map((a) => a.accountId)).toEqual(["acc-2"]);
    expect(read.engineConnections.map((c) => [c.state, c.recurringRead])).toEqual([
      ["login_required", null],
      ["ok", "ok"],
    ]);
    expect(readCompleteness(read)).toBe("unknown");
    expect(engineRecurringOf(read).source).toBe("unavailable");
  });

  it("INVALID_ACCESS_TOKEN is a login problem too", async () => {
    const { plaid } = fakePlaid({ TOKEN_1: { accounts: plaidError("INVALID_ACCESS_TOKEN") } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.connections[0].status).toBe("login_required");
  });

  it("any other failure is failed, and the bank's partial data is dropped", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: { pages: [plaidError("INSTITUTION_DOWN")] },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.connections[0].status).toBe("failed");
    expect(read.accounts).toEqual([]);
    expect(read.transactions).toEqual([]);
    expect(read.streams).toEqual([]);
    expect(readCompleteness(read)).toBe("unknown");
  });

  it("an error with no Plaid code (a timeout) is failed", async () => {
    const { plaid } = fakePlaid({ TOKEN_1: { accounts: new Error("timeout of 10000ms exceeded") } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.connections[0].status).toBe("failed");
  });

  it("PRODUCT_NOT_READY is syncing, not failed", async () => {
    const { plaid } = fakePlaid({ TOKEN_1: { pages: [plaidError("PRODUCT_NOT_READY")] } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.connections[0].status).toBe("syncing");
    expect(read.engineConnections[0].state).toBe("syncing");
    expect(readCompleteness(read)).toBe("unknown");
  });

  it("decrypt, some rows: that connection is failed with no data, the others are read", async () => {
    silenceErrors();
    const { plaid, calls } = fakePlaid({
      TOKEN_1: { accounts: [account({ account_id: "acc-1" })] },
      TOKEN_3: { accounts: [account({ account_id: "acc-3" })] },
    });
    const bad = { ...row(2), access_token: "garbage" };
    const read = await readBankData(USER, [row(1), bad, row(3)], ALL, RANGE, deps(plaid));

    expect(read.connections).toEqual([
      { itemId: "item-1", institutionName: "Bank 1", status: "ok" },
      { itemId: "item-2", institutionName: "Bank 2", status: "failed" },
      { itemId: "item-3", institutionName: "Bank 3", status: "ok" },
    ]);
    expect(read.engineConnections[1]).toEqual({
      connectionKey: "c1",
      state: "failed",
      lastSuccessfulUpdate: null,
      recurringRead: null,
      transactionsTruncated: false,
      earliestTransactionDate: null,
      invalidTransactions: { duplicate: 0, invalid: 0 },
    });
    expect(read.engineConnections.map((c) => c.connectionKey)).toEqual(["c0", "c1", "c2"]);
    expect(read.accounts.map((a) => a.accountId)).toEqual(["acc-1", "acc-3"]);
    expect(read.accounts.every((a) => a.itemId !== "item-2")).toBe(true);

    // No Plaid call of any kind was made for the row that would not decrypt.
    const tokensSent = [
      ...calls.accounts,
      ...calls.item,
      ...calls.recurring,
      ...calls.transactions.map((c: { req: unknown }) => c.req),
    ].map((req) => (req as { access_token: string }).access_token);
    expect(new Set(tokensSent)).toEqual(new Set(["TOKEN_1", "TOKEN_3"]));

    // One connection not read keeps the figures from looking complete.
    expect(readCompleteness(read)).toBe("unknown");
  });

  it("decrypt, every row: throws before any Plaid call, for one row and for several", async () => {
    silenceErrors();
    const { plaid, calls } = fakePlaid({});
    const bad = (n: number) => ({ ...row(n), access_token: `garbage-${n}` });

    await expect(readBankData(USER, [bad(1)], ALL, RANGE, deps(plaid))).rejects.toThrow(
      "decrypt failed"
    );
    await expect(readBankData(USER, [bad(1), bad(2)], ALL, RANGE, deps(plaid))).rejects.toThrow(
      "decrypt failed"
    );
    expect(calls.accounts).toHaveLength(0);
    expect(calls.transactions).toHaveLength(0);
    expect(calls.recurring).toHaveLength(0);
    expect(calls.item).toHaveLength(0);
  });

  it("decrypt log: the crypto reason only, never the message, stored value, token or item id", async () => {
    const errors = silenceErrors();
    const { plaid } = fakePlaid({});
    const SENTINEL_MESSAGE = "SENTINEL_MESSAGE_decrypt_5be1";
    const SENTINEL_STORED = "SENTINEL_STORED_decrypt_90ac";
    const SENTINEL_PLAIN_MESSAGE = "SENTINEL_PLAIN_decrypt_2f7d";
    const rows: StoredConnectionRow[] = [
      row(1),
      { access_token: SENTINEL_STORED, item_id: "item-crypto", institution_name: "Bank 2" },
      { access_token: "PLAIN_FAIL", item_id: "item-plain", institution_name: "Bank 3" },
    ];
    await readBankData(USER, rows, ALL, RANGE, {
      plaid,
      decrypt: (stored) => {
        if (stored === SENTINEL_STORED) {
          throw new PlaidTokenCryptoError("auth_failed", `${SENTINEL_MESSAGE} ${stored}`);
        }
        if (stored === "PLAIN_FAIL") throw new Error(SENTINEL_PLAIN_MESSAGE);
        return stored.replace("CIPHER_", "TOKEN_");
      },
    });

    const lines = errors.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines).toEqual([
      "[bank-read] idx=1 status=failed cause=decrypt reason=auth_failed",
      "[bank-read] idx=2 status=failed cause=decrypt reason=unknown",
    ]);
    const all = lines.join("\n");
    for (const forbidden of [
      SENTINEL_MESSAGE,
      SENTINEL_STORED,
      SENTINEL_PLAIN_MESSAGE,
      "PLAIN_FAIL",
      "TOKEN_",
      "item-crypto",
      "item-plain",
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });

  it("decrypt log: a Plaid failure's line never reads as a decrypt failure", async () => {
    const errors = silenceErrors();
    vi.mocked(console.warn).mockClear();
    const { plaid } = fakePlaid({ TOKEN_1: { accounts: plaidError("INSTITUTION_DOWN") } });
    const bad = { ...row(2), access_token: "garbage" };
    const read = await readBankData(USER, [row(1), bad], ALL, RANGE, deps(plaid));

    expect(read.connections.map((c) => c.status)).toEqual(["failed", "failed"]);
    const plaidLines = vi
      .mocked(console.warn)
      .mock.calls.map((c) => String(c[0]))
      .filter((l) => l.startsWith("[bank-read] idx=0 "));
    expect(plaidLines).toHaveLength(1);
    expect(plaidLines[0]).toContain("status=failed code=INSTITUTION_DOWN");
    expect(plaidLines[0]).not.toContain("cause=decrypt");
    const decryptLines = errors.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("cause=decrypt"));
    expect(decryptLines).toEqual(["[bank-read] idx=1 status=failed cause=decrypt reason=unknown"]);
  });

  it("decrypts with the caller's user id unmodified", async () => {
    const { plaid } = fakePlaid({});
    const seen: string[] = [];
    await readBankData("User-ABC ", [row(1)], ALL, RANGE, {
      plaid,
      decrypt: (stored, userId) => {
        seen.push(userId);
        return stored.replace("CIPHER_", "TOKEN_");
      },
    });
    expect(seen).toEqual(["User-ABC "]);
  });
});

/*
 * What the engine now receives beyond balances and transactions.
 *
 * Mutations that turn this block red:
 *   - inflow streams dropped or mixed into the outflow list  -> "inflow streams …"
 *   - a stream's category, account or transaction ids dropped -> "a stream carries …"
 *   - merchant_entity_id dropped                             -> "a transaction carries …"
 *   - an /item/get failure turned into a connection status   -> "the Item's last update …"
 *   - a duplicate key built from part of the description     -> "the duplicate key …"
 *   - the duplicate key built from readable text             -> "the duplicate key …"
 *   - the recurring-without-accounts guard removed           -> "refuses recurring without accounts …"
 */
describe("engine input fields", () => {
  const withCategory = {
    personal_finance_category: {
      primary: "ENTERTAINMENT",
      detailed: "ENTERTAINMENT_TV_AND_MOVIES",
      version: PersonalFinanceCategoryVersion.V2,
    },
  };

  it("inflow streams arrive as a separate income list", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        streams: [stream("out")],
        inflow: [
          stream("pay", {
            merchant_name: null,
            description: "PAYROLL",
            average_amount: { amount: -2500, iso_currency_code: "USD", unofficial_currency_code: null },
            last_amount: { amount: -2500, iso_currency_code: "USD", unofficial_currency_code: null },
          }),
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.streams.map((s) => s.streamId)).toEqual(["out"]);
    expect(read.incomeStreams.map((s) => [s.streamId, s.averageAmountCents])).toEqual([["pay", -250000]]);
    const input = toEngineInput(read, DATES);
    expect(input.recurring.incomeStreams.map((s) => s.streamId)).toEqual(["pay"]);
    // Income streams are not charges.
    expect(computeFinancialSummary(input).recurring.items.map((i) => i.streamId)).toEqual(["out"]);
  });

  it("a stream carries its category, account and transaction ids", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        streams: [
          stream("s", { ...withCategory, category: ["Service", "Subscription"], transaction_ids: ["t-a", "t-b"] }),
          stream("bare"),
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.streams[0]).toMatchObject({
      accountId: "acc-1",
      pfcPrimary: "ENTERTAINMENT",
      pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
      legacyCategory: ["Service", "Subscription"],
      transactionIds: ["t-a", "t-b"],
    });
    expect(read.streams[1]).toMatchObject({
      pfcPrimary: null,
      pfcDetailed: null,
      legacyCategory: [],
      transactionIds: [],
    });
  });

  it("a transaction carries Plaid's merchant id to the engine, not to the screens", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: { pages: [{ transactions: [txn("t1", { merchant_entity_id: "m-1" }), txn("t2")], total: 2 }] },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(toEngineInput(read, DATES).transactions.map((t) => t.merchantEntityId)).toEqual(["m-1", null]);
    expect(toDisplayTransaction(read.transactions[0])).not.toHaveProperty("merchantEntityId");
  });

  it("the Item's last update is carried, and its failure changes no status", async () => {
    const ok = fakePlaid({ TOKEN_1: { item: { lastSuccessfulUpdate: "2026-11-11T03:00:00Z" } } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(ok.plaid));
    expect(ok.calls.item).toEqual([{ access_token: "TOKEN_1" }]);
    expect(read.engineConnections[0]).toMatchObject({
      state: "ok",
      lastSuccessfulUpdate: "2026-11-11T03:00:00Z",
    });

    for (const item of [plaidError("INTERNAL_SERVER_ERROR"), "throw" as const]) {
      const failing = fakePlaid({ TOKEN_1: { item } });
      const r = await readBankData(USER, [row(1)], ALL, RANGE, deps(failing.plaid));
      expect(r.connections[0].status).toBe("ok");
      expect(r.engineConnections[0]).toMatchObject({ state: "ok", lastSuccessfulUpdate: null });
      expect(r.transactions).toHaveLength(1);
    }
  });

  it("the Item is not read when accounts are not", async () => {
    const { plaid, calls } = fakePlaid({});
    await readBankData(USER, [row(1)], { accounts: false, transactions: true, recurring: false }, RANGE, deps(plaid));
    expect(calls.item).toHaveLength(0);
  });

  it("records the earliest transaction date received, per connection", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        pages: [{ transactions: [txn("a", { date: "2026-10-02" }), txn("b", { date: "2026-09-15" })], total: 2 }],
      },
      TOKEN_2: { pages: [{ transactions: [], total: 0 }] },
    });
    const read = await readBankData(USER, [row(1), row(2)], ALL, RANGE, deps(plaid));
    expect(read.engineConnections.map((c) => c.earliestTransactionDate)).toEqual(["2026-09-15", null]);
  });

  it("the duplicate key matches the same account across connections and nothing less", async () => {
    const same = account({ account_id: "a" });
    const { plaid } = fakePlaid({
      TOKEN_1: { accounts: [same, account({ account_id: "nomask", mask: null })] },
      TOKEN_2: { accounts: [{ ...same, account_id: "b" }, account({ account_id: "other", name: "Savings" })] },
    });
    const rows = [row(1), { ...row(2), institution_name: "Bank 1" }];
    const read = await readBankData(USER, rows, ALL, RANGE, deps(plaid));
    const key = (id: string) => read.accounts.find((a) => a.accountId === id)?.duplicateKey;
    expect(key("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(key("b")).toBe(key("a"));
    expect(key("other")).not.toBe(key("a"));
    expect(key("nomask")).toBeNull();
    // A connection without an institution name gives no key at all.
    const unnamed = await readBankData(USER, [{ ...row(1), institution_name: null }], ALL, RANGE, deps(plaid));
    expect(unnamed.accounts.every((a) => a.duplicateKey === null)).toBe(true);
    // Opaque: no part of the description is readable in it.
    expect(key("a")).not.toMatch(/Bank|Checking|checking|0000|depository/);
    expect(read.accounts.map((a) => a.connectionKey)).toEqual(["c0", "c0", "c1", "c1"]);
  });

  // Red if: the subtype is left out of the key, or a missing subtype still
  // gives one.
  it("the duplicate key includes the account subtype", async () => {
    const same = account({ account_id: "a" });
    const { plaid } = fakePlaid({
      TOKEN_1: { accounts: [same, account({ account_id: "nosub", subtype: null })] },
      TOKEN_2: { accounts: [{ ...same, account_id: "savings", subtype: AccountSubtype.Savings }] },
    });
    const rows = [row(1), { ...row(2), institution_name: "Bank 1" }];
    const read = await readBankData(USER, rows, ALL, RANGE, deps(plaid));
    const key = (id: string) => read.accounts.find((a) => a.accountId === id)?.duplicateKey;
    expect(key("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(key("savings")).toMatch(/^[0-9a-f]{64}$/);
    expect(key("savings")).not.toBe(key("a"));
    expect(key("nosub")).toBeNull();
  });

  // Red if: the version tag or the order of the hashed parts changes.
  it("the duplicate key is the hash of the versioned description", async () => {
    const { plaid } = fakePlaid({ TOKEN_1: { accounts: [account()] } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    const expected = createHash("sha256")
      .update(JSON.stringify(["v2", "Bank 1", "depository", "checking", "0000", "Checking"]))
      .digest("hex");
    expect(read.accounts[0].duplicateKey).toBe(expected);
  });

  // Red if: the kept copy of an account reached through two connections
  // depends on which connection was read first.
  it("keeps the same copy of a duplicated account whatever order the connections are read in", async () => {
    const { plaid } = fakePlaid({
      // The account ids sort the other way, so only the connections' last
      // updates can decide.
      TOKEN_1: {
        accounts: [account({ account_id: "z-fresh" })],
        item: { lastSuccessfulUpdate: "2026-11-11T03:00:00Z" },
      },
      TOKEN_2: {
        accounts: [account({ account_id: "a-stale" })],
        item: { lastSuccessfulUpdate: "2026-11-09T03:00:00Z" },
      },
    });
    const one = row(1);
    const two = { ...row(2), institution_name: "Bank 1" };
    const keptAfter = async (rows: StoredConnectionRow[]) => {
      const read = await readBankData(USER, rows, ALL, RANGE, deps(plaid));
      return dropDuplicateAccountCopies(toEngineInput(read, DATES)).input.accounts.map((a) => a.accountId);
    };
    expect(await keptAfter([one, two])).toEqual(["z-fresh"]);
    expect(await keptAfter([two, one])).toEqual(["z-fresh"]);
  });

  it("refuses recurring without accounts before decrypting or calling Plaid", async () => {
    const { plaid, calls } = fakePlaid({});
    let decrypted = 0;
    await expect(
      readBankData(USER, [row(1)], { accounts: false, transactions: true, recurring: true }, RANGE, {
        plaid,
        decrypt: (stored) => {
          decrypted += 1;
          return stored;
        },
      })
    ).rejects.toThrow(/recurring needs accounts/);
    expect(decrypted).toBe(0);
    expect(calls.accounts.length + calls.transactions.length + calls.recurring.length + calls.item.length).toBe(0);
  });

  // Red if: the card-payment axis is dropped, or counts a stream under the
  // wrong account type.
  it("logs card-payment streams by the type of the account they name", async () => {
    vi.mocked(console.log).mockClear();
    const cardPayment = {
      personal_finance_category: {
        primary: "LOAN_PAYMENTS",
        detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        version: PersonalFinanceCategoryVersion.V2,
      },
    };
    const { plaid } = fakePlaid({
      TOKEN_1: {
        accounts: [
          account(),
          account({ account_id: "acc-card", type: AccountType.Credit, subtype: AccountSubtype.CreditCard }),
          account({ account_id: "acc-loan", type: AccountType.Loan, subtype: AccountSubtype.Student }),
        ],
        streams: [
          stream("from-cash", cardPayment),
          stream("legacy-from-cash", { category: ["Payment", "Credit Card"] }),
          stream("on-card", { ...cardPayment, account_id: "acc-card" }),
          stream("on-loan", { ...cardPayment, account_id: "acc-loan" }),
          stream("nowhere", { ...cardPayment, account_id: "acc-gone" }),
          stream("ordinary"),
        ],
        inflow: [stream("into-card", { ...cardPayment, account_id: "acc-card" })],
      },
    });
    await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    const line = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[bank-read]"))[0];
    expect(line).toContain("card_pay_out=depository:2,credit:1,other:1,none:1");
    expect(line).toContain("card_pay_in=depository:0,credit:1,other:0,none:0");
    expect(line).not.toMatch(/acc-|15\.49|Netflix/);
  });

  it("logs the new read axes as counts, never values", async () => {
    vi.mocked(console.log).mockClear();
    const { plaid } = fakePlaid({
      TOKEN_1: {
        item: { lastSuccessfulUpdate: "2026-11-11T03:00:00Z" },
        streams: [stream("a", withCategory), stream("b")],
        inflow: [stream("pay", withCategory)],
        pages: [{ transactions: [txn("t", { date: "2026-08-20" })], total: 1 }],
      },
    });
    await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    const line = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[bank-read]"))[0];
    // From the earliest transaction to the window's end, both ends counted.
    expect(line).toContain("item=ok last_update=present inflow_streams=1 stream_pfc=2 history_days=84");
    expect(line).not.toMatch(/2026-|ENTERTAINMENT|Netflix|TOKEN|item-1|acc-1/);
  });

  // Red if: one end of the range is not counted, or the length is counted
  // from the window's start instead of from the earliest transaction.
  it("logs history_days as the days from the earliest transaction to today, inclusive", async () => {
    const bankReadLine = () =>
      (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.startsWith("[bank-read]"))[0];

    vi.mocked(console.log).mockClear();
    const today = fakePlaid({
      TOKEN_1: { pages: [{ transactions: [txn("t", { date: RANGE.end })], total: 1 }] },
    });
    await readBankData(USER, [row(1)], ALL, RANGE, deps(today.plaid));
    expect(bankReadLine()).toMatch(/ history_days=1 /);

    vi.mocked(console.log).mockClear();
    const none = fakePlaid({ TOKEN_1: { pages: [{ transactions: [], total: 0 }] } });
    await readBankData(USER, [row(1)], ALL, RANGE, deps(none.plaid));
    expect(bankReadLine()).toMatch(/ history_days=none /);
  });
});

// Red if: the screen's list is built from the whole read window, or keeps a
// field only the engine reads.
describe("displayTransactions", () => {
  it("keeps only the transactions dated inside the window, inclusive, in read order", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: {
        pages: [
          {
            transactions: [
              txn("today", { date: "2026-11-11" }),
              txn("first-day", { date: "2026-08-14" }),
              txn("day-before", { date: "2026-08-13" }),
              txn("last-year", { date: "2025-11-20", merchant_entity_id: "m-1" }),
              txn("bad", { date: "11/01/2026" }),
            ],
            total: 5,
          },
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, { start: "2025-10-11", end: "2026-11-11" }, deps(plaid));
    const list = displayTransactions(read, { start: "2026-08-14", end: "2026-11-11" });
    expect(list.map((t) => t.transactionId)).toEqual(["today", "first-day"]);
    expect(list.every((t) => !("merchantEntityId" in t))).toBe(true);
  });
});

describe("engine input", () => {
  it("carries no display fields into the engine", async () => {
    const { plaid } = fakePlaid({});
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    const input = toEngineInput(read, DATES);
    const text = JSON.stringify(input);
    expect(text).not.toContain("Bank 1");
    expect(text).not.toContain("item-1");
    expect(text).not.toContain("Checking");
    expect(text).not.toContain("0000");
    expect(input.period).toEqual(RANGE);
    expect(input.readWindow).toEqual(RANGE);
    expect(input.connections).toEqual(read.engineConnections);
    expect(input.currency).toBe("USD");
  });
});

describe("transaction filter", () => {
  /** An element as Plaid might send it when it breaks the SDK's own types. */
  function raw(value: unknown): Transaction {
    return value as Transaction;
  }

  function onePage(transactions: Transaction[]): Script {
    return { pages: [{ transactions, total: transactions.length }] };
  }

  /** The same fake, with one token's transaction pages answered after a delay. */
  function slowTransactions(plaid: PlaidReadCalls, token: string, ms: number): PlaidReadCalls {
    return {
      ...plaid,
      transactionsGet: (req, options) =>
        req.access_token === token
          ? new Promise((resolve, reject) =>
              setTimeout(() => plaid.transactionsGet(req, options).then(resolve, reject), ms)
            )
          : plaid.transactionsGet(req, options),
    };
  }

  function filterLines(): string[] {
    return (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[bank-filter]"));
  }

  const withoutId: Partial<Transaction> = { ...txn("x") };
  delete withoutId.transaction_id;
  const CASES: Array<[string, unknown]> = [
    ["null element", null],
    ["undefined element", undefined],
    ["number element", 5],
    ["string element", "x"],
    ["missing transaction_id", withoutId],
    ["empty transaction_id", txn("")],
    ["numeric transaction_id", { ...txn("x"), transaction_id: 7 }],
    ["empty account_id", txn("x", { account_id: "" })],
    ["null account_id", { ...txn("x"), account_id: null }],
    ["numeric account_id", { ...txn("x"), account_id: 7 }],
    ["null amount", { ...txn("x"), amount: null }],
    ["missing amount", { ...txn("x"), amount: undefined }],
    ["numeric-string amount", { ...txn("x"), amount: "12.34" }],
    ["NaN amount", txn("x", { amount: Number.NaN })],
    ["Infinity amount", txn("x", { amount: Number.POSITIVE_INFINITY })],
    ["amount beyond safe cents", txn("x", { amount: 1e17 })],
    ["slash date", txn("x", { date: "11/01/2026" })],
    ["impossible date", txn("x", { date: "2026-02-30" })],
    ["null date", { ...txn("x"), date: null }],
    ["null pending", { ...txn("x"), pending: null }],
    ["string pending", { ...txn("x"), pending: "false" }],
    ["numeric pending", { ...txn("x"), pending: 0 }],
  ];

  it.each(CASES)("%s is counted invalid and left out; its neighbour is kept", async (_label, bad) => {
    expect(isUsableTransaction(bad)).toBe(false);
    const { plaid } = fakePlaid({ TOKEN_1: onePage([raw(bad), txn("ok")]) });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.connections[0].status).toBe("ok");
    expect(read.transactions.map((t) => t.transactionId)).toEqual(["ok"]);
    expect(read.engineConnections[0].invalidTransactions).toEqual({ duplicate: 0, invalid: 1 });
  });

  it("a well-formed transaction is usable", () => {
    expect(isUsableTransaction(txn("x"))).toBe(true);
    expect(isUsableTransaction(txn("x", { amount: -0.01, pending: true }))).toBe(true);
  });

  it("an element that is not an object does not fail its connection", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: onePage([raw(null), txn("a"), raw(undefined)]),
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.connections[0].status).toBe("ok");
    expect(read.engineConnections[0].state).toBe("ok");
    expect(read.accounts.map((a) => a.accountId)).toEqual(["acc-1"]);
    expect(read.transactions.map((t) => t.transactionId)).toEqual(["a"]);
    expect(read.engineConnections[0].invalidTransactions).toEqual({ duplicate: 0, invalid: 2 });
  });

  it("a null amount is invalid, never 0 cents", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: onePage([raw({ ...txn("nil"), amount: null, date: "2026-08-20" }), txn("a")]),
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.transactions.some((t) => t.transactionId === "nil")).toBe(false);
    expect(read.transactions.some((t) => t.amountCents === 0)).toBe(false);
    expect(read.engineConnections[0].invalidTransactions).toEqual({ duplicate: 0, invalid: 1 });
    // Its date is not the connection's earliest either.
    expect(read.engineConnections[0].earliestTransactionDate).toBe("2026-11-01");
  });

  it("a repeated transaction keeps the first copy, on one page and across pages", async () => {
    const samePage = fakePlaid({
      TOKEN_1: onePage([txn("d", { amount: 1 }), txn("d", { amount: 2 }), txn("e")]),
    });
    const a = await readBankData(USER, [row(1)], ALL, RANGE, deps(samePage.plaid));
    expect(a.transactions.map((t) => [t.transactionId, t.amountCents])).toEqual([
      ["d", 100],
      ["e", 1234],
    ]);
    expect(a.engineConnections[0].invalidTransactions).toEqual({ duplicate: 1, invalid: 0 });

    const twoPages = fakePlaid({
      TOKEN_1: {
        pages: [
          { transactions: [txn("d", { amount: 1 })], total: 2 },
          { transactions: [txn("d", { amount: 2 })], total: 2 },
        ],
      },
    });
    const b = await readBankData(USER, [row(1)], ALL, RANGE, deps(twoPages.plaid));
    expect(b.transactions.map((t) => t.amountCents)).toEqual([100]);
    expect(b.engineConnections[0].invalidTransactions).toEqual({ duplicate: 1, invalid: 0 });
  });

  it("a repeat on a later connection is counted there, whichever bank answers first", async () => {
    for (const slow of ["TOKEN_1", "TOKEN_2"]) {
      const { plaid } = fakePlaid({
        TOKEN_1: onePage([txn("d", { amount: 1 })]),
        TOKEN_2: onePage([txn("d", { amount: 2 }), txn("f")]),
      });
      const read = await readBankData(
        USER,
        [row(1), row(2)],
        ALL,
        RANGE,
        deps(slowTransactions(plaid, slow, 20))
      );
      expect(read.transactions.map((t) => [t.transactionId, t.amountCents])).toEqual([
        ["d", 100],
        ["f", 1234],
      ]);
      expect(read.engineConnections.map((c) => c.invalidTransactions)).toEqual([
        { duplicate: 0, invalid: 0 },
        { duplicate: 1, invalid: 0 },
      ]);
    }
  });

  it("the same id on another account keeps the first and counts the later one invalid", async () => {
    const oneConnection = fakePlaid({
      TOKEN_1: onePage([txn("d", { account_id: "acc-1" }), txn("d", { account_id: "acc-2" })]),
    });
    const a = await readBankData(USER, [row(1)], ALL, RANGE, deps(oneConnection.plaid));
    expect(a.transactions.map((t) => [t.transactionId, t.accountId])).toEqual([["d", "acc-1"]]);
    expect(a.engineConnections[0].invalidTransactions).toEqual({ duplicate: 0, invalid: 1 });

    const twoConnections = fakePlaid({
      TOKEN_1: onePage([txn("d", { account_id: "acc-1" })]),
      TOKEN_2: onePage([txn("d", { account_id: "acc-2" })]),
    });
    const b = await readBankData(USER, [row(1), row(2)], ALL, RANGE, deps(twoConnections.plaid));
    expect(b.transactions.map((t) => [t.transactionId, t.accountId])).toEqual([["d", "acc-1"]]);
    expect(b.engineConnections.map((c) => c.invalidTransactions)).toEqual([
      { duplicate: 0, invalid: 0 },
      { duplicate: 0, invalid: 1 },
    ]);
    const list = displayTransactions(b, RANGE);
    expect(list.filter((t) => t.transactionId === "d")).toHaveLength(1);
  });

  it("counts belong to their own connection, and a connection not read counts none", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: onePage([raw(null), txn("a"), txn("a")]),
      TOKEN_2: onePage([txn("b"), raw({ ...txn("c"), pending: null }), raw({ ...txn("e"), amount: "1" })]),
      TOKEN_3: {
        pages: [
          { transactions: [raw(null), txn("g")], total: 4 },
          plaidError("INTERNAL_SERVER_ERROR"),
        ],
      },
    });
    const read = await readBankData(USER, [row(1), row(2), row(3)], ALL, RANGE, deps(plaid));
    expect(read.connections.map((c) => c.status)).toEqual(["ok", "ok", "failed"]);
    expect(read.engineConnections.map((c) => c.invalidTransactions)).toEqual([
      { duplicate: 1, invalid: 1 },
      { duplicate: 0, invalid: 2 },
      { duplicate: 0, invalid: 0 },
    ]);
  });

  it("the earliest date is taken from the transactions kept", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: onePage([
        txn("d", { date: "2026-09-10" }),
        txn("d", { date: "2026-08-20" }),
        raw({ ...txn("p"), date: "2026-08-15", pending: null }),
      ]),
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.engineConnections[0].earliestTransactionDate).toBe("2026-09-10");
  });

  it("pages by every element Plaid sent, kept or not", async () => {
    const { plaid, calls } = fakePlaid({
      TOKEN_1: {
        pages: [
          { transactions: [raw(null), txn("a"), txn("a")], total: 3 },
          { transactions: [txn("late")], total: 3 },
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(calls.transactions).toHaveLength(1);
    expect(read.engineConnections[0].transactionsTruncated).toBe(false);
    expect(read.transactions.map((t) => t.transactionId)).toEqual(["a"]);
  });

  it("logs counts per connection only, and nothing when none were left out", async () => {
    vi.mocked(console.log).mockClear();
    const { plaid } = fakePlaid({
      TOKEN_1: onePage([txn("clean")]),
      TOKEN_2: onePage([raw({ ...txn("secret-id"), amount: null }), txn("dup"), txn("dup")]),
    });
    await readBankData(USER, [row(1), row(2)], ALL, RANGE, deps(plaid));
    expect(filterLines()).toEqual(["[bank-filter] idx=1 invalid=1 duplicate=1"]);

    vi.mocked(console.log).mockClear();
    const clean = fakePlaid({ TOKEN_1: onePage([txn("a"), txn("b")]) });
    await readBankData(USER, [row(1)], ALL, RANGE, deps(clean.plaid));
    expect(filterLines()).toEqual([]);
  });

  it("the screens' list leaves out what the engine is not given, with unique row keys", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: onePage([
        txn("a"),
        txn("a"),
        raw({ ...txn("nil"), amount: null }),
        raw({ ...txn("str"), amount: "12.34" }),
        raw(null),
        txn("b"),
      ]),
      TOKEN_2: onePage([txn("b"), txn("c")]),
    });
    const read = await readBankData(USER, [row(1), row(2)], ALL, RANGE, deps(plaid));
    const list = displayTransactions(read, RANGE);
    expect(list.map((t) => t.transactionId)).toEqual(["a", "b", "c"]);
    const keys = list.map((t) => t.accountId + ":" + t.transactionId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(list.map((t) => t.transactionId)).toEqual(
      toEngineInput(read, DATES).transactions.map((t) => t.transactionId)
    );
  });

  it("the engine's invalid count is what the adapter left out, and its figures use the rest", async () => {
    const { plaid } = fakePlaid({
      TOKEN_1: onePage([
        txn("a"),
        txn("a"),
        raw({ ...txn("str"), amount: "12.34" }),
        raw(null),
        txn("b", { amount: 5 }),
      ]),
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    const summary = computeFinancialSummary(toEngineInput(read, DATES));
    expect(summary.cashFlow.excluded.invalid.count).toBe(3);

    const clean = fakePlaid({ TOKEN_1: onePage([txn("a"), txn("b", { amount: 5 })]) });
    const cleanRead = await readBankData(USER, [row(1)], ALL, RANGE, deps(clean.plaid));
    const cleanSummary = computeFinancialSummary(toEngineInput(cleanRead, DATES));
    expect(summary.cashFlow.spendingNetCents).toBe(cleanSummary.cashFlow.spendingNetCents);
    expect(summary.cashFlow.spendingNetCents).toBe(1234 + 500);
    expect(cleanSummary.cashFlow.excluded.invalid.count).toBe(0);
  });
});
