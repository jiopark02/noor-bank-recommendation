import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/account/reauth/start and /verify, executed. The real routes, the
 * gate (accountReauthRoute.ts), the real resolveRequestAuth and the decisions
 * run; faked are the supabase module's predicates, the auth server's getUser,
 * the service-role rpc (a small stand-in for the three SQL functions, keyed by
 * the hash it is given) and sendEmail.
 *
 * Mutations and the test each one turns red:
 *   the address or the user id taken from the body                -> T1
 *   a code issued or checked without the service-role key         -> T2
 *   the service-role check moved below authentication             -> T2
 *   a code that verifies with another purpose or another user     -> T3
 *   the code, key, hash, address or bearer token in a log or body -> T4
 *   the session taken from the body, or verify going on without one -> T5
 *   confirmation read from the body, or not read at all            -> T6
 */

const SESSION = "5e1d0c9b-8a7f-4e6d-9c5b-4a3f2e1d0c9b";
const BODY_SESSION = "11111111-2222-4333-8444-555555555555";

function jwtWith(payload: Record<string, unknown>): string {
  const encode = (value: string) =>
    Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode('{"alg":"HS256","typ":"JWT"}')}.${encode(JSON.stringify(payload))}.sentinel-signature-b71e`;
}

/** The auth server is faked and accepts any token; its payload carries the session. */
const BEARER = jwtWith({ sub: "sentinel-sub", session_id: SESSION });
const BEARER_NO_SESSION = jwtWith({ sub: "sentinel-sub" });
const USER_ID = "sentinel-user-id-4c22";
const USER_EMAIL = "sentinel.owner@example.test";
const BODY_EMAIL = "sentinel.attacker@example.test";
const BODY_USER = "sentinel-body-user-9f10";
const SECRET = "sentinel-service-role-secret-77aa-not-a-real-key";

type Row = { purpose: string; hash: string; attempts: number; verified: boolean };

const state = {
  adminConfigured: true,
  emailConfirmedAt: "2026-01-01T00:00:00Z" as string | null,
  getUserCalls: 0,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rows: new Map<string, Row>(),
  emails: [] as Array<{ to: string; subject: string; html: string; text?: string }>,
};

/** The SQL functions' answers, reduced to what these routes depend on. */
async function fakeRpc(fn: string, args: Record<string, unknown>) {
  state.rpcCalls.push({ fn, args });
  const user = String(args.p_user_id);
  if (fn === "account_reauth_issue") {
    state.rows.set(user, {
      purpose: String(args.p_purpose),
      hash: String(args.p_code_hash),
      attempts: 0,
      verified: false,
    });
    return { data: "issued", error: null };
  }
  if (fn === "account_reauth_verify") {
    const row = state.rows.get(user);
    if (!row || row.purpose !== args.p_purpose || row.verified) return { data: "refused", error: null };
    if (row.attempts >= Number(args.p_max_attempts)) return { data: "locked", error: null };
    row.attempts += 1;
    if (row.hash === args.p_code_hash) {
      row.verified = true;
      return { data: "verified", error: null };
    }
    return { data: row.attempts >= Number(args.p_max_attempts) ? "locked" : "refused", error: null };
  }
  return { data: null, error: { code: "XX000" } };
}

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        state.getUserCalls++;
        return {
          data: { user: { id: USER_ID, email: USER_EMAIL, email_confirmed_at: state.emailConfirmedAt } },
          error: null,
        };
      },
    },
  }),
  createAdminClient: () => {
    if (!state.adminConfigured) throw new Error("sentinel: no service role key");
    return { rpc: fakeRpc };
  },
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => state.adminConfigured,
}));

vi.mock("@/lib/email", () => ({
  sendEmail: async (message: { to: string; subject: string; html: string; text?: string }) => {
    state.emails.push(message);
    return true;
  },
}));

async function post(
  path: "start" | "verify",
  body: unknown,
  bearer: string = BEARER
): Promise<{ status: number; json: Record<string, unknown>; text: string; cache: string | null }> {
  const mod =
    path === "start"
      ? await import("../../app/api/account/reauth/start/route")
      : await import("../../app/api/account/reauth/verify/route");
  const res = await mod.POST(
    new Request(`https://noor.test/api/account/reauth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text), text, cache: res.headers.get("cache-control") };
}

function emailedCode(): string {
  const last = state.emails[state.emails.length - 1];
  const match = /code is ([0-9]{6})/.exec(last.text ?? "");
  if (!match) throw new Error("no code in the email");
  return match[1];
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];
const savedEnv = { mode: process.env.ACCOUNT_REAUTH_MODE, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

beforeEach(() => {
  state.adminConfigured = true;
  state.emailConfirmedAt = "2026-01-01T00:00:00Z";
  state.getUserCalls = 0;
  state.rpcCalls = [];
  state.rows = new Map();
  state.emails = [];
  delete process.env.ACCOUNT_REAUTH_MODE;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
  spies.length = 0;
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  if (savedEnv.mode === undefined) delete process.env.ACCOUNT_REAUTH_MODE;
  else process.env.ACCOUNT_REAUTH_MODE = savedEnv.mode;
  if (savedEnv.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedEnv.key;
});

function consoleText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a: unknown) => String(a)).join(" "))
    .join("\n");
}

describe("reauth routes", () => {
  it("T1 the code goes to the token's address and the row to the token's id, whatever the body says", async () => {
    const started = await post("start", { purpose: "delete_account", email: BODY_EMAIL, userId: BODY_USER });
    expect(started.status).toBe(200);
    expect(started.json).toEqual({ status: "sent" });
    expect(started.cache).toBe("private, no-store");
    expect(state.emails.map((e) => e.to)).toEqual([USER_EMAIL]);
    expect(state.rpcCalls.map((c) => c.args.p_user_id)).toEqual([USER_ID]);

    const verified = await post("verify", {
      purpose: "delete_account",
      code: emailedCode(),
      userId: BODY_USER,
    });
    expect(verified.status).toBe(200);
    expect(verified.json).toEqual({ status: "verified" });
    expect(state.rpcCalls.map((c) => c.args.p_user_id)).toEqual([USER_ID, USER_ID]);
  });

  it("T2 without the service-role key both routes answer 503 before authentication, with no rpc and no email", async () => {
    state.adminConfigured = false;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    for (const [path, body] of [
      ["start", { purpose: "export_data" }],
      ["verify", { purpose: "export_data", code: "123456" }],
    ] as const) {
      const res = await post(path, body);
      expect(res.status, path).toBe(503);
      expect(res.json.code, path).toBe("REAUTH_UNAVAILABLE");
    }
    expect(state.getUserCalls).toBe(0);
    expect(state.rpcCalls).toEqual([]);
    expect(state.emails).toEqual([]);
  });

  it("T2 with the predicate passing but no key in the environment, nothing is issued or checked", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "   ";
    const started = await post("start", { purpose: "export_data" });
    expect(started.status).toBe(503);
    const verified = await post("verify", { purpose: "export_data", code: "123456" });
    expect(verified.status).toBe(503);
    expect(state.rpcCalls).toEqual([]);
    expect(state.emails).toEqual([]);
  });

  it("T3 a code verifies only for the purpose it was issued for", async () => {
    await post("start", { purpose: "export_data" });
    const code = emailedCode();
    const wrongPurpose = await post("verify", { purpose: "delete_account", code });
    expect(wrongPurpose.status).toBe(403);
    expect(wrongPurpose.json.code).toBe("REAUTH_CODE_REJECTED");
    const wrongCode = await post("verify", {
      purpose: "export_data",
      code: code === "000000" ? "000001" : "000000",
    });
    expect(wrongCode.status).toBe(403);
    const right = await post("verify", { purpose: "export_data", code });
    expect(right.status).toBe(200);
  });

  it("T5 verify sends the session of the verified token, never one from the body", async () => {
    await post("start", { purpose: "delete_account" });
    const verified = await post("verify", {
      purpose: "delete_account",
      code: emailedCode(),
      sessionId: BODY_SESSION,
      session_id: BODY_SESSION,
    });
    expect(verified.status).toBe(200);
    const verifyCalls = state.rpcCalls.filter((c) => c.fn === "account_reauth_verify");
    expect(verifyCalls.map((c) => c.args.p_session_id)).toEqual([SESSION]);
  });

  it("T5 a token without a session id cannot verify, and no rpc is made", async () => {
    await post("start", { purpose: "delete_account" });
    const code = emailedCode();
    state.rpcCalls = [];
    const res = await post("verify", { purpose: "delete_account", code, sessionId: BODY_SESSION }, BEARER_NO_SESSION);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("REAUTH_SESSION_UNAVAILABLE");
    expect(state.rpcCalls).toEqual([]);
  });

  it("T6 a user whose address is not confirmed gets 409 REAUTH_EMAIL_UNAVAILABLE, no rpc and no email", async () => {
    state.emailConfirmedAt = null;
    const res = await post("start", { purpose: "delete_account", emailConfirmed: true, email_confirmed_at: "2026-01-01T00:00:00Z" });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("REAUTH_EMAIL_UNAVAILABLE");
    expect(state.rpcCalls).toEqual([]);
    expect(state.emails).toEqual([]);
  });

  it("T4 no log line or answer carries the code, the key, the hash, the address or the bearer token", async () => {
    const bodies: string[] = [];
    bodies.push((await post("start", { purpose: "delete_account" })).text);
    const code = emailedCode();
    bodies.push((await post("verify", { purpose: "delete_account", code: "999999" === code ? "111111" : "999999" })).text);
    bodies.push((await post("verify", { purpose: "delete_account", code })).text);
    bodies.push((await post("verify", { purpose: "delete_account", code })).text);
    state.adminConfigured = false;
    bodies.push((await post("start", { purpose: "delete_account" })).text);

    const { deriveReauthCodeKey } = await import("../accountReauth");
    const key = deriveReauthCodeKey(SECRET)!;
    const hashes = state.rpcCalls.map((c) => String(c.args.p_code_hash));
    const all = bodies.join("\n") + "\n" + consoleText();
    for (const secret of [code, key.toString("hex"), key.toString("base64"), SECRET, USER_EMAIL, BEARER, USER_ID, SESSION, ...hashes]) {
      expect(all, secret).not.toContain(secret);
    }
  });
});
