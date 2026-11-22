import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { makeFakeClient, type FakeOptions } from "./householdFakeClient";

/**
 * The /api/household routes, executed. The real routes, householdGate, the
 * real resolveRequestAuth, the decisions and the store run; faked are the
 * supabase module's configuration predicates, the auth server's getUser and
 * the service-role client (householdFakeClient.ts).
 *
 * Mutations and the test each one turns red:
 *   a route's gate call removed, or a route reading the body first  -> T-A1
 *   every refusal answered 503                                       -> T-A1
 *   another route, or a method added or removed under household      -> T-A2
 *   the service-role gate removed or moved below authentication      -> T-A3
 *   an unreachable auth server answered 401                          -> T-A4
 *   the 503 given another code or message, or reaching the store     -> T-A4
 *   the gate's log line removed, or given the request's values       -> T-G3
 *   a body userId or email passed to a call                          -> T-I1
 *   a token, address, name or id added to a log line                 -> T-G1 (routes)
 */

const SENTINEL_BEARER = "sentinel-bearer-token-3c1d";
const USER_ID = "sentinel-user-id-77";
const USER_EMAIL = "sentinel.person@example.test";
const OTHER_ID = "sentinel-other-id-88";
const INVITEE = "sentinel.invitee@example.test";
const TOKEN = "sentinelToken" + "y".repeat(30);
const NAME = "Sentinelname";
const SENTINEL_AUTH_ERROR = "sentinel-auth-error-text-41";

const state = {
  adminConfigured: true,
  user: { id: USER_ID, email: USER_EMAIL, email_confirmed_at: "2026-01-01T00:00:00Z" } as Record<
    string,
    unknown
  > | null,
  getUserCalls: 0,
  adminClientCalls: 0,
  fake: makeFakeClient(),
  /** When set, getUser answers this instead of state.user. */
  authAnswer: null as { data: { user: null }; error: unknown } | "throw" | null,
};

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        state.getUserCalls++;
        if (state.authAnswer === "throw") throw new Error(SENTINEL_AUTH_ERROR);
        if (state.authAnswer !== null) return state.authAnswer;
        return state.user
          ? { data: { user: state.user }, error: null }
          : { data: { user: null }, error: null };
      },
    },
  }),
  createAdminClient: () => {
    state.adminClientCalls++;
    return state.fake.client;
  },
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => state.adminConfigured,
}));

type Call = { method: "GET" | "POST" | "PUT" | "DELETE"; path: string };

const CALLS: Call[] = [
  { method: "GET", path: "" },
  { method: "POST", path: "invite" },
  { method: "DELETE", path: "invite" },
  { method: "POST", path: "invite/preview" },
  { method: "POST", path: "invite/accept" },
  { method: "POST", path: "leave" },
  { method: "GET", path: "sharing" },
  { method: "PUT", path: "sharing" },
  { method: "GET", path: "shared-accounts" },
];

async function handler(call: Call) {
  const mod =
    call.path === ""
      ? await import("../../app/api/household/route")
      : call.path === "invite"
        ? await import("../../app/api/household/invite/route")
        : call.path === "invite/preview"
          ? await import("../../app/api/household/invite/preview/route")
          : call.path === "invite/accept"
            ? await import("../../app/api/household/invite/accept/route")
            : call.path === "sharing"
              ? await import("../../app/api/household/sharing/route")
              : call.path === "shared-accounts"
                ? await import("../../app/api/household/shared-accounts/route")
                : await import("../../app/api/household/leave/route");
  return (mod as Record<string, (req: NextRequest) => Promise<Response>>)[call.method];
}

async function send(
  call: Call,
  body: unknown,
  authorization: string | null = `Bearer ${SENTINEL_BEARER}`
): Promise<{ status: number; json: Record<string, unknown>; cache: string | null }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization !== null) headers.authorization = authorization;
  const init: RequestInit = { method: call.method, headers };
  if (call.method !== "GET" && body !== undefined) init.body = JSON.stringify(body);
  const fn = await handler(call);
  const res = await fn(
    new Request(`https://noor.test/api/household/${call.path}`, init) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json(), cache: res.headers.get("cache-control") };
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

function consoleText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a: unknown) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(" "))
    .join("\n");
}

function setFake(options: FakeOptions): void {
  state.fake = makeFakeClient(options);
}

beforeEach(() => {
  state.adminConfigured = true;
  state.user = { id: USER_ID, email: USER_EMAIL, email_confirmed_at: "2026-01-01T00:00:00Z" };
  state.getUserCalls = 0;
  state.adminClientCalls = 0;
  state.authAnswer = null;
  setFake({});
  process.env.HOUSEHOLD_INVITE_LIMIT_MODE = "off";
  spies.length = 0;
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  delete process.env.HOUSEHOLD_INVITE_LIMIT_MODE;
  vi.restoreAllMocks();
});

describe("the gate on every household route", () => {
  it.each(CALLS)("T-A1 $method /api/household/$path: no or bad token is 401, nothing else runs", async (call) => {
    for (const authorization of [null, "Basic abc", "Bearer ", `Bearer ${SENTINEL_BEARER}`]) {
      if (authorization === `Bearer ${SENTINEL_BEARER}`) state.user = null;
      setFake({});
      const r = await send(call, { token: TOKEN, email: INVITEE }, authorization);
      expect(r.status, String(authorization)).toBe(401);
      expect(r.json).toEqual({ error: "Unauthorized" });
      expect(r.cache).toBe("private, no-store");
      expect(state.fake.rpcCalls).toEqual([]);
      expect(state.fake.queries).toEqual([]);
      expect(state.adminClientCalls).toBe(0);
    }
  });

  it("T-A2 the household routes are exactly these files and methods, and each handler starts at the gate", () => {
    const root = path.resolve(__dirname, "../../app/api/household");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(root);
    const found: string[] = [];
    for (const file of files) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      expect(rel.endsWith("route.ts"), rel).toBe(true);
      const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const re = /export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(request: NextRequest\) \{\n([^\n]*)\n/g;
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = re.exec(source)) !== null) {
        count++;
        found.push(`${m[1]} ${rel.replace(/\/?route\.ts$/, "")}`);
        expect(m[2], `${m[1]} ${rel}`).toBe("  const gate = await householdGate(request);");
      }
      expect(source.match(/export (async )?function /g)?.length ?? 0, rel).toBe(count);
      expect(source).toContain('export const dynamic = "force-dynamic";');
    }
    expect(found.sort()).toEqual(
      CALLS.map((c) => `${c.method} ${c.path}`).sort()
    );
  });

  it.each(CALLS)("T-A3 $method /api/household/$path: without the service-role key it is 503, before any token check", async (call) => {
    state.adminConfigured = false;
    const r = await send(call, { token: TOKEN });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("ADMIN_UNCONFIGURED");
    expect(state.getUserCalls).toBe(0);
    expect(state.adminClientCalls).toBe(0);
  });
});

const UNREACHABLE: Array<[string, { data: { user: null }; error: unknown } | "throw"]> = [
  ["no response", { data: { user: null }, error: new AuthRetryableFetchError(SENTINEL_AUTH_ERROR, 0) }],
  ["a gateway error", { data: { user: null }, error: new AuthRetryableFetchError(SENTINEL_AUTH_ERROR, 503) }],
  ["a 500", { data: { user: null }, error: new AuthApiError(SENTINEL_AUTH_ERROR, 500, undefined) }],
  ["a throw", "throw"],
];

describe("an auth server that gave no usable answer", () => {
  it.each(CALLS)("T-A4 $method /api/household/$path: 503 AUTH_UNAVAILABLE, nothing else runs, token refusals stay 401", async (call) => {
    for (const [label, answer] of UNREACHABLE) {
      state.authAnswer = answer;
      setFake({});
      state.adminClientCalls = 0;
      const r = await send(call, { token: TOKEN, email: INVITEE });
      expect(r.status, label).toBe(503);
      expect(r.json, label).toEqual({
        error: "We couldn't confirm your sign-in right now. Please try again in a moment.",
        code: "AUTH_UNAVAILABLE",
      });
      expect(r.cache, label).toBe("private, no-store");
      expect(state.fake.rpcCalls, label).toEqual([]);
      expect(state.fake.queries, label).toEqual([]);
      expect(state.adminClientCalls, label).toBe(0);
    }
    // A token the auth server answered for and refused is still the caller's 401.
    state.authAnswer = {
      data: { user: null },
      error: new AuthApiError(SENTINEL_AUTH_ERROR, 403, "bad_jwt"),
    };
    const refused = await send(call, { token: TOKEN });
    expect(refused.status).toBe(401);
    expect(refused.json).toEqual({ error: "Unauthorized" });
  });

  it("T-G3 the gate logs one fixed line for an unreachable auth server and nothing from the request", async () => {
    state.authAnswer = "throw";
    await send(CALLS[4], { token: TOKEN, email: INVITEE });
    const text = consoleText();
    expect(text.split("\n").filter((l) => l.includes("[household]"))).toEqual([
      "[household] route=gate outcome=auth_unavailable",
    ]);
    for (const secret of [SENTINEL_BEARER, TOKEN, INVITEE, SENTINEL_AUTH_ERROR, USER_ID]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe("identity from the token only", () => {
  it("T-I1 a userId or email in the body never reaches a call", async () => {
    setFake({
      rpc: {
        household_ensure_for_user: { data: "hh-1", error: null },
        household_invite_create: { data: "created", error: null },
        household_invite_accept: { data: "accepted", error: null },
        household_invite_cancel: { data: "cancelled", error: null },
        household_leave: { data: "left", error: null },
      },
    });
    const forged = { userId: OTHER_ID, user_id: OTHER_ID, p_user_id: OTHER_ID, id: OTHER_ID };
    expect((await send(CALLS[1], { ...forged, email: INVITEE })).status).toBe(201);
    expect((await send(CALLS[2], forged)).status).toBe(200);
    expect((await send(CALLS[4], { ...forged, token: TOKEN, email: "forged@example.test" })).status).toBe(200);
    expect((await send(CALLS[5], forged)).status).toBe(200);
    const calls = state.fake.rpcCalls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [fn, args] of calls) {
      expect(args.p_user_id, fn).toBe(USER_ID);
      expect(JSON.stringify(args), fn).not.toContain(OTHER_ID);
      expect(JSON.stringify(args), fn).not.toContain("forged@");
    }
    const accept = calls.find(([fn]) => fn === "household_invite_accept");
    expect(accept?.[1].p_email).toBe(USER_EMAIL);
  });

  it("a body over the byte limit is 413 and nothing is called", async () => {
    setFake({ rpc: { household_invite_accept: { data: "accepted", error: null } } });
    const r = await send(CALLS[4], { token: TOKEN, pad: "x".repeat(5000) });
    expect(r.status).toBe(413);
    expect(r.json.code).toBe("REQUEST_TOO_LARGE");
    expect(state.fake.rpcCalls).toEqual([]);
  });
});

describe("logs through the routes", () => {
  it("T-G1 (routes) no console line carries the bearer, token, an address, a name or an id", async () => {
    const answers: FakeOptions[] = [
      {},
      {
        rpc: {
          household_ensure_for_user: { data: "hh-1", error: null },
          household_repair_owner: { data: "repaired", error: null },
          household_invites_prune_expired: { data: 0, error: null },
          household_invite_create: { data: "not_owner", error: null },
          household_invite_cancel: { data: "not_owner", error: null },
          household_invite_accept: { data: "refused", error: null },
          household_leave: { data: "solo", error: null },
        },
        tables: {
          household_members: [
            { data: { household_id: "hh-1", role: "owner" }, error: null },
            { data: [{ user_id: USER_ID, role: "owner" }], error: null },
          ],
          users: [{ data: [{ id: USER_ID, first_name: NAME }], error: null }],
          household_invites: [
            { data: { household_id: "hh-1", invited_by: OTHER_ID, invitee_email: USER_EMAIL, expires_at: "2099-01-01T00:00:00Z" }, error: null },
          ],
        },
      },
      {
        rpc: {
          household_ensure_for_user: { data: null, error: { code: "23503", message: USER_EMAIL } },
          household_invite_accept: { data: null, error: { code: "P0001", message: `${USER_ID} ${INVITEE}` } },
          household_leave: "throw",
        },
      },
    ];
    for (const options of answers) {
      for (const call of CALLS) {
        setFake(options);
        await send(call, { token: TOKEN, email: INVITEE });
      }
    }
    state.user = { id: USER_ID, email: USER_EMAIL, email_confirmed_at: null };
    await send(CALLS[4], { token: TOKEN });
    const text = consoleText();
    expect(text).toContain("[household]");
    for (const secret of [SENTINEL_BEARER, TOKEN, USER_EMAIL, INVITEE, "example.test", NAME, USER_ID, OTHER_ID, "hh-1"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe("the view through the route", () => {
  it("T-R1 (route) GET /api/household ensures and repairs for the caller and calls no prune", async () => {
    setFake({
      rpc: {
        household_ensure_for_user: { data: "hh-1", error: null },
        household_repair_owner: { data: "ok", error: null },
        household_invites_prune_expired: { data: 0, error: null },
      },
      tables: {
        household_members: [
          { data: { household_id: "hh-1", role: "owner" }, error: null },
          { data: [{ user_id: USER_ID, role: "owner" }], error: null },
        ],
        users: [{ data: [{ id: USER_ID, first_name: NAME }], error: null }],
        household_invites: [{ data: null, error: null }],
      },
    });
    const r = await send(CALLS[0], undefined);
    expect(r.status).toBe(200);
    expect(state.fake.rpcCalls.map(([fn]) => fn)).toEqual([
      "household_ensure_for_user",
      "household_repair_owner",
    ]);
    for (const [, args] of state.fake.rpcCalls) {
      expect(args).toEqual({ p_user_id: USER_ID });
    }
  });
});
