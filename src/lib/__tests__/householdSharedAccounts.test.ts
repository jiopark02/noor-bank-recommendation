import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * GET /api/household/shared-accounts, executed. The real route, householdGate,
 * resolveRequestAuth, the decisions, the store, readBankData and
 * liveAdapterDeps run. Faked are the supabase module (the auth server's
 * getUser and the service-role client), the Plaid client and the token
 * decrypt. The fake decrypt succeeds only with the id a token was stored
 * under, as the real one does, so a read made with any other id fails.
 * readBankData is wrapped, not replaced, so each call's id and rows are seen.
 *
 * Mutations and the test each one turns red:
 *   a read made with the caller's id instead of the owner's          -> S1
 *   every owner's rows passed to one read                             -> S2
 *   a connection that failed to read given accounts with amounts     -> S3
 *   an owner's failed read not caught                                 -> S4
 *   the second call of the function not used to drop connections     -> S5
 *   an account name, a mask, an amount, a bank, a name or an id
 *     added to a log line                                             -> S6
 *   an id taken from the request instead of the verified token       -> S7
 *   a write or another table read added to the route                 -> S8
 *   the off switch removed, or read with trimming or case folding    -> S9
 *   an owner id, connection id, item id, account id or token added
 *     to the answer                                                   -> S10
 */

const SENTINEL_BEARER = "sentinel-bearer-token-5e2a";
const USER_ID = "sentinel-caller-id-31";
const OWNER_A = "sentinel-owner-a-id-42";
const OWNER_B = "sentinel-owner-b-id-53";
const BANK_A = "Sentinelbank Alpha";
const BANK_B = "Sentinelbank Beta";
const NAME_A = "Sentinelalice";
const NAME_B = "Sentinelbob";
const ACCOUNT_NAME = "Sentinel Everyday Checking";
const MASK = "8642";
const CURRENT_DOLLARS = 4321.57;
const AVAILABLE_DOLLARS = 4310.09;

type Conn = { owner: string; id: number; item: string; bank: string };

const A1: Conn = { owner: OWNER_A, id: 9007001, item: "sentinel-item-a1-x7", bank: BANK_A };
const A2: Conn = { owner: OWNER_A, id: 9007002, item: "sentinel-item-a2-x8", bank: BANK_A };
const B1: Conn = { owner: OWNER_B, id: 9007003, item: "sentinel-item-b1-x9", bank: BANK_B };

function stored(c: Conn): string {
  return `sentinel-cipher|${c.owner}|${c.item}`;
}
function plaintext(item: string): string {
  return `sentinel-plain|${item}`;
}
function accountId(item: string): string {
  return `sentinel-account-${item}`;
}

function fnRow(c: Conn, token = stored(c)) {
  return {
    owner_user_id: c.owner,
    connection_id: String(c.id),
    item_id: c.item,
    access_token: token,
    institution_name: c.bank,
  };
}

type Answer = { data: unknown; error: unknown };

const state = {
  user: { id: USER_ID, email: "sentinel@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" },
  plaidConfigured: true,
  /** One answer per call of the function, in order; the last one repeats. */
  rpcAnswers: [] as Answer[],
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  usersAnswer: { data: [], error: null } as Answer,
  queries: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  decryptCalls: [] as Array<{ stored: string; userId: string }>,
  readCalls: [] as Array<{ userId: string; items: string[] }>,
  accountsGetCalls: 0,
  /** Items whose accounts read fails with ITEM_LOGIN_REQUIRED. */
  loginRequired: new Set<string>(),
};

function fakeClient() {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push([fn, args]);
      const i = Math.min(state.rpcCalls.filter(([f]) => f === fn).length - 1, state.rpcAnswers.length - 1);
      return Promise.resolve(
        fn === "household_shared_connections" && i >= 0
          ? state.rpcAnswers[i]
          : { data: null, error: { code: "PGRST202" } }
      );
    },
    from(table: string) {
      const record = { table, ops: [] as Array<[string, unknown[]]> };
      state.queries.push(record);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order", "maybeSingle", "insert", "update", "upsert", "delete"]) {
        builder[method] = (...args: unknown[]) => {
          record.ops.push([method, args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: Answer) => unknown) =>
        Promise.resolve(table === "users" ? state.usersAnswer : { data: null, error: null }).then(resolve);
      return builder;
    },
  };
}

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
  }),
  createAdminClient: () => fakeClient(),
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => true,
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
  decryptPlaidAccessToken: (storedToken: string, userId: string) => {
    state.decryptCalls.push({ stored: storedToken, userId });
    const [prefix, owner, item] = storedToken.split("|");
    if (prefix !== "sentinel-cipher" || owner !== userId) {
      throw new Error("sentinel-decrypt-failure-text");
    }
    return plaintext(item);
  },
}));

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => state.plaidConfigured,
  plaidClient: {
    async accountsGet(request: { access_token: string }) {
      state.accountsGetCalls += 1;
      const item = request.access_token.split("|")[1];
      if (state.loginRequired.has(item)) {
        throw Object.assign(new Error("sentinel-plaid-error-text"), {
          response: { status: 400, data: { error_code: "ITEM_LOGIN_REQUIRED" } },
        });
      }
      return {
        data: {
          accounts: [
            {
              account_id: accountId(item),
              name: ACCOUNT_NAME,
              official_name: null,
              mask: MASK,
              type: "depository",
              subtype: "checking",
              balances: {
                current: CURRENT_DOLLARS,
                available: AVAILABLE_DOLLARS,
                limit: null,
                iso_currency_code: "USD",
              },
            },
          ],
        },
      };
    },
    async itemGet() {
      throw new Error("itemGet must not be called");
    },
    async transactionsGet() {
      throw new Error("transactionsGet must not be called");
    },
    async transactionsRecurringGet() {
      throw new Error("transactionsRecurringGet must not be called");
    },
  },
}));

vi.mock("@/lib/plaidEngineAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plaidEngineAdapter")>();
  return {
    ...real,
    readBankData: (...args: Parameters<typeof real.readBankData>) => {
      state.readCalls.push({ userId: args[0], items: args[1].map((r) => r.item_id) });
      return real.readBankData(...args);
    },
  };
});

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

function consoleText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a: unknown) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(" "))
    .join("\n");
}

async function send(url = "https://noor.test/api/household/shared-accounts") {
  const { GET } = await import("../../app/api/household/shared-accounts/route");
  const res = await GET(
    new Request(url, {
      method: "GET",
      headers: { authorization: `Bearer ${SENTINEL_BEARER}` },
    }) as unknown as NextRequest
  );
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, any> };
}

function account() {
  return {
    name: ACCOUNT_NAME,
    mask: MASK,
    type: "depository",
    subtype: "checking",
    currentCents: Math.round(CURRENT_DOLLARS * 100),
    availableCents: Math.round(AVAILABLE_DOLLARS * 100),
  };
}

function names() {
  return {
    data: [
      { id: OWNER_A, first_name: NAME_A },
      { id: OWNER_B, first_name: NAME_B },
    ],
    error: null,
  };
}

beforeEach(() => {
  state.plaidConfigured = true;
  state.rpcAnswers = [{ data: [fnRow(A1), fnRow(A2), fnRow(B1)], error: null }];
  state.rpcCalls = [];
  state.usersAnswer = names();
  state.queries = [];
  state.decryptCalls = [];
  state.readCalls = [];
  state.accountsGetCalls = 0;
  state.loginRequired = new Set();
  delete process.env.HOUSEHOLD_SHARED_ACCOUNTS_MODE;
  spies.length = 0;
  for (const method of ["error", "warn", "info", "log", "debug"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  delete process.env.HOUSEHOLD_SHARED_ACCOUNTS_MODE;
  vi.restoreAllMocks();
});

describe("GET /api/household/shared-accounts", () => {
  it("S1 each stored token is decrypted with its own owner's id, never the caller's", async () => {
    const r = await send();
    expect(r.status).toBe(200);
    expect(state.decryptCalls.length).toBe(3);
    for (const call of state.decryptCalls) {
      expect(call.stored.split("|")[1], call.stored).toBe(call.userId);
      expect(call.userId).not.toBe(USER_ID);
    }
    const readable = (r.json.sharedAccounts.owners as any[]).flatMap((o) =>
      (o.connections as any[]).map((c) => c.readable)
    );
    expect(readable).toEqual([true, true, true]);
  });

  it("S2 one read per owner, with only that owner's rows", async () => {
    await send();
    expect(state.readCalls).toEqual([
      { userId: OWNER_A, items: [A1.item, A2.item] },
      { userId: OWNER_B, items: [B1.item] },
    ]);
  });

  it("S3 a connection that could not be read answers unreadable with no accounts, never an amount of zero", async () => {
    state.loginRequired = new Set([A2.item]);
    const r = await send();
    expect(r.status).toBe(200);
    expect(r.json.sharedAccounts.owners[0]).toEqual({
      firstName: NAME_A,
      connections: [
        { institutionName: BANK_A, readable: true, accounts: [account()] },
        { institutionName: BANK_A, readable: false, accounts: [] },
      ],
    });
    expect(r.text).not.toMatch(/"(currentCents|availableCents)":0\b/);
  });

  it("S4 an owner whose every token fails to decrypt answers that owner unreadable; the others are still read", async () => {
    state.rpcAnswers = [
      { data: [fnRow(A1), fnRow(A2), fnRow(B1, "sentinel-cipher|someone-else|" + B1.item)], error: null },
    ];
    const r = await send();
    expect(r.status).toBe(200);
    expect(r.json.sharedAccounts.owners).toEqual([
      {
        firstName: NAME_A,
        connections: [
          { institutionName: BANK_A, readable: true, accounts: [account()] },
          { institutionName: BANK_A, readable: true, accounts: [account()] },
        ],
      },
      {
        firstName: NAME_B,
        connections: [{ institutionName: BANK_B, readable: false, accounts: [] }],
      },
    ]);
    expect(r.text).not.toMatch(/"(currentCents|availableCents)":0\b/);
  });

  it("S5 a connection the function no longer returns after the reads is left out of the answer", async () => {
    state.rpcAnswers = [
      { data: [fnRow(A1), fnRow(A2), fnRow(B1)], error: null },
      { data: [fnRow(A1)], error: null },
    ];
    const r = await send();
    expect(state.rpcCalls.length).toBe(2);
    expect(r.json.sharedAccounts.owners).toEqual([
      {
        firstName: NAME_A,
        connections: [{ institutionName: BANK_A, readable: true, accounts: [account()] }],
      },
    ]);
    // The owner left out is not asked about.
    const usersRead = state.queries.find((q) => q.table === "users");
    expect(usersRead?.ops).toContainEqual(["in", ["id", [OWNER_A]]]);
  });

  it("S5 a failed second call answers 500, never the first call's list", async () => {
    state.rpcAnswers = [
      { data: [fnRow(A1)], error: null },
      { data: null, error: { code: "XX000" } },
    ];
    const r = await send();
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: expect.any(String), code: "SERVER_ERROR" });
    expect(consoleText()).toContain("[household] route=shared-accounts outcome=recheck_failed code=XX000");
  });

  it("S6 no console line carries an amount, an account name, a mask, a bank, a name, an id or a token", async () => {
    state.loginRequired = new Set([A2.item]);
    state.rpcAnswers = [
      { data: [fnRow(A1), fnRow(A2), fnRow(B1, "sentinel-cipher|someone-else|" + B1.item)], error: null },
    ];
    const r = await send();
    expect(r.status).toBe(200);
    const text = consoleText();
    expect(text).toContain("[household] route=shared-accounts outcome=read owners=2 connections=3 unreadable=2 dropped=0");
    expect(text).toContain("origin=household-shared");
    const secrets = [
      SENTINEL_BEARER, USER_ID, OWNER_A, OWNER_B, BANK_A, BANK_B, NAME_A, NAME_B, ACCOUNT_NAME, MASK,
      String(CURRENT_DOLLARS), String(AVAILABLE_DOLLARS),
      String(Math.round(CURRENT_DOLLARS * 100)), String(Math.round(AVAILABLE_DOLLARS * 100)),
      "sentinel-cipher", "sentinel-plain", "sentinel-decrypt-failure-text", "sentinel-plaid-error-text",
    ];
    for (const c of [A1, A2, B1]) secrets.push(c.item, String(c.id), accountId(c.item));
    for (const secret of secrets) expect(text, secret).not.toContain(secret);
  });

  it("S7 the function is called with the verified caller's id only; a userId in the request is ignored", async () => {
    await send(`https://noor.test/api/household/shared-accounts?userId=${OWNER_A}`);
    expect(state.rpcCalls).toEqual([
      ["household_shared_connections", { p_user_id: USER_ID }],
      ["household_shared_connections", { p_user_id: USER_ID }],
    ]);
  });

  it("S8 nothing is written: two calls of the read function and one read of first names, nothing else", async () => {
    await send();
    expect(state.rpcCalls.map(([fn]) => fn)).toEqual([
      "household_shared_connections",
      "household_shared_connections",
    ]);
    expect(state.queries).toEqual([
      { table: "users", ops: [["select", ["id, first_name"]], ["in", ["id", [OWNER_A, OWNER_B]]]] },
    ]);
  });

  it("S9 exactly \"off\" answers an empty list with nothing read; any other value reads", async () => {
    process.env.HOUSEHOLD_SHARED_ACCOUNTS_MODE = "off";
    const off = await send();
    expect(off.status).toBe(200);
    expect(off.json).toEqual({ sharedAccounts: { owners: [] } });
    expect(state.rpcCalls).toEqual([]);
    expect(state.queries).toEqual([]);
    expect(state.accountsGetCalls).toBe(0);

    for (const value of ["Off", " off", "OFF", "false", "0"]) {
      state.rpcCalls = [];
      process.env.HOUSEHOLD_SHARED_ACCOUNTS_MODE = value;
      const on = await send();
      expect(on.json.sharedAccounts.owners.length, value).toBe(2);
      expect(state.rpcCalls.length, value).toBe(2);
    }
  });

  it("S10 the answer carries no owner id, connection id, item id, account id or token, and only the listed fields", async () => {
    const r = await send();
    const forbidden = [USER_ID, OWNER_A, OWNER_B, "sentinel-cipher", "sentinel-plain"];
    for (const c of [A1, A2, B1]) forbidden.push(c.item, String(c.id), accountId(c.item));
    for (const value of forbidden) expect(r.text, value).not.toContain(value);
    expect(Object.keys(r.json)).toEqual(["sharedAccounts"]);
    expect(Object.keys(r.json.sharedAccounts)).toEqual(["owners"]);
    for (const owner of r.json.sharedAccounts.owners) {
      expect(Object.keys(owner).sort()).toEqual(["connections", "firstName"]);
      for (const c of owner.connections) {
        expect(Object.keys(c).sort()).toEqual(["accounts", "institutionName", "readable"]);
        for (const a of c.accounts) {
          expect(Object.keys(a).sort()).toEqual(
            ["availableCents", "currentCents", "mask", "name", "subtype", "type"]
          );
        }
      }
    }
  });

  it("a failed first call answers 500, never an empty list", async () => {
    state.rpcAnswers = [{ data: null, error: { code: "42883" } }];
    const r = await send();
    expect(r.status).toBe(500);
    expect(r.json.code).toBe("SERVER_ERROR");
    expect(consoleText()).toContain("[household] route=shared-accounts outcome=read_failed code=42883");
    expect(state.accountsGetCalls).toBe(0);
  });

  it("no shared connection answers an empty list with no bank read", async () => {
    state.rpcAnswers = [{ data: [], error: null }];
    const r = await send();
    expect(r.json).toEqual({ sharedAccounts: { owners: [] } });
    expect(state.rpcCalls.length).toBe(1);
    expect(state.accountsGetCalls).toBe(0);
    expect(state.decryptCalls).toEqual([]);
  });

  it("without Plaid configured, every connection is unreadable and nothing is decrypted or sent", async () => {
    state.plaidConfigured = false;
    const r = await send();
    expect(r.status).toBe(200);
    const readable = (r.json.sharedAccounts.owners as any[]).flatMap((o) =>
      (o.connections as any[]).map((c) => c.readable)
    );
    expect(readable).toEqual([false, false, false]);
    expect(state.decryptCalls).toEqual([]);
    expect(state.accountsGetCalls).toBe(0);
  });

  it("a malformed row from the function answers 500", async () => {
    state.rpcAnswers = [{ data: [{ ...fnRow(A1), connection_id: "not-an-id" }], error: null }];
    const r = await send();
    expect(r.status).toBe(500);
    expect(state.accountsGetCalls).toBe(0);
  });

  it("first names that cannot be read leave the list answered, each owner without a name", async () => {
    state.usersAnswer = { data: null, error: { code: "57014" } };
    const r = await send();
    expect(r.status).toBe(200);
    expect((r.json.sharedAccounts.owners as any[]).map((o) => o.firstName)).toEqual([null, null]);
    expect(consoleText()).toContain("[household] route=shared-accounts outcome=names_failed code=57014");
  });
});
