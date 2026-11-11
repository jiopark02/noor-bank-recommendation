import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/plaid/transactions, executed.
 *
 * The real authenticate() runs; only the token verification under it, the
 * connection read, the Plaid client and the token crypto are faked.
 *
 * Mutations that turn this file red:
 *   - the auth check removed, or moved after the configuration check -> unauthenticated
 *   - totals, category totals or subscriptions put back in the body  -> list only
 *   - PFC dropped from the listed transactions                        -> list only
 *   - dates from the request body used for the Plaid call             -> server window
 *   - every bank needing a new login answered as an empty list        -> re-link answer
 *   - the recurring call made by this route                           -> no recurring
 *   - a failed connection read answered as "no connections"          -> failed read
 */

const PLAINTEXT = "access-sandbox-PLAINTEXT-TOKEN-7f3a";
const CIPHERTEXT = "v1:CIPHERTEXT-TOKEN-91bc";
const EMPTY_CASE = "No active bank connections found. Please connect a bank first.";

const state = {
  userId: "user-1" as string | null,
  plaidConfigured: true,
  connections: [] as Array<Record<string, unknown>> | null,
  failItems: {} as Record<string, string>,
  connectionReadUserIds: [] as string[],
  transactionCalls: [] as Array<Record<string, any>>,
  recurringCalls: 0,
  accountCalls: 0,
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
    state.connectionReadUserIds.push(userId);
    return state.connections;
  },
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
  decryptPlaidAccessToken: (stored: string) => {
    if (!stored.startsWith(CIPHERTEXT)) throw new Error("decrypt failed");
    return PLAINTEXT + stored.slice(CIPHERTEXT.length);
  },
}));

/** "-1" for the first connection's token, and so on. */
function suffixOf(token: string): string {
  return token.slice(PLAINTEXT.length);
}

vi.mock("@/lib/plaid", () => ({
  isPlaidConfigured: () => state.plaidConfigured,
  plaidClient: {
    async accountsGet() {
      state.accountCalls += 1;
      return { data: { accounts: [] } };
    },
    async transactionsGet(req: Record<string, any>) {
      state.transactionCalls.push(req);
      const suffix = suffixOf(req.access_token);
      const failure = state.failItems["item" + suffix];
      if (failure) throw plaidError(failure);
      return {
        data: {
          total_transactions: 1,
          transactions: [
            {
              transaction_id: "food" + suffix,
              account_id: "chk" + suffix,
              amount: 12.5,
              iso_currency_code: "USD",
              date: "2026-11-01",
              pending: false,
              name: "Grocer",
              merchant_name: "Grocer",
              logo_url: null,
              category: ["Shops"],
              personal_finance_category: {
                primary: "FOOD_AND_DRINK",
                detailed: "FOOD_AND_DRINK_GROCERIES",
                version: "v2",
              },
            },
          ],
        },
      };
    },
    async transactionsRecurringGet() {
      state.recurringCalls += 1;
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

async function post(body: unknown = {}): Promise<{ status: number; text: string; json: any }> {
  const { POST } = await import("../../app/api/plaid/transactions/route");
  const res = await POST(
    new Request("https://noor.test/api/plaid/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify(body),
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
  state.connectionReadUserIds = [];
  state.transactionCalls = [];
  state.recurringCalls = 0;
  state.accountCalls = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/plaid/transactions — access", () => {
  it("answers 401 without a verified user, reading nothing and calling nothing", async () => {
    state.userId = null;
    state.plaidConfigured = false;
    const res = await post();
    expect(res.status).toBe(401);
    expect(state.connectionReadUserIds).toEqual([]);
    expect(state.transactionCalls).toHaveLength(0);
  });

  it("reads the token's user's connections, not a user named in the body", async () => {
    await post({ userId: "someone-else" });
    expect(state.connectionReadUserIds).toEqual(["user-1"]);
  });

  it("a failed connection read is a 500, not the empty case", async () => {
    state.connections = null;
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.text).not.toContain(EMPTY_CASE);
  });
});

describe("POST /api/plaid/transactions — the list", () => {
  it("lists transactions with PFC and no totals, category totals or subscriptions", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(Object.keys(res.json).sort()).toEqual(
      ["connections", "period", "success", "transactions"].sort()
    );
    expect(res.json.transactions[0]).toMatchObject({
      transactionId: "food-1",
      amountCents: 1250,
      pfcPrimary: "FOOD_AND_DRINK",
      pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
      category: ["Shops"],
    });
    expect(res.text).not.toContain(PLAINTEXT);
    expect(res.text).not.toContain(CIPHERTEXT);
    expect(res.text).not.toContain("access_token");
  });

  it("reads the server's window, whatever dates the body names", async () => {
    const res = await post({ startDate: "2000-01-01", endDate: "2000-12-31" });
    const req = state.transactionCalls[0];
    expect(req.start_date).toBe(res.json.period.start);
    expect(req.end_date).toBe(res.json.period.end);
    expect(req.start_date).not.toBe("2000-01-01");
    expect(req.options.personal_finance_category_version).toBe("v2");
  });

  it("makes no recurring and no accounts call", async () => {
    await post();
    expect(state.recurringCalls).toBe(0);
    expect(state.accountCalls).toBe(0);
  });

  it("every bank needing a new login keeps the re-link answer", async () => {
    state.connections = [conn(1), conn(2)];
    state.failItems = { "item-1": "ITEM_LOGIN_REQUIRED", "item-2": "ITEM_LOGIN_REQUIRED" };
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.json.errorType).toBe("ITEM_LOGIN_REQUIRED");
  });

  it("one bank needing a new login lists the other and names the one missing", async () => {
    state.connections = [conn(1), conn(2)];
    state.failItems = { "item-2": "ITEM_LOGIN_REQUIRED" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.transactions.map((t: { transactionId: string }) => t.transactionId)).toEqual([
      "food-1",
    ]);
    expect(res.json.connections[1]).toEqual({
      itemId: "item-2",
      institutionName: "Bank 2",
      status: "login_required",
    });
    expect(res.json.period.completeness).toBe("unknown");
  });
});
