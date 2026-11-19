import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { classifyRelinkResponse } from "../plaidRelinkFlow";

/**
 * POST /api/plaid/relink, executed: the body each failure is answered with,
 * and the notice the browser makes of that body.
 *
 * The real route, the real authenticate() and the real Plaid error mapping
 * run. Faked: the token verification under authenticate(), the configuration
 * predicates, the row lookup, the decrypt, and the Plaid client's
 * linkTokenCreate. Each answer is handed, as it came, to the classifier the
 * browser uses, so the two cannot drift apart unseen.
 *
 * Which code and status Plaid really sends for a token it refuses on this call
 * is a live check. Both codes the browser reads as a refused token are
 * injected here.
 *
 * Mutations that turn this file red:
 *   - the route's own 401 given a Plaid mark, or Plaid's 401
 *     sent without its code                                    -> "two different 401s"
 *   - ITEM_NOT_FOUND no longer read as a refused token         -> "ITEM_NOT_FOUND"
 *   - a failed read or a failed decrypt answered as an absent
 *     row, or as a refused token                               -> "a failed read", "a failed decrypt"
 *   - Plaid asked for a link token after a failed decrypt      -> "a failed decrypt"
 */

type Lookup = { ok: true; connection: unknown } | { ok: false };

const ROW = { item_id: "item-1", access_token: "v1:stored:cipher:text" };

const state = {
  userId: "user-1" as string | null,
  lookup: { ok: true, connection: ROW } as Lookup,
  decryptFails: false,
  plaidRejection: null as unknown,
  linkTokenCalls: 0,
};

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
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => true,
}));

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => true,
  plaidClient: {
    async linkTokenCreate() {
      state.linkTokenCalls++;
      if (state.plaidRejection) throw state.plaidRejection;
      return {
        data: { link_token: "link-sandbox-test", expiration: "2026-11-16T00:00:00Z" },
      };
    },
  },
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("../plaidTokenCrypto")>();
  return {
    ...original,
    isPlaidTokenCryptoConfigured: () => true,
    decryptPlaidAccessToken: () => {
      if (state.decryptFails) {
        throw new original.PlaidTokenCryptoError("auth_failed", "decrypt failed");
      }
      return "access-sandbox-plain";
    },
  };
});

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  getPlaidConnectionByItemId: async () => state.lookup,
}));

/** An error as the Plaid client rejects with: the code is in the response body. */
function plaidRejection(status: number, errorCode: string, errorType: string): unknown {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error_code: errorCode, error_type: errorType } },
  });
}

async function post(): Promise<{ status: number; json: Record<string, unknown> }> {
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
  state.userId = "user-1";
  state.lookup = { ok: true, connection: ROW };
  state.decryptFails = false;
  state.plaidRejection = null;
  state.linkTokenCalls = 0;
  // The route logs each failure it answers; the lines are not under test.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("relink — two different 401s", () => {
  it("a request that is not authenticated: a 401 with no Plaid mark, read as the session's", async () => {
    state.userId = null;
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Unauthorized" });
    expect(classifyRelinkResponse(res.status, res.json)).toBe("session_ended");
    expect(state.linkTokenCalls).toBe(0);
  });

  it("Plaid refusing the stored token: a 401 carrying its code, read as the token's", async () => {
    state.plaidRejection = plaidRejection(400, "INVALID_ACCESS_TOKEN", "INVALID_INPUT");
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.json.errorCode).toBe("INVALID_ACCESS_TOKEN");
    expect(typeof res.json.errorType).toBe("string");
    expect(classifyRelinkResponse(res.status, res.json)).toBe("token_refused");
  });
});

describe("relink — ITEM_NOT_FOUND", () => {
  it("goes out with its code under Plaid's own status, and is read as the token's refusal", async () => {
    state.plaidRejection = plaidRejection(400, "ITEM_NOT_FOUND", "ITEM_ERROR");
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.json.errorCode).toBe("ITEM_NOT_FOUND");
    expect(classifyRelinkResponse(res.status, res.json)).toBe("token_refused");
  });

  it("is read the same under another status", async () => {
    state.plaidRejection = plaidRejection(404, "ITEM_NOT_FOUND", "ITEM_ERROR");
    const res = await post();
    expect(res.status).toBe(404);
    expect(classifyRelinkResponse(res.status, res.json)).toBe("token_refused");
  });
});

describe("relink — the connection row", () => {
  it("an absent row: the 404, read as the bank no longer linked", async () => {
    state.lookup = { ok: true, connection: null };
    const res = await post();
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: "Connection not found" });
    expect(classifyRelinkResponse(res.status, res.json)).toBe("not_linked");
  });

  it("a failed read: the 500 with its code, read as a failed start", async () => {
    state.lookup = { ok: false };
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json.code).toBe("CONNECTION_READ_FAILED");
    expect(classifyRelinkResponse(res.status, res.json)).toBe("start_failed");
  });

  it("a failed decrypt: a 500 with no code of any kind, read as a failed start, and Plaid is not asked", async () => {
    state.decryptFails = true;
    const res = await post();
    expect(res.status).toBe(500);
    expect(Object.keys(res.json)).toEqual(["error"]);
    expect(classifyRelinkResponse(res.status, res.json)).toBe("start_failed");
    expect(state.linkTokenCalls).toBe(0);
  });
});
