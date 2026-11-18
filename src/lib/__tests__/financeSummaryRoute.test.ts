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
 *   - one row failing to decrypt answered 500 for every bank        -> "a row that will not decrypt"
 *   - every row failing to decrypt answered as banks failing        -> "every row failing to decrypt"
 *   - the empty-case wording changed                                -> no active connection
 *   - completeness not taken from the connection statuses           -> partial failure
 *   - a summary computed when no bank was read                      -> nothing read
 *   - the body's timeZone ignored, or today taken twice             -> user's today
 *   - the time zone value written to the log                        -> user's today / fallback
 *   - the list sent for any truthy includeTransactions, or always   -> "only when … exactly true"
 *   - the list read a second time                                   -> "the same Plaid calls …"
 *   - the engine's answer sent as is (input hash and other fields
 *     reaching the browser)                                         -> "returns accounts …"
 *   - an engine refusal answered through the generic error path, or
 *     its message (with the input value in it) logged               -> "the engine refuses …"
 *   - an engine answer missing a screen field sent as a summary     -> "the engine refuses …"
 *   - the app following the engine when every bank's recurring read
 *     was empty (recurring passed on as $0, or safe-to-spend shown
 *     because the engine said it could be)                          -> "the app's own decision"
 *   - an unreadable next step answered as a failed summary          -> "a next step that cannot be read"
 *   - a candidate sent whole, or any part of it beyond its kind
 *     and amount                                                    -> "only its kind and amount"
 *   - the next step, or its amount, written to the log              -> "is not written to the log"
 *   - the next step read from a candidate's place in the list,
 *     not from the picked id                                        -> "the candidate the picked id names"
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
  /** Every input the engine package was called with, in order. */
  engineInputs: [] as Array<Record<string, any>>,
  /** When set, the engine refuses the input with this EngineInputError message. */
  engineRefuses: null as string | null,
  /** When set, the engine answers this instead of computing. */
  engineAnswer: undefined as unknown,
};

// The real engine runs; the wrapper records its input, and can make it refuse
// or answer something else.
vi.mock("@sungwon0162/cf-engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@sungwon0162/cf-engine")>();
  return {
    ...real,
    analyzeCashFlow: (input: Record<string, any>, profile: Record<string, unknown>) => {
      state.engineInputs.push(input);
      if (state.engineRefuses !== null) throw new real.EngineInputError(state.engineRefuses);
      if (state.engineAnswer !== undefined) return state.engineAnswer;
      return real.analyzeCashFlow(input as never, profile as never);
    },
  };
});

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
  state.engineInputs = [];
  state.engineRefuses = null;
  state.engineAnswer = undefined;
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

  it("a row that will not decrypt is that bank failing; the other banks are still answered", async () => {
    state.connections = [conn(1), { ...conn(2), access_token: "not-ciphertext" }];
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.connections).toEqual([
      { itemId: "item-1", institutionName: "Bank 1", status: "ok" },
      { itemId: "item-2", institutionName: "Bank 2", status: "failed" },
    ]);
    expect(res.json.accounts.map((a: { accountId: string }) => a.accountId)).toEqual(["chk-1"]);
    expect(res.json.summary).not.toBeNull();
    // The engine is told the second bank was not read.
    expect(state.engineInputs[0].connections.map((c: { state: string }) => c.state)).toEqual([
      "ok",
      "failed",
    ]);
    expect(res.json.summary.coverage.safeToSpendShowable).toBe(false);
    // itemGet, accountsGet, one transactions page and recurring: the first bank only.
    expect(state.plaidCalls).toBe(4);
    expect(res.text).not.toContain("not-ciphertext");
  });

  it("every row failing to decrypt is a 500 for the whole request, with nothing sent to Plaid", async () => {
    state.connections = [
      { ...conn(1), access_token: "not-ciphertext-1" },
      { ...conn(2), access_token: "not-ciphertext-2" },
    ];
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
    // Only the fields the screens read: nothing else the engine returns (its
    // input hash included) reaches the browser.
    expect(res.text).not.toMatch(/inputHash|schemaVersion|movableAmount|dataIssues/);
    // Nor the parts of the answer the screens do not read: the cash indicator
    // itself (only its total is passed on, under a name of the app's own).
    expect(res.text).not.toMatch(/advice|monthlyFinances|specVersions|provenance|cashBalance\b/);
    expect(Object.keys(res.json.summary).sort()).toEqual(
      [
        "cashBalanceCents",
        "cashFlow",
        "coverage",
        "creditUtilization",
        "nextAction",
        "recurring",
        "safeToSpend",
      ]
    );
    // Safe-to-spend was not computed, so the engine's pick has no amount.
    expect(res.json.summary.nextAction).toEqual({
      reason: "data_incomplete",
      pick: { kind: "fix_connection", amountCents: null },
    });
    // Every bank's recurring read came back empty: recurring charges are
    // unknown, so safe-to-spend is not shown.
    expect(res.json.summary.coverage).toEqual({ safeToSpendShowable: false });
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

  // Red if: the app's decision for an all-empty recurring read is dropped
  // and the summary follows whatever the engine answered.
  it("the app's own decision holds when every bank's recurring read was empty, whatever the engine says", async () => {
    // The engine's real answer to this read, changed in two places only: it
    // now says recurring charges come to $0 and safe-to-spend may be shown.
    await post();
    const real = await vi.importActual<typeof import("@sungwon0162/cf-engine")>(
      "@sungwon0162/cf-engine"
    );
    const answer = JSON.parse(
      JSON.stringify(real.analyzeCashFlow(state.engineInputs[0] as never, {}))
    ) as Record<string, any>;
    answer.coverage.safeToSpendShowable = true;
    answer.recurring = { ...answer.recurring, totalMonthlyCents: 0, items: [] };
    state.engineAnswer = answer;

    const res = await post();
    expect(res.status).toBe(200);
    expect(state.engineInputs[1].connections.map((c: { recurringRead: string }) => c.recurringRead)).toEqual([
      "empty",
    ]);
    expect(res.json.summary.recurring).toEqual({ totalMonthlyCents: null, items: [] });
    expect(res.json.summary.coverage).toEqual({ safeToSpendShowable: false });
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
    // One today for the read window, the cash-flow period and every date the
    // engine works out.
    expect(state.transactionWindows).toEqual([{ start: "2025-10-10", end: "2026-11-10" }]);
    expect(state.engineInputs).toHaveLength(1);
    expect(state.engineInputs[0]).toMatchObject({
      now: "2026-11-11T05:00:00.000Z",
      today: "2026-11-10",
      dateBasis: "user_time_zone",
      readWindow: { start: "2025-10-10", end: "2026-11-10" },
      period: { start: "2026-08-13", end: "2026-11-10" },
    });

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
      state.engineInputs = [];
      (console.log as unknown as { mockClear: () => void }).mockClear();
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(state.transactionWindows).toEqual([{ start: "2025-10-11", end: "2026-11-11" }]);
      expect(state.engineInputs[0]).toMatchObject({
        today: "2026-11-11",
        dateBasis: "utc",
        readWindow: { start: "2025-10-11", end: "2026-11-11" },
      });
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

/*
 * The next step the engine picked. Each case starts from the engine's real
 * answer to the default read and changes only its advice.
 */
describe("POST /api/finance/summary — the next step", () => {
  const UNREADABLE = "[finance-engine] next_action=unreadable";
  const PICKED = { pick: "pay_card:card:acct-SECRET", reason: "best" };

  async function realAnswer(): Promise<Record<string, any>> {
    state.engineAnswer = undefined;
    state.engineInputs = [];
    await post();
    const real = await vi.importActual<typeof import("@sungwon0162/cf-engine")>(
      "@sungwon0162/cf-engine"
    );
    return JSON.parse(
      JSON.stringify(real.analyzeCashFlow(state.engineInputs[0] as never, {}))
    ) as Record<string, any>;
  }

  function candidate(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "pay_card:card:acct-SECRET",
      kind: "pay_card",
      entity: { kind: "obligation", id: "card:acct-SECRET" },
      amountCents: 123457,
      basis: "measured_card_interest",
      valueTier: "surplus",
      comparableCents: 77,
      suppressed: null,
      provenance: { source: "measured_transactions", asOf: null },
      assumptions: ["some_assumption"],
      measuredAprBp: 2399,
      destination: "sav-SECRET",
      ...over,
    };
  }

  function clearLogs(): void {
    for (const method of [console.log, console.warn, console.error]) {
      (method as unknown as { mockClear: () => void }).mockClear();
    }
  }

  function logged(): string[] {
    const lines: string[] = [];
    for (const method of [console.log, console.warn, console.error]) {
      const calls = (method as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      for (const call of calls) lines.push(call.map(String).join(" "));
    }
    return lines;
  }

  it("sends only its kind and amount, with the engine's reason", async () => {
    const answer = await realAnswer();
    answer.advice = { ...answer.advice, ...PICKED, candidates: [candidate()] };
    state.engineAnswer = answer;
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.summary.nextAction).toEqual({
      reason: "best",
      pick: { kind: "pay_card", amountCents: 123457 },
    });
    expect(res.text).not.toMatch(/advice|provenance/);
    expect(res.text).not.toMatch(
      /candidates|policy|basis|valueTier|comparableCents|suppressed|assumptions|entity|measuredAprBp|destination/
    );
    // A candidate's id can carry an account id; neither it nor any other id
    // the candidate names is sent.
    expect(res.text).not.toMatch(/SECRET|pay_card:/);
  });

  // Red if: the candidate is taken by its place in the list instead of by
  // the picked id. Neither candidate is held back, so no other check stands
  // in for this one.
  it("is the candidate the picked id names, wherever it sits among the candidates", async () => {
    const first = candidate({ id: "move_to_emergency:hh", kind: "move_to_emergency", amountCents: 50001 });
    const second = candidate({ id: "pay_card:card:acct-SECRET", kind: "pay_card", amountCents: 123457 });
    expect(first.suppressed).toBeNull();
    expect(second.suppressed).toBeNull();

    const answer = await realAnswer();
    answer.advice = { ...answer.advice, pick: second.id, reason: "best", candidates: [first, second] };
    state.engineAnswer = answer;
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.summary.nextAction).toEqual({
      reason: "best",
      pick: { kind: "pay_card", amountCents: 123457 },
    });

    // The same two the other way round, picking the one that is now last.
    answer.advice = { ...answer.advice, pick: first.id, reason: "best", candidates: [second, first] };
    state.engineAnswer = answer;
    const swapped = await post();
    expect(swapped.json.summary.nextAction).toEqual({
      reason: "best",
      pick: { kind: "move_to_emergency", amountCents: 50001 },
    });
  });

  it("is not written to the log", async () => {
    const answer = await realAnswer();
    answer.advice = { ...answer.advice, ...PICKED, candidates: [candidate()] };
    state.engineAnswer = answer;
    clearLogs();
    const res = await post();
    expect(res.status).toBe(200);
    const text = logged().join("\n");
    expect(text).toContain("[finance-summary] date_basis=");
    expect(text).not.toMatch(/123457|pay_card|SECRET|next_action/);
  });

  it("nothing picked is sent as no pick", async () => {
    const answer = await realAnswer();
    answer.advice = { ...answer.advice, pick: null, reason: "nothing_to_do", candidates: [] };
    state.engineAnswer = answer;
    clearLogs();
    const res = await post();
    expect(res.json.summary.nextAction).toEqual({ reason: "nothing_to_do", pick: null });
    expect(logged().join("\n")).not.toContain(UNREADABLE);
  });

  // Red if: an advice that cannot be read fails the whole summary, or is
  // passed on as it came.
  it("a next step that cannot be read is sent as null, and the figures are sent as they are", async () => {
    const good = await post();
    expect(good.status).toBe(200);
    type Answer = Record<string, any>;
    const broken: Array<[string, (answer: Answer) => void]> = [
      [
        "no advice",
        (a) => {
          delete a.advice;
        },
      ],
      [
        "advice not an object",
        (a) => {
          a.advice = "best";
        },
      ],
      [
        "an unknown reason",
        (a) => {
          a.advice = { ...PICKED, reason: "brand_new_reason", candidates: [candidate()] };
        },
      ],
      [
        "the picked id names no candidate",
        (a) => {
          a.advice = { ...PICKED, candidates: [candidate({ id: "other" })] };
        },
      ],
      [
        "the picked id names two candidates",
        (a) => {
          a.advice = { ...PICKED, candidates: [candidate(), candidate()] };
        },
      ],
      [
        "an unknown kind",
        (a) => {
          a.advice = { ...PICKED, candidates: [candidate({ kind: "brand_new_kind" })] };
        },
      ],
      [
        "an amount that is not whole cents",
        (a) => {
          a.advice = { ...PICKED, candidates: [candidate({ amountCents: 10.5 })] };
        },
      ],
      [
        "an amount that is a string",
        (a) => {
          a.advice = { ...PICKED, candidates: [candidate({ amountCents: "123457" })] };
        },
      ],
      [
        "a picked candidate marked as held back",
        (a) => {
          a.advice = { ...PICKED, candidates: [candidate({ suppressed: "snoozed" })] };
        },
      ],
      [
        "nothing picked under a reason that says something was",
        (a) => {
          a.advice = { pick: null, reason: "best", candidates: [] };
        },
      ],
      [
        "candidates not a list",
        (a) => {
          a.advice = { ...PICKED, candidates: {} };
        },
      ],
    ];
    for (const [name, change] of broken) {
      const answer = await realAnswer();
      change(answer);
      state.engineAnswer = answer;
      clearLogs();
      const res = await post();
      expect(res.status, name).toBe(200);
      expect(res.json.summary.nextAction, name).toBeNull();
      expect({ ...res.json.summary, nextAction: null }, name).toEqual({
        ...good.json.summary,
        nextAction: null,
      });
      const about = logged().filter((line) => line.indexOf("next_action") >= 0);
      expect(about, name).toEqual([UNREADABLE]);
      expect(res.text, name).not.toMatch(/SECRET|123457|brand_new/);
    }
  });
});

describe("POST /api/finance/summary — the engine refuses or answers oddly", () => {
  beforeEach(() => {
    (console.error as unknown as { mockClear: () => void }).mockClear();
  });

  function errorLines(): string[] {
    return (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      c.map((v) => (v instanceof Error ? `<Error ${v.message}>` : String(v))).join(" ")
    );
  }

  it("a refused input is a fixed 500, logged as a code with no value from the input", async () => {
    state.engineRefuses = "date 2026-99-99";
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json).toEqual({
      error: "We couldn't compute your summary right now.",
      errorCode: "ENGINE_INPUT_REJECTED",
    });
    const lines = errorLines();
    expect(lines).toEqual(["[finance-summary] engine_input_error code=date"]);
    expect(res.text).not.toContain("2026-99-99");
  });

  it("a refusal naming a field keeps the field name, never a value", async () => {
    state.engineRefuses = "missing balanceAsOf";
    await post();
    expect(errorLines()).toEqual(["[finance-summary] engine_input_error code=missing_balanceAsOf"]);
  });

  it("a refusal message outside the known list is logged as unknown", async () => {
    state.engineRefuses = "acct 12345 owes 678.90";
    await post();
    expect(errorLines()).toEqual(["[finance-summary] engine_input_error code=unknown"]);
  });

  it("an answer without a field the screens read is a fixed 500, not a partial summary", async () => {
    state.engineAnswer = { dataIssues: [] };
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json.errorCode).toBe("ENGINE_OUTPUT_UNEXPECTED");
    expect(errorLines()).toEqual(["[finance-summary] engine_output_unexpected"]);
  });
});
