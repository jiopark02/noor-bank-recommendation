import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/account/delete and GET /api/account/export, executed for their
 * reauthentication gate only. The real routes, the real resolveRequestAuth and
 * the real requireRecentReauth run; faked are the supabase module (getUser and
 * a service-role rpc answering account_reauth_check), deleteAccountForUser and
 * buildAccountExport, which stand for "the action ran". What the deletion and
 * the export do is tested in accountDeletion.test.ts and accountExport.test.ts.
 *
 * Mutations and the test each one turns red:
 *   the gate call removed from a route                          -> G1
 *   the gate moved after the deletion or the export             -> G1
 *   a check that cannot be made treated as a pass               -> G2
 *   a mode other than exactly "off" skipping the gate           -> G3
 *   the gate given another purpose, or the export not used up   -> G4
 *   the gate given an id from anywhere but the token            -> G4
 *   the gate given no session, or a session not from the token  -> G4
 *   a token without a session passing the gate                  -> G5
 */

const SESSION = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

function jwtWith(payload: Record<string, unknown>): string {
  const encode = (value: string) =>
    Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode('{"alg":"HS256","typ":"JWT"}')}.${encode(JSON.stringify(payload))}.sentinel-signature-c3d0`;
}

/** The auth server is faked and accepts any token; its payload carries the session. */
const BEARER = jwtWith({ sub: "sentinel-sub", session_id: SESSION });
const BEARER_NO_SESSION = jwtWith({ sub: "sentinel-sub" });
const USER_ID = "sentinel-user-id-2b8e";

type CheckAnswer = { data: unknown; error: unknown } | "throw";

const state = {
  checkAnswer: { data: false, error: null } as CheckAnswer,
  checkCalls: [] as Array<Record<string, unknown>>,
  deletions: [] as string[],
  exports: [] as string[],
};

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID, email: "sentinel@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      }),
    },
  }),
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "account_reauth_check") return { data: null, error: { code: "XX000" } };
      state.checkCalls.push(args);
      if (state.checkAnswer === "throw") throw new Error("sentinel rpc throw");
      return state.checkAnswer;
    },
  }),
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => true,
}));

vi.mock("@/lib/accountDeletion", () => ({
  deleteAccountForUser: async (userId: string) => {
    state.deletions.push(userId);
    return { status: 200, body: { success: true } };
  },
}));

vi.mock("@/lib/accountExport", () => ({
  buildAccountExport: async (identity: { id: string }) => {
    state.exports.push(identity.id);
    return { status: 200, body: { user_id: identity.id } };
  },
  makeSupabasePageReader: () => async () => ({ data: [], error: null }),
}));

async function callDelete(bearer: string = BEARER): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import("../../app/api/account/delete/route");
  const res = await POST(
    new Request("https://noor.test/api/account/delete", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: "sentinel-body-user" }),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

async function callExport(bearer: string = BEARER): Promise<{ status: number; json: Record<string, unknown> }> {
  const { GET } = await import("../../app/api/account/export/route");
  const res = await GET(
    new Request("https://noor.test/api/account/export", {
      method: "GET",
      headers: { authorization: `Bearer ${bearer}` },
    }) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

const savedMode = process.env.ACCOUNT_REAUTH_MODE;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  state.checkAnswer = { data: false, error: null };
  state.checkCalls = [];
  state.deletions = [];
  state.exports = [];
  delete process.env.ACCOUNT_REAUTH_MODE;
  spies.length = 0;
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  if (savedMode === undefined) delete process.env.ACCOUNT_REAUTH_MODE;
  else process.env.ACCOUNT_REAUTH_MODE = savedMode;
});

describe("account action reauthentication gate", () => {
  it("G1 without a recent verification neither route acts, and each answers 403 REAUTH_REQUIRED", async () => {
    const deleted = await callDelete();
    expect(deleted.status).toBe(403);
    expect(deleted.json.code).toBe("REAUTH_REQUIRED");
    const exported = await callExport();
    expect(exported.status).toBe(403);
    expect(exported.json.code).toBe("REAUTH_REQUIRED");
    expect(state.deletions).toEqual([]);
    expect(state.exports).toEqual([]);
    expect(state.checkCalls.length).toBe(2);
  });

  it("G1 with a recent verification both routes act", async () => {
    state.checkAnswer = { data: true, error: null };
    expect((await callDelete()).status).toBe(200);
    expect((await callExport()).status).toBe(200);
    expect(state.deletions).toEqual([USER_ID]);
    expect(state.exports).toEqual([USER_ID]);
  });

  it("G2 a check that cannot be made refuses with 503 and the action does not run", async () => {
    const answers: CheckAnswer[] = [
      { data: null, error: { code: "PGRST202" } },
      "throw",
      { data: "true", error: null },
    ];
    for (const answer of answers) {
      state.checkAnswer = answer;
      const deleted = await callDelete();
      const exported = await callExport();
      expect(deleted.status, JSON.stringify(answer)).toBe(503);
      expect(deleted.json.code).toBe("REAUTH_CHECK_UNAVAILABLE");
      expect(exported.status, JSON.stringify(answer)).toBe(503);
      expect(exported.json.code).toBe("REAUTH_CHECK_UNAVAILABLE");
    }
    expect(state.deletions).toEqual([]);
    expect(state.exports).toEqual([]);
  });

  it("G3 ACCOUNT_REAUTH_MODE: only exactly off lets an unverified request through", async () => {
    const values: Array<string | undefined> = [undefined, "", "off", "OFF", " off", "on", "anything"];
    for (const value of values) {
      if (value === undefined) delete process.env.ACCOUNT_REAUTH_MODE;
      else process.env.ACCOUNT_REAUTH_MODE = value;
      state.deletions = [];
      state.exports = [];
      state.checkCalls = [];
      const deleted = await callDelete();
      const exported = await callExport();
      const label = JSON.stringify(value);
      if (value === "off") {
        expect(deleted.status, label).toBe(200);
        expect(exported.status, label).toBe(200);
        expect(state.deletions, label).toEqual([USER_ID]);
        expect(state.exports, label).toEqual([USER_ID]);
        expect(state.checkCalls, label).toEqual([]);
      } else {
        expect(deleted.status, label).toBe(403);
        expect(exported.status, label).toBe(403);
        expect(state.deletions, label).toEqual([]);
        expect(state.exports, label).toEqual([]);
        expect(state.checkCalls.length, label).toBe(2);
      }
    }
  });

  it("G4 each route asks for its own purpose with the token's id; only the export uses the verification up", async () => {
    state.checkAnswer = { data: true, error: null };
    await callDelete();
    await callExport();
    expect(state.checkCalls).toEqual([
      { p_user_id: USER_ID, p_purpose: "delete_account", p_session_id: SESSION, p_window_seconds: 600, p_consume: false },
      { p_user_id: USER_ID, p_purpose: "export_data", p_session_id: SESSION, p_window_seconds: 600, p_consume: true },
    ]);
  });

  it("G5 a token without a session id: 403 REAUTH_SESSION_UNAVAILABLE, no check, no action, unless the mode is off", async () => {
    state.checkAnswer = { data: true, error: null };
    const deleted = await callDelete(BEARER_NO_SESSION);
    const exported = await callExport(BEARER_NO_SESSION);
    for (const res of [deleted, exported]) {
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("REAUTH_SESSION_UNAVAILABLE");
    }
    expect(state.checkCalls).toEqual([]);
    expect(state.deletions).toEqual([]);
    expect(state.exports).toEqual([]);

    process.env.ACCOUNT_REAUTH_MODE = "off";
    expect((await callDelete(BEARER_NO_SESSION)).status).toBe(200);
    expect(state.deletions).toEqual([USER_ID]);
  });
});
