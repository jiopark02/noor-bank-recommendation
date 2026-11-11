import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LOOKBACK_DAYS,
  MAX_TRANSACTION_PAGES,
  TRANSACTIONS_PAGE_SIZE,
  bankWindow,
  readBankData,
  toEngineInput,
  type BankAdapterDeps,
  type PlaidReadCalls,
  type StoredConnectionRow,
} from "../plaidEngineAdapter";

/**
 * Plaid -> engine adapter, executed against a fake Plaid client.
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
 *   - decrypt moved inside the per-connection catch                -> decrypt
 *   - recurring failure or an empty stream list sent as streams    -> recurring
 *   - PRODUCT_NOT_READY reported as failed                         -> syncing
 */

const RANGE = { start: "2026-08-14", end: "2026-11-11" };
const ALL = { accounts: true, transactions: true, recurring: true };
const USER = "user-1";

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

function account(over: Record<string, unknown> = {}, balances: Record<string, unknown> = {}) {
  return {
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
      ...balances,
    },
    ...over,
  };
}

function txn(id: string, over: Record<string, unknown> = {}) {
  return {
    transaction_id: id,
    account_id: "acc-1",
    amount: 12.34,
    iso_currency_code: "USD",
    date: "2026-11-01",
    pending: false,
    name: "Coffee",
    merchant_name: "Cafe",
    logo_url: null,
    category: ["Food and Drink"],
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE", version: "v2" },
    ...over,
  };
}

function stream(id: string, over: Record<string, unknown> = {}) {
  return {
    stream_id: id,
    account_id: "acc-1",
    description: "NETFLIX",
    merchant_name: "Netflix",
    frequency: "MONTHLY",
    average_amount: { amount: 15.49, iso_currency_code: "USD" },
    last_amount: { amount: 15.49, iso_currency_code: "USD" },
    last_date: "2026-10-20",
    predicted_next_date: "2026-11-20",
    is_active: true,
    status: "MATURE",
    ...over,
  };
}

type Script = {
  accounts?: unknown[] | Error;
  /** One entry per page call, in order; the last repeats. */
  pages?: Array<{ transactions: unknown[]; total: number } | Error>;
  streams?: unknown[] | Error;
};

function fakePlaid(scripts: Record<string, Script>) {
  const calls = { accounts: [] as unknown[], transactions: [] as any[], recurring: [] as any[] };
  const pageIndex: Record<string, number> = {};
  const plaid: PlaidReadCalls = {
    async accountsGet(req) {
      calls.accounts.push(req);
      const s = scripts[req.access_token] ?? {};
      if (s.accounts instanceof Error) throw s.accounts;
      return { data: { accounts: s.accounts ?? [account()] } } as any;
    },
    async transactionsGet(req, options) {
      calls.transactions.push({ req, options });
      const s = scripts[req.access_token] ?? {};
      const pages = s.pages ?? [{ transactions: [txn("t1")], total: 1 }];
      const i = pageIndex[req.access_token] ?? 0;
      pageIndex[req.access_token] = i + 1;
      const page = pages[Math.min(i, pages.length - 1)];
      if (page instanceof Error) throw page;
      return { data: { transactions: page.transactions, total_transactions: page.total } } as any;
    },
    async transactionsRecurringGet(req) {
      calls.recurring.push(req);
      const s = scripts[req.access_token] ?? {};
      if (s.streams instanceof Error) throw s.streams;
      return { data: { outflow_streams: s.streams ?? [stream("s1")], inflow_streams: [] } } as any;
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
  it("ends today (UTC) and spans the lookback inclusive of both ends", () => {
    expect(bankWindow(new Date("2026-11-11T23:30:00Z"))).toEqual({
      start: "2026-08-14",
      end: "2026-11-11",
    });
    expect(LOOKBACK_DAYS).toBe(90);
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
          account({ account_id: "a", type: "depository" }),
          account({ account_id: "b", type: "brokerage" }),
          account({ account_id: "c", type: "credit" }),
          account({ account_id: "d", type: "something-new" }),
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
    expect(read.completeness).toBe("complete");
  });

  it("stops at the page cap and reports the window as possibly truncated", async () => {
    const full = Array.from({ length: 500 }, (_, i) => txn(`t${i}`));
    const { plaid, calls } = fakePlaid({
      TOKEN_1: { pages: [{ transactions: full, total: 99_999 }] },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(calls.transactions).toHaveLength(MAX_TRANSACTION_PAGES);
    expect(read.completeness).toBe("possibly_truncated");
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
    expect(read.completeness).toBe("possibly_truncated");
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
          stream("bi", { frequency: "BIWEEKLY" }),
          stream("semi", { frequency: "SEMI_MONTHLY" }),
          stream("gone", { is_active: false, status: "TOMBSTONED", last_amount: { amount: 9.99, iso_currency_code: "USD" } }),
        ],
      },
    });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.recurring.source).toBe("plaid_streams");
    const streams = read.recurring.source === "plaid_streams" ? read.recurring.streams : [];
    expect(streams.map((s) => s.frequency)).toEqual(["BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"]);
    expect(streams[2]).toMatchObject({ isActive: false, status: "TOMBSTONED", lastAmountCents: 999, averageAmountCents: 1549 });
  });

  it("a failed recurring call leaves the bank read but recurring unknown", async () => {
    const { plaid } = fakePlaid({ TOKEN_1: { streams: plaidError("INTERNAL_SERVER_ERROR") } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.connections[0].status).toBe("ok");
    expect(read.recurring).toEqual({ source: "unavailable" });
  });

  it("an empty stream list is unknown, not zero", async () => {
    const { plaid } = fakePlaid({ TOKEN_1: { streams: [] } });
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    expect(read.recurring).toEqual({ source: "unavailable" });
  });

  it("is not called when not requested", async () => {
    const { plaid, calls } = fakePlaid({});
    await readBankData(USER, [row(1)], { accounts: false, transactions: true, recurring: false }, RANGE, deps(plaid));
    expect(calls.recurring).toHaveLength(0);
    expect(calls.accounts).toHaveLength(0);
  });
});

describe("connection status", () => {
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
    expect(read.completeness).toBe("unknown");
    expect(read.recurring).toEqual({ source: "unavailable" });
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
    expect(read.completeness).toBe("unknown");
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
    expect(read.completeness).toBe("unknown");
  });

  it("a decrypt failure throws before any Plaid call", async () => {
    const { plaid, calls } = fakePlaid({});
    const bad = { ...row(2), access_token: "garbage" };
    await expect(readBankData(USER, [row(1), bad], ALL, RANGE, deps(plaid))).rejects.toThrow(
      "decrypt failed"
    );
    expect(calls.accounts).toHaveLength(0);
    expect(calls.transactions).toHaveLength(0);
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

describe("engine input", () => {
  it("carries no display fields into the engine", async () => {
    const { plaid } = fakePlaid({});
    const read = await readBankData(USER, [row(1)], ALL, RANGE, deps(plaid));
    const input = toEngineInput(read, "2026-11-11T12:00:00Z", RANGE);
    const text = JSON.stringify(input);
    expect(text).not.toContain("Bank 1");
    expect(text).not.toContain("item-1");
    expect(text).not.toContain("Checking");
    expect(input.period).toEqual({ ...RANGE, completeness: "complete" });
    expect(input.currency).toBe("USD");
  });
});
