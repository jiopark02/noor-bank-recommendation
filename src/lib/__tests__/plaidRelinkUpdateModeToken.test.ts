import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/plaid/relink, executed: the update-mode link token request.
 *
 * The real route and the real authenticate() run. Faked: the token
 * verification under authenticate(), the configuration predicates, the row
 * lookup, the decrypt, and the Plaid client's linkTokenCreate, which records
 * the request it is given. Whether Plaid accepts the request is a live check.
 *
 * Mutations that turn this file red:
 *   - `products` sent again on the update-mode request             -> "no products"
 *   - `optional_products` or `additional_consented_products` on the
 *     update-mode request                                          -> "no optional or additionally consented"
 *   - the stored (encrypted) value sent instead of the decrypted one -> "decrypted token"
 *   - client_user_id taken from anything but the verified user      -> "verified user"
 *   - a redirect_uri field on the update-mode request again         -> "no redirect_uri"
 */

const state = {
  linkTokenCalls: [] as Array<Record<string, unknown>>,
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
    async linkTokenCreate(request: Record<string, unknown>) {
      state.linkTokenCalls.push(request);
      return {
        data: { link_token: "link-sandbox-test", expiration: "2026-11-16T00:00:00Z" },
      };
    },
  },
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
  decryptPlaidAccessToken: (stored: string, userId: string) =>
    stored === "v1:stored:cipher:text" && userId === "user-1"
      ? "access-sandbox-plain"
      : "wrong-decrypt-input",
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  getPlaidConnectionByItemId: async () => ({
    ok: true,
    connection: { item_id: "item-1", access_token: "v1:stored:cipher:text" },
  }),
}));

async function post(body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const { POST } = await import("../../app/api/plaid/relink/route");
  const res = await POST(
    new Request("https://noor.test/api/plaid/relink", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  state.linkTokenCalls = [];
});

describe("relink — the update-mode link token request", () => {
  it("sends no products", async () => {
    const res = await post({ itemId: "item-1" });
    expect(res.status).toBe(200);
    expect(state.linkTokenCalls).toHaveLength(1);
    expect("products" in state.linkTokenCalls[0]).toBe(false);
  });

  it("sends no optional or additionally consented products", async () => {
    const res = await post({ itemId: "item-1" });
    expect(res.status).toBe(200);
    expect(state.linkTokenCalls).toHaveLength(1);
    expect("optional_products" in state.linkTokenCalls[0]).toBe(false);
    expect("additional_consented_products" in state.linkTokenCalls[0]).toBe(false);
  });

  it("sends the decrypted token, never the stored value", async () => {
    await post({ itemId: "item-1" });
    expect(state.linkTokenCalls[0].access_token).toBe("access-sandbox-plain");
  });

  it("names the verified user, never a user named in the body", async () => {
    await post({ itemId: "item-1", userId: "someone-else" });
    expect(state.linkTokenCalls[0].user).toEqual({ client_user_id: "user-1" });
  });

  it("sends no redirect_uri, whatever the environment holds", async () => {
    process.env.PLAID_REDIRECT_URI = "https://noor.test/oauth-return";
    try {
      const res = await post({ itemId: "item-1" });
      expect(res.status).toBe(200);
      expect(state.linkTokenCalls).toHaveLength(1);
      expect("redirect_uri" in state.linkTokenCalls[0]).toBe(false);
    } finally {
      delete process.env.PLAID_REDIRECT_URI;
    }
  });
});
