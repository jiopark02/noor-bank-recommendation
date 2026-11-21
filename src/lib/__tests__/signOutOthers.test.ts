import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { SESSIONS_UI } from "../accountSessions";

/**
 * POST /api/account/sessions/sign-out-others, executed. The real route, the
 * real resolveRequestAuth and signOutOtherSessions run; faked are the
 * supabase module's predicates, the auth server's getUser and the service-role
 * client's admin sign-out, which records what it was called with. Whether the
 * auth server then keeps the requesting session is checked on a preview
 * deployment, not here.
 *
 * Mutations and the test each one turns red:
 *   the scope changed from others (to global or local)          -> O1
 *   the token taken from the body, or from anything but the header -> O1, O2
 *   the service-role check removed or moved below authentication -> O3
 *   the sign-out called before or without authentication        -> O4
 *   a failed or thrown sign-out answered 200                    -> O5
 *   the token in a log line or an answer                        -> O6
 *   the screen promising an immediate sign-out, or calling the
 *   browser client's signOut for it                             -> O7
 */

const BEARER = "sentinel-bearer-token-5d6a";
const BODY_TOKEN = "sentinel-body-token-0e4f";
const USER_ID = "sentinel-user-id-8c13";

type SignOutAnswer = { data: null; error: unknown } | "throw";

const state = {
  adminConfigured: true,
  userValid: true,
  getUserCalls: 0,
  signOutCalls: [] as Array<{ jwt: string; scope: unknown }>,
  signOutAnswer: { data: null, error: null } as SignOutAnswer,
};

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async (token: string) => {
        state.getUserCalls++;
        if (!state.userValid || token !== BEARER) {
          return { data: { user: null }, error: null };
        }
        return { data: { user: { id: USER_ID, email: "s@example.test" } }, error: null };
      },
    },
  }),
  createAdminClient: () => ({
    auth: {
      admin: {
        signOut: async (jwt: string, scope: unknown) => {
          state.signOutCalls.push({ jwt, scope });
          if (state.signOutAnswer === "throw") throw new Error(`sentinel throw ${jwt}`);
          return state.signOutAnswer;
        },
      },
    },
  }),
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => state.adminConfigured,
}));

async function post(
  authorization: string | null = `Bearer ${BEARER}`
): Promise<{ status: number; json: Record<string, unknown>; text: string; cache: string | null }> {
  const { POST } = await import("../../app/api/account/sessions/sign-out-others/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization !== null) headers.authorization = authorization;
  const res = await POST(
    new Request("https://noor.test/api/account/sessions/sign-out-others", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: BODY_TOKEN, jwt: BODY_TOKEN, scope: "global", userId: "x" }),
    }) as unknown as NextRequest
  );
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text), text, cache: res.headers.get("cache-control") };
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  state.adminConfigured = true;
  state.userValid = true;
  state.getUserCalls = 0;
  state.signOutCalls = [];
  state.signOutAnswer = { data: null, error: null };
  spies.length = 0;
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

function consoleText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a: unknown) => String(a)).join(" "))
    .join("\n");
}

describe("sign out other devices", () => {
  it("O1 signs out with the others scope and the verified header token", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "signed_out_others" });
    expect(res.cache).toBe("private, no-store");
    expect(state.signOutCalls).toEqual([{ jwt: BEARER, scope: "others" }]);
  });

  it("O2 the body's token, scope and user are never used", async () => {
    await post();
    await post(`Bearer   ${BEARER}  `);
    for (const call of state.signOutCalls) {
      expect(call.jwt).toBe(BEARER);
      expect(call.scope).toBe("others");
    }
    expect(state.signOutCalls.length).toBe(2);
    expect(JSON.stringify(state.signOutCalls)).not.toContain(BODY_TOKEN);
  });

  it("O3 without the service-role key: 503 before authentication, no sign-out", async () => {
    state.adminConfigured = false;
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("SESSIONS_UNAVAILABLE");
    expect(state.getUserCalls).toBe(0);
    expect(state.signOutCalls).toEqual([]);
  });

  it("O4 an unauthenticated request is 401 and signs nobody out", async () => {
    for (const header of [null, "Basic abc", "Bearer ", `Bearer ${BODY_TOKEN}`]) {
      const res = await post(header);
      expect(res.status, String(header)).toBe(401);
    }
    state.userValid = false;
    expect((await post()).status).toBe(401);
    expect(state.signOutCalls).toEqual([]);
  });

  it("O5 a failed or thrown sign-out is 502, never a success", async () => {
    for (const answer of [
      { data: null, error: { status: 403, code: "session_not_found", message: BEARER } },
      { data: null, error: new Error(BEARER) },
      "throw",
    ] as SignOutAnswer[]) {
      state.signOutAnswer = answer;
      const res = await post();
      expect(res.status, JSON.stringify(answer)).toBe(502);
      expect(res.json.code).toBe("SIGN_OUT_OTHERS_FAILED");
    }
  });

  it("O6 the token reaches no log line and no answer", async () => {
    const texts: string[] = [];
    texts.push((await post()).text);
    state.signOutAnswer = { data: null, error: { status: 403, code: "bad_jwt", message: BEARER } };
    texts.push((await post()).text);
    state.signOutAnswer = "throw";
    texts.push((await post()).text);
    state.adminConfigured = false;
    texts.push((await post()).text);
    const all = texts.join("\n") + "\n" + consoleText();
    for (const secret of [BEARER, BODY_TOKEN, USER_ID]) {
      expect(all, secret).not.toContain(secret);
    }
    expect(consoleText()).toContain("[account-sessions] route=sign-out-others outcome=failed cause=bad_jwt");
  });
});

describe("settings screen", () => {
  const PAGE = readFileSync(
    fileURLToPath(new URL("../../app/settings/page.tsx", import.meta.url)),
    "utf8"
  ).replace(/\s+/g, " ");

  it("O7 posts to the route with the bearer only, promises no immediate sign-out, and clears nothing local", () => {
    const start = PAGE.indexOf("const handleSignOutOthers = async");
    const end = PAGE.indexOf("const initials", start);
    expect(start).toBeGreaterThan(-1);
    const handler = PAGE.slice(start, end);
    expect(handler).toContain("fetch('/api/account/sessions/sign-out-others', { method: 'POST', headers: buildBearerOnlyHeaders(rawAuth), })");
    expect(handler).not.toMatch(/signOut\(|runSignOut|clearLocal|purgeAll|localStorage|sessionStorage|router\./);
    expect(handler).not.toContain("body:");
    expect(PAGE).toContain("onClick={handleSignOutOthers}");
    for (const words of [SESSIONS_UI.body, SESSIONS_UI.done]) {
      expect(words).toContain("the next time their session refreshes");
      expect(words).not.toMatch(/immediately|right away|now signed out/i);
    }
  });
});
