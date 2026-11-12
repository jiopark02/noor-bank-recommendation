import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/finance/summary, executed.
 *
 * The real authenticate() runs; only the token verification under it, the
 * connection read, the Plaid client and the token crypto are faked.
 *
 * Mutations that turn this file red:
 *   - the auth check removed, or moved after the configuration check -> unauthenticated
 *   - a connection row (or its token) spread into the response      -> no token in body
 *   - a failed connection read answered as "no connections"         -> failed read
 *   - the empty-case wording changed                                -> no active connection
 *   - completeness not taken from the connection statuses           -> partial failure
 *   - a summary computed when no bank was read                      -> nothing read
 *   - the body's timeZone ignored, or today taken twice             -> user's today
 *   - the time zone value written to the log                        -> user's today / fallback
 *   - the list sent for any truthy includeTransactions, or always   -> "only when … exactly true"
 *   - the list read a second time                                   -> "the same Plaid calls …"
 */

const PLAINTEXT = "access-sandbox-PLAINTEXT-TOKEN-7f3a";
const CIPHERTEXT = "v1:CIPHERTEXT-TOKEN-91bc";
const EMPTY_CASE = "No active bank connections found. Please connect a bank first.";

const state = {
  userId: "user-1" as string | null,
  plaidConfigured: true,
  connections: [] as Array<Record<string, unknown>> | null,
  failItems: {} as Record<string, string>,
  connectionReads: 0,
  connectionReadUserIds: [] as string[],
  plaidCalls: 0,
  decryptUserIds: [] as string[],
  transactionWindows: [] as Array<{ start: string; end: string }>,
};

function plaidError(code: string): Error {
  const e = new Error("Request failed with status code 400") as Error & Record<string, unknown>;
  e.isAxiosError = true;
  e.response = { status: 400, data: { error_code: code, error_type: "ITEM_ERROR" } };
  return e;
}

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => state.userId,
}));

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => {
    throw new Error("server client must not be used in this test");
  },
  createAdminClient: () => {
    throw new Error("admin client must not be used in this test");
  },
  isSupabaseConfigured: () => false,
  isSupabaseAdminConfigured: () => false,
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  getAllPlaidConnections: async (userId: string) => {
    state.connectionReads += 1;
    state.connectionReadUserIds.push(userId);
    return state.connections;
  },
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
  decryptPlaidAccessToken: (stored: string, userId: string) => {
    state.decryptUserIds.push(userId);
    if (!stored.startsWith(CIPHERTEXT)) throw new Error("decrypt failed");
    return PLAINTEXT + stored.slice(CIPHERTEXT.length);
  },
}));

/** "-1" for the first connection's token, and so on. */
function suffixOf(token: string): string {
  return token.slice(PLAINTEXT.length);
}
function itemOf(token: string): string {
  return "item" + suffixOf(token);
}

vi.mock("@/lib/plaid", () => ({
  isPlaidConfigured: () => state.plaidConfigured,
  plaidClient: {
    async itemGet() {
      state.plaidCalls += 1;
      return {
        data: { status: { transactions: { last_successful_update: "2026-11-11T03:00:00Z" } } },
      };
    },
    async accountsGet(req: { access_token: string }) {
      state.plaidCalls += 1;
      const failure = state.failItems[itemOf(req.access_token)];
      if (failure) throw plaidError(failure);
      const suffix = suffixOf(req.access_token);
      return {
        data: {
          accounts: [
            {
              account_id: "chk" + suffix,
              name: "Checking",
              official_name: null,
              mask: "1111",
              type: "depository",
              subtype: "checking",
              balances: { current: 1000, available: 900, limit: null, iso_currency_code: "USD" },
            },
          ],
        },
      };
    },
    async transactionsGet(req: { access_token: string; start_date: string; end_date: string }) {
      state.plaidCalls += 1;
      state.transactionWindows.push({ start: req.start_date, end: req.end_date });
      const suffix = suffixOf(req.access_token);
      return {
        data: {
          total_transactions: 2,
          transactions: [
            {
              transaction_id: "pay" + suffix,
              account_id: "chk" + suffix,
              amount: -2500,
              iso_currency_code: "USD",
              date: new Date().toISOString().slice(0, 10),
              pending: false,
              name: "Payroll",
              merchant_name: null,
              logo_url: null,
              category: [],
              personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES", version: "v2" },
            },
            {
              transaction_id: "food" + suffix,
              account_id: "chk" + suffix,
              amount: 40,
              iso_currency_code: "USD",
              date: new Date().toISOString().slice(0, 10),
              pending: false,
              name: "Grocer",
              merchant_name: "Grocer",
              logo_url: null,
              category: [],
              personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES", version: "v2" },
            },
          ],
        },
      };
    },
    async transactionsRecurringGet() {
      state.plaidCalls += 1;
      return { data: { outflow_streams: [], inflow_streams: [] } };
    },
  },
}));

function conn(n: number, over: Record<string, unknown> = {}) {
  return {
    access_token: `${CIPHERTEXT}-${n}`,
    item_id: `item-${n}`,
    institution_name: `Bank ${n}`,
    status: "active",
    user_id: "user-1",
    ...over,
  };
}

async function post(
  body: Record<string, unknown> = {}
): Promise<{ status: number; text: string; json: any }> {
  const { POST } = await import("../../app/api/finance/summary/route");
  const res = await POST(
    new Request("https://noor.test/api/finance/summary", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ userId: "someone-else", ...body }),
    }) as unknown as NextRequest
  );
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

beforeEach(() => {
  state.userId = "user-1";
  state.plaidConfigured = true;
  state.connections = [conn(1)];
  state.failItems = {};
  state.connectionReads = 0;
  state.connectionReadUserIds = [];
  state.plaidCalls = 0;
  state.decryptUserIds = [];
  state.transactionWindows = [];
  vi.useRealTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/finance/summary — access", () => {
  it("answers 401 without a verified user, and reads nothing", async () => {
    state.userId = null;
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Unauthorized" });
    expect(state.connectionReads).toBe(0);
    expect(state.plaidCalls).toBe(0);
  });

  it("answers 401, not the configuration state, when Plaid is unconfigured", async () => {
    state.userId = null;
    state.plaidConfigured = false;
    const res = await post();
    expect(res.status).toBe(401);
  });

  it("answers 503 to a signed-in user when Plaid is unconfigured", async () => {
    state.plaidConfigured = false;
    const res = await post();
    expect(res.status).toBe(503);
    expect(state.plaidCalls).toBe(0);
  });

  it("uses the token's user id, not one in the body, to decrypt", async () => {
    await post();
    expect(state.connectionReadUserIds).toEqual(["user-1"]);
    expect(state.decryptUserIds).toEqual(["user-1"]);
  });
});

describe("POST /api/finance/summary — connection reads", () => {
  it("a failed connection read is a 500, not the empty case", async () => {
    state.connections = null;
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.text).not.toContain(EMPTY_CASE);
  });

  it("no active connection is the 404 the screens match on", async () => {
    state.connections = [conn(1, { status: "error" })];
    const res = await post();
    expect(res.status).toBe(404);
    expect(res.json.error).toBe(EMPTY_CASE);
  });

  it("a decrypt failure is a 500 for the whole request", async () => {
    state.connections = [conn(1), { ...conn(2), access_token: "not-ciphertext" }];
    const res = await post();
    expect(res.status).toBe(500);
    expect(state.plaidCalls).toBe(0);
  });
});

describe("POST /api/finance/summary — response", () => {
  it("returns accounts, the engine summary and statuses, and never a token", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(PLAINTEXT);
    expect(res.text).not.toContain(CIPHERTEXT);
    expect(res.text).not.toContain("access_token");
    // The engine's opaque keys stay on the server.
    expect(res.text).not.toMatch(/duplicateKey|connectionKey|[0-9a-f]{64}/);
    expect(res.json.summary.coverage).toEqual({
      completeness: "complete",
      allConnectionsRead: true,
      safeToSpendShowable: true,
      duplicateCopiesDropped: { accounts: 0, transactions: 0, streams: 0 },
    });
    expect(res.json.connections).toEqual([
      { itemId: "item-1", institutionName: "Bank 1", status: "ok" },
    ]);
    expect(res.json.accounts[0]).toMatchObject({
      accountId: "chk-1",
      type: "depository",
      currentCents: 100000,
      availableCents: 90000,
    });
    expect(res.json.summary.cashFlow.incomeCents).toBe(250000);
    expect(res.json.summary.cashFlow.spendingNetCents).toBe(4000);
    expect(res.json.summary.cashFlow.period.completeness).toBe("complete");
    // An empty stream list is unknown, not $0.
    expect(res.json.summary.recurring.totalMonthlyCents).toBeNull();
  });

  it("a bank needing re-login is reported with its item id and makes the period incomplete", async () => {
    state.connections = [conn(1), conn(2)];
    state.failItems = { "item-2": "ITEM_LOGIN_REQUIRED" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.connections).toEqual([
      { itemId: "item-1", institutionName: "Bank 1", status: "ok" },
      { itemId: "item-2", institutionName: "Bank 2", status: "login_required" },
    ]);
    expect(res.json.summary.cashFlow.period.completeness).toBe("unknown");
    expect(res.json.accounts.map((a: { accountId: string }) => a.accountId)).toEqual(["chk-1"]);
  });

  it("counts dates from the user's today when the request names a usable time zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T05:00:00Z"));
    const res = await post({ timeZone: "America/Los_Angeles" });
    expect(res.status).toBe(200);
    // One today for the read window, the cash-flow period and the horizon.
    expect(state.transactionWindows).toEqual([{ start: "2025-10-10", end: "2026-11-10" }]);
    expect(res.json.summary.cashFlow.period).toMatchObject({ start: "2026-08-13", end: "2026-11-10" });
    expect(res.json.summary.safeToSpend.horizon).toEqual({
      from: "2026-11-10",
      to: "2026-11-30",
      rule: "end_of_calendar_month",
      dateBasis: "user_time_zone",
    });
    expect(res.json.summary.safeToSpend.assumptions).not.toContain("dates_utc");

    const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(logged).toContain("[finance-summary] date_basis=user");
    expect(logged).not.toMatch(/Los_Angeles|America/);
  });

  it("falls back to the UTC date, and says so, for a missing or unusable time zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T05:00:00Z"));
    for (const body of [{}, { timeZone: "Mars/Base" }, { timeZone: 42 }]) {
      state.transactionWindows = [];
      (console.log as unknown as { mockClear: () => void }).mockClear();
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(state.transactionWindows).toEqual([{ start: "2025-10-11", end: "2026-11-11" }]);
      expect(res.json.summary.safeToSpend.horizon.dateBasis).toBe("utc");
      expect(res.json.summary.safeToSpend.assumptions).toContain("dates_utc");
      const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((c) => c.map(String).join(" "))
        .join("\n");
      expect(logged).toContain("[finance-summary] date_basis=utc_fallback");
      expect(logged).not.toContain("Mars");
    }
  });

  // Source probe: a second clock read or a second resolveToday could put two
  // different todays into one answer at midnight.
  it("reads the clock and decides today once", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../app/api/finance/summary/route.ts", import.meta.url)),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source.match(/\bresolveToday\(/g) ?? []).toHaveLength(1);
    expect(source.match(/\bnew Date\(/g) ?? []).toHaveLength(1);
    expect(source.match(/\bDate\.now\(/g) ?? []).toHaveLength(0);
  });

  it("returns the display window's transactions from the same read, for the list", async () => {
    const res = await post({ includeTransactions: true });
    expect(res.status).toBe(200);
    expect(res.json.transactions.map((t: { transactionId: string }) => t.transactionId)).toEqual([
      "pay-1",
      "food-1",
    ]);
    expect(res.json.transactions[1]).toMatchObject({
      accountId: "chk-1",
      amountCents: 4000,
      name: "Grocer",
      merchantName: "Grocer",
    });
    expect(res.json.transactions[0]).not.toHaveProperty("merchantEntityId");
  });

  it("with no bank read there is no summary, only the statuses", async () => {
    state.connections = [conn(1), conn(2)];
    state.failItems = { "item-1": "ITEM_LOGIN_REQUIRED", "item-2": "ITEM_LOGIN_REQUIRED" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.summary).toBeNull();
    expect(res.json.accounts).toEqual([]);
    expect(res.json).not.toHaveProperty("transactions");
    expect(res.json.connections.map((c: { itemId: string }) => c.itemId)).toEqual([
      "item-1",
      "item-2",
    ]);

    // Asked for, the list is there and empty.
    const asked = await post({ includeTransactions: true });
    expect(asked.status).toBe(200);
    expect(asked.json.summary).toBeNull();
    expect(asked.json.transactions).toEqual([]);
  });

  it("sends the transaction list only when includeTransactions is exactly true", async () => {
    for (const body of [
      {},
      { includeTransactions: false },
      { includeTransactions: "true" },
      { includeTransactions: 1 },
      { includeTransactions: null },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(res.json, JSON.stringify(body)).not.toHaveProperty("transactions");
      // The figures are there either way.
      expect(res.json.summary.cashFlow.incomeCents, JSON.stringify(body)).toBe(250000);
    }
    const asked = await post({ includeTransactions: true });
    expect(asked.json.transactions).toHaveLength(2);
  });

  it("makes the same Plaid calls with or without the list", async () => {
    await post();
    const without = { calls: state.plaidCalls, windows: state.transactionWindows.slice() };
    state.plaidCalls = 0;
    state.transactionWindows = [];
    await post({ includeTransactions: true });
    expect(state.plaidCalls).toBe(without.calls);
    expect(state.transactionWindows).toEqual(without.windows);
  });
});
