import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * POST /api/plaid/exchange-token and /api/plaid/create-link-token, executed up
 * to the point a request is authenticated.
 *
 * The real routes, the real authenticateWithCause() and the real
 * resolveRequestAuth() run. Faked: the supabase module (the configuration
 * predicates and the client whose getUser verifies the token), the Plaid
 * client, the connection count, the token-crypto predicate, and
 * exchangeForUser. Each fake counts its calls, so "did not run" is observed.
 *
 * Mutations that turn this file red:
 *   - the service-role gate removed, or moved below the authentication -> "answers 503 ADMIN_UNCONFIGURED"
 *   - the gate answering another status, code or message               -> "answers 503 ADMIN_UNCONFIGURED"
 *   - the gate given a lookup of its own                               -> "answers 503 ADMIN_UNCONFIGURED" (call counts)
 *   - an unreachable auth server answered 401                          -> "an auth server that gave no answer"
 *   - a refused token answered 503                                     -> "every other cause"
 *   - the log line removed, written twice, or given another shape      -> both of the above (exact line)
 *   - a header, token, body value or error text added to the line      -> "nothing from the request"
 *   - the new authentication used by another Plaid route               -> "the other routes"
 */

const SENTINEL_TOKEN = "sentinel-access-token-7f3a";
const SENTINEL_PUBLIC = "public-sentinel-91c2";
const SENTINEL_USER = "sentinel-user-id-55";
const SENTINEL_ERROR = "sentinel-error-text-08";

type GetUserAnswer = { data: { user: unknown }; error: unknown } | "throw";

const state = {
  adminConfigured: true,
  supabaseConfigured: true,
  getUser: { data: { user: { id: "user-1" } }, error: null } as GetUserAnswer,
  serverClientCalls: 0,
  getUserCalls: 0,
  adminClientCalls: 0,
  countCalls: 0,
  plaidCalls: 0,
  exchangeCalls: 0,
};

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => {
    state.serverClientCalls++;
    return {
      auth: {
        getUser: async () => {
          state.getUserCalls++;
          if (state.getUser === "throw") throw new Error(SENTINEL_ERROR);
          return state.getUser;
        },
      },
    };
  },
  createAdminClient: () => {
    state.adminClientCalls++;
    throw new Error("admin client must not be used in this test");
  },
  isSupabaseConfigured: () => state.supabaseConfigured,
  isSupabaseAdminConfigured: () => state.adminConfigured,
}));

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => true,
  plaidClient: {
    async linkTokenCreate() {
      state.plaidCalls++;
      return {
        data: { link_token: "link-sandbox-test", expiration: "2026-11-18T00:00:00Z" },
      };
    },
    async itemPublicTokenExchange() {
      state.plaidCalls++;
      throw new Error("the exchange must not be reached in this test");
    },
  },
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  countPlaidConnections: async () => {
    state.countCalls++;
    return 0;
  },
}));

vi.mock("@/lib/plaidExchange", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidExchange")>()),
  exchangeForUser: async () => {
    state.exchangeCalls++;
    return { kind: "response", status: 200, body: { success: true, itemId: "item-1" } };
  },
}));

type RouteName = "exchange-token" | "create-link-token";
const ROUTES: RouteName[] = ["exchange-token", "create-link-token"];

async function post(
  route: RouteName,
  authorization: string | null = `Bearer ${SENTINEL_TOKEN}`
): Promise<{ status: number; json: any }> {
  const { POST } =
    route === "exchange-token"
      ? await import("../../app/api/plaid/exchange-token/route")
      : await import("../../app/api/plaid/create-link-token/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization !== null) headers.authorization = authorization;
  const res = await POST(
    new Request(`https://noor.test/api/plaid/${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        publicToken: SENTINEL_PUBLIC,
        userId: SENTINEL_USER,
        institutionId: "ins_1",
        institutionName: "Test Bank",
      }),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

/** Every console call so far, one string per call. */
function consoleLines(): string[] {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) =>
      args.map((a: unknown) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(" ")
    );
}

function authLines(): string[] {
  return consoleLines().filter((line) => line.includes("[plaid-auth]"));
}

beforeEach(() => {
  state.adminConfigured = true;
  state.supabaseConfigured = true;
  state.getUser = { data: { user: { id: "user-1" } }, error: null };
  state.serverClientCalls = 0;
  state.getUserCalls = 0;
  state.adminClientCalls = 0;
  state.countCalls = 0;
  state.plaidCalls = 0;
  state.exchangeCalls = 0;
  process.env.PLAID_LINK_TOKEN_LIMIT_MODE = "off";
  delete process.env.PLAID_WEBHOOK_URL;
  spies.length = 0;
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  delete process.env.PLAID_LINK_TOKEN_LIMIT_MODE;
  vi.restoreAllMocks();
});

describe.each(ROUTES)("%s — the service-role key is a precondition", (route) => {
  it("answers 503 ADMIN_UNCONFIGURED without the key, before authenticating or reading", async () => {
    state.adminConfigured = false;

    const res = await post(route);

    expect(res.status).toBe(503);
    // The body /api/plaid/relink sends for the same fault.
    expect(res.json).toEqual({
      error: "Something went wrong on our end. Please check back in a moment.",
      code: "ADMIN_UNCONFIGURED",
    });
    expect(state.serverClientCalls).toBe(0);
    expect(state.getUserCalls).toBe(0);
    expect(state.adminClientCalls).toBe(0);
    expect(state.countCalls).toBe(0);
    expect(state.plaidCalls).toBe(0);
    expect(state.exchangeCalls).toBe(0);
    expect(authLines()).toEqual([]);
  });

  it("lets a verified request through when the key is there, without a refusal line", async () => {
    const res = await post(route);

    expect(res.status).toBe(200);
    expect(state.getUserCalls).toBe(1);
    expect(authLines()).toEqual([]);
  });
});

const UNREACHABLE: Array<[string, GetUserAnswer]> = [
  ["no response", { data: { user: null }, error: new AuthRetryableFetchError(SENTINEL_ERROR, 0) }],
  ["a gateway error", { data: { user: null }, error: new AuthRetryableFetchError(SENTINEL_ERROR, 503) }],
  ["a 500", { data: { user: null }, error: new AuthApiError(SENTINEL_ERROR, 500, undefined) }],
  ["a throw", "throw"],
];

type Refusal = {
  cause: string;
  authorization: string | null;
  arrange: () => void;
};

const REFUSED: Refusal[] = [
  { cause: "no_header", authorization: null, arrange: () => {} },
  { cause: "not_bearer", authorization: `Basic ${SENTINEL_TOKEN}`, arrange: () => {} },
  { cause: "not_bearer", authorization: `bearer ${SENTINEL_TOKEN}`, arrange: () => {} },
  // A real request's header value arrives with its trailing whitespace
  // removed, so the prefix with nothing after it is "Bearer": no longer the
  // prefix. "empty_token" is executed in apiAuth.test.ts, on a header object
  // that does not normalize.
  { cause: "not_bearer", authorization: "Bearer  ", arrange: () => {} },
  {
    cause: "supabase_unconfigured",
    authorization: `Bearer ${SENTINEL_TOKEN}`,
    arrange: () => {
      state.supabaseConfigured = false;
    },
  },
  {
    cause: "token_rejected",
    authorization: `Bearer ${SENTINEL_TOKEN}`,
    arrange: () => {
      state.getUser = {
        data: { user: null },
        error: new AuthApiError(SENTINEL_ERROR, 403, "bad_jwt"),
      };
    },
  },
  {
    cause: "token_rejected",
    authorization: `Bearer ${SENTINEL_TOKEN}`,
    arrange: () => {
      state.getUser = { data: { user: null }, error: null };
    },
  },
];

describe.each(ROUTES)("%s — a request that is not authenticated", (route) => {
  it.each(UNREACHABLE)(
    "an auth server that gave no answer (%s): 503 AUTH_UNAVAILABLE and one fixed line",
    async (_label, answer) => {
      state.getUser = answer;

      const res = await post(route);

      expect(res.status).toBe(503);
      expect(res.json).toEqual({
        error: "We couldn't confirm your sign-in right now. Please try again in a moment.",
        code: "AUTH_UNAVAILABLE",
      });
      expect(authLines()).toEqual([`[plaid-auth] route=${route} refused=auth_unreachable`]);
      expect(state.countCalls).toBe(0);
      expect(state.plaidCalls).toBe(0);
      expect(state.exchangeCalls).toBe(0);
    }
  );

  it("every other cause: 401 Unauthorized and one fixed line naming the cause", async () => {
    for (const { cause, authorization, arrange } of REFUSED) {
      state.supabaseConfigured = true;
      state.getUser = { data: { user: { id: "user-1" } }, error: null };
      for (const spy of spies) spy.mockClear();
      arrange();

      const res = await post(route, authorization);

      expect(res.status, cause).toBe(401);
      expect(res.json, cause).toEqual({ error: "Unauthorized" });
      expect(authLines(), cause).toEqual([`[plaid-auth] route=${route} refused=${cause}`]);
      expect(state.countCalls, cause).toBe(0);
      expect(state.plaidCalls, cause).toBe(0);
      expect(state.exchangeCalls, cause).toBe(0);
    }
  });

  it("nothing from the request, and no error text, reaches a log", async () => {
    const answers: GetUserAnswer[] = UNREACHABLE.map(([, answer]) => answer);
    for (const answer of answers) {
      state.getUser = answer;
      await post(route);
    }
    for (const { authorization, arrange } of REFUSED) {
      state.supabaseConfigured = true;
      state.getUser = { data: { user: { id: "user-1" } }, error: null };
      arrange();
      await post(route, authorization);
    }

    const everything = consoleLines().join("\n");
    expect(everything).toContain("[plaid-auth]");
    for (const secret of [SENTINEL_TOKEN, SENTINEL_PUBLIC, SENTINEL_USER, SENTINEL_ERROR]) {
      expect(everything, secret).not.toContain(secret);
    }
    expect(everything).not.toMatch(/Bearer|Basic|ins_1|Test Bank/);
  });
});

/** Comments removed, so assertions are about code and not about prose. */
function code(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the other routes keep the authentication they had", () => {
  // Source probe: these routes cannot all be executed from here. What each
  // answers is held by its own tests, which run unchanged.
  it.each([
    "../../app/api/plaid/relink/route.ts",
    "../../app/api/plaid/disconnect/route.ts",
    "../../app/api/plaid/connections/route.ts",
    "../../app/api/finance/summary/route.ts",
  ])("%s does not use the cause-reporting authentication", (path) => {
    const source = code(path);
    expect(source).not.toContain("authenticateWithCause");
    expect(source).not.toContain("plaidAuthRefusal");
    expect(source).not.toContain("resolveRequestAuth");
    expect(source).not.toContain("AUTH_UNAVAILABLE");
  });

  it("authenticate() still asks the id helper, and only the two routes log a refusal", () => {
    const utils = code("../plaidApiUtils.ts");
    const start = utils.indexOf("export async function authenticate(");
    const end = utils.indexOf("export type PlaidAuthResult", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const authenticate = utils.slice(start, end);
    expect(authenticate).toContain("await getAuthenticatedUserIdFromRequest(request)");
    expect(authenticate).not.toContain("resolveRequestAuth");
    expect(utils.split("[plaid-auth]").length - 1).toBe(1);
  });
});
