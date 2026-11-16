import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/plaid/relink, executed: a failed read is not an absent row.
 *
 * The real route and the real authenticate() run. Faked: the token
 * verification under authenticate(), the configuration predicates, the row
 * lookup, the decrypt, and the Plaid client's linkTokenCreate.
 *
 * Mutations that turn this file red:
 *   - a failed read answered with the 404 again                -> "failed read"
 *   - the absence check moved before the failure check         -> "failed read"
 *   - an absent row answered with anything but the 404         -> "absent row"
 *   - Plaid asked for a link token when there is no row to use -> both
 */

type Lookup = { ok: true; connection: unknown } | { ok: false };

const state = {
  lookup: { ok: true, connection: null } as Lookup,
  linkTokenCalls: 0,
};

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => "user-1",
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
      return {
        data: { link_token: "link-sandbox-test", expiration: "2026-11-16T00:00:00Z" },
      };
    },
  },
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
  decryptPlaidAccessToken: () => "access-sandbox-plain",
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  getPlaidConnectionByItemId: async () => state.lookup,
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
  state.lookup = { ok: true, connection: null };
  state.linkTokenCalls = 0;
});

describe("relink — the three states of the connection read", () => {
  it("answers a failed read with 500 CONNECTION_READ_FAILED, never the 404", async () => {
    state.lookup = { ok: false };
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json.code).toBe("CONNECTION_READ_FAILED");
    expect(res.json.error).not.toBe("Connection not found");
    expect(state.linkTokenCalls).toBe(0);
  });

  it("answers an absent row with the 404", async () => {
    state.lookup = { ok: true, connection: null };
    const res = await post();
    expect(res.status).toBe(404);
    expect(res.json.error).toBe("Connection not found");
    expect(state.linkTokenCalls).toBe(0);
  });

  it("asks Plaid for a link token when the row is there", async () => {
    state.lookup = {
      ok: true,
      connection: { item_id: "item-1", access_token: "v1:a:b:c" },
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.linkToken).toBe("link-sandbox-test");
    expect(state.linkTokenCalls).toBe(1);
  });
});
