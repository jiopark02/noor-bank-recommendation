import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/plaid/exchange-token: the public-token exchange is made with no
 * time limit, stated on the call itself.
 *
 * The Plaid client's axios instance has a default time limit. The exchange is
 * the one call where giving up early loses the only access token for an Item
 * that already exists at Plaid, so the route passes `{ timeout: 0 }` per call,
 * and per-call options win over the instance default (executed in
 * plaidHttpTimeout.test.ts). This file checks that the route passes it.
 *
 * Only the token verification, the connection count and the client's
 * itemPublicTokenExchange are faked. The faked exchange records its arguments
 * and then refuses, so nothing after the exchange runs.
 *
 * Mutation that turns this file red:
 *   - the per-call `{ timeout: 0 }` removed from the exchange call
 */

const state = {
  exchangeCalls: [] as Array<{ request: unknown; options: unknown }>,
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
  isSupabaseConfigured: () => false,
  isSupabaseAdminConfigured: () => false,
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  countPlaidConnections: async () => 0,
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
}));

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => true,
  plaidClient: {
    async itemPublicTokenExchange(request: unknown, options?: unknown) {
      state.exchangeCalls.push({ request, options });
      throw new Error("exchange refused in test");
    },
    async itemGet() {
      throw new Error("itemGet must not be reached in this test");
    },
  },
}));

async function post(body: Record<string, unknown>): Promise<number> {
  const { POST } = await import("../../app/api/plaid/exchange-token/route");
  const res = await POST(
    new Request("https://noor.test/api/plaid/exchange-token", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
  return res.status;
}

beforeEach(() => {
  state.exchangeCalls = [];
});

describe("exchange-token: the exchange call", () => {
  it("is made once, with { timeout: 0 } as its per-call option", async () => {
    // Red if: the route calls itemPublicTokenExchange without the option, so
    // the client's default time limit applies to the exchange.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await post({ publicToken: "public-sandbox-test" });
    } finally {
      errors.mockRestore();
    }
    expect(state.exchangeCalls).toHaveLength(1);
    expect(state.exchangeCalls[0].request).toEqual({
      public_token: "public-sandbox-test",
    });
    expect(state.exchangeCalls[0].options).toEqual({ timeout: 0 });
  });
});
