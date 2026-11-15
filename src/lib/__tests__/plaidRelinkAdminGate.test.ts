import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/plaid/relink, executed: a missing service-role key is answered as
 * a configuration fault before anything else runs.
 *
 * Without the gate the fault surfaces inside authenticate(): verifying the
 * token builds a server client, which throws without the key, and the throw is
 * reported as "no user", so the route answers 401 and blames the caller's
 * session.
 *
 * The real route and the real authenticate() run, as in
 * plaidRelinkLookup.test.ts. Faked: the token verification under
 * authenticate(), the configuration predicates, the row lookup, the decrypt,
 * and the Plaid client's linkTokenCreate. Each fake counts its calls, so "did
 * not run" is observed and not read off the source.
 *
 * Mutations that turn this file red:
 *   - the gate removed                                   -> "answers 503"
 *   - the gate moved below authenticate()                -> "answers 503" (auth count)
 *   - the gate answering 401, or another code or message -> "answers 503"
 *   - the gate inverted                                  -> both
 */

const state = {
  adminConfigured: true,
  authCalls: 0,
  lookupCalls: 0,
  decryptCalls: 0,
  linkTokenCalls: 0,
};

vi.mock("@/lib/apiAuth", () => ({
  // What the real helper does when the key is missing: the server client
  // throws inside it and the helper answers "no user".
  getAuthenticatedUserIdFromRequest: async () => {
    state.authCalls++;
    return state.adminConfigured ? "user-1" : null;
  },
}));

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => {
    throw new Error("server client must not be used in this test");
  },
  createAdminClient: () => {
    throw new Error("admin client must not be used in this test");
  },
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => state.adminConfigured,
}));

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => true,
  plaidClient: {
    async linkTokenCreate() {
      state.linkTokenCalls++;
      return {
        data: { link_token: "link-sandbox-test", expiration: "2026-11-16T00:00:00Z" },
      };
    },
  },
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
  decryptPlaidAccessToken: () => {
    state.decryptCalls++;
    return "access-sandbox-plain";
  },
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  getPlaidConnectionByItemId: async () => {
    state.lookupCalls++;
    return {
      ok: true,
      connection: { item_id: "item-1", access_token: "v1:a:b:c" },
    };
  },
}));

async function post(): Promise<{ status: number; json: any }> {
  const { POST } = await import("../../app/api/plaid/relink/route");
  const res = await POST(
    new Request("https://noor.test/api/plaid/relink", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ itemId: "item-1" }),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  state.adminConfigured = true;
  state.authCalls = 0;
  state.lookupCalls = 0;
  state.decryptCalls = 0;
  state.linkTokenCalls = 0;
});

describe("relink — the service-role key is a precondition", () => {
  it("answers 503 ADMIN_UNCONFIGURED without the key, before authenticating or reading", async () => {
    state.adminConfigured = false;

    const res = await post();

    expect(res.status).toBe(503);
    expect(res.json).toEqual({
      error: "Something went wrong on our end. Please check back in a moment.",
      code: "ADMIN_UNCONFIGURED",
    });
    expect(state.authCalls).toBe(0);
    expect(state.lookupCalls).toBe(0);
    expect(state.decryptCalls).toBe(0);
    expect(state.linkTokenCalls).toBe(0);
  });

  it("lets the request through when the key is there", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(res.json.linkToken).toBe("link-sandbox-test");
    expect(state.authCalls).toBe(1);
    expect(state.lookupCalls).toBe(1);
    expect(state.linkTokenCalls).toBe(1);
  });
});
