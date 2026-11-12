import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { PLAID_TRANSACTIONS_DAYS_REQUESTED } from "../plaid";

/**
 * POST /api/plaid/create-link-token, executed.
 *
 * The real authenticate() runs; only the token verification under it, the
 * connection count and the Plaid client's linkTokenCreate are faked. The rest
 * of @/lib/plaid is the real module, so the request carries the real constants.
 *
 * Mutations that turn this file red:
 *   - client_user_id taken from anywhere but the verified token -> "the verified user"
 *   - the auth check removed, or moved after linkTokenCreate    -> "unauthenticated"
 *   - the transactions field removed, or sent only on some path -> "requests the history days"
 *   - the transactions field sent only when no webhook is set   -> "with a webhook set"
 *   - the history-days constant changed                         -> "is 730"
 *   - any history-days value read from the request body         -> "cannot be set by the body"
 *
 * Whether Plaid accepts the value is a live check; the client is faked here.
 */

const state = {
  userId: "user-1" as string | null,
  count: 0 as number | null,
  linkTokenCalls: [] as Array<Record<string, any>>,
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
  isSupabaseConfigured: () => false,
  isSupabaseAdminConfigured: () => false,
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  countPlaidConnections: async () => state.count,
}));

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => true,
  plaidClient: {
    async linkTokenCreate(request: Record<string, any>) {
      state.linkTokenCalls.push(request);
      return {
        data: { link_token: "link-sandbox-test", expiration: "2026-11-12T01:00:00Z" },
      };
    },
  },
}));

async function post(
  body: Record<string, unknown> = {}
): Promise<{ status: number; json: any }> {
  const { POST } = await import("../../app/api/plaid/create-link-token/route");
  const res = await POST(
    new Request("https://noor.test/api/plaid/create-link-token", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  state.userId = "user-1";
  state.count = 0;
  state.linkTokenCalls = [];
  delete process.env.PLAID_WEBHOOK_URL;
});

describe("create-link-token request", () => {
  it("asks Plaid once, for the verified user, never a user named in the body", async () => {
    // Red if: client_user_id comes from the body or any value but the token's.
    const { status, json } = await post({ userId: "someone-else" });
    expect(status).toBe(200);
    expect(json.linkToken).toBe("link-sandbox-test");
    expect(state.linkTokenCalls).toHaveLength(1);
    expect(state.linkTokenCalls[0].user).toEqual({ client_user_id: "user-1" });
  });

  it("unauthenticated: 401, and Plaid is never asked", async () => {
    // Red if: the auth check is removed or moved after linkTokenCreate.
    state.userId = null;
    const { status } = await post();
    expect(status).toBe(401);
    expect(state.linkTokenCalls).toHaveLength(0);
  });

  it("requests the history days from the server constant", async () => {
    // Red if: the transactions field is removed, or sent only when a webhook is set.
    const { status } = await post();
    expect(status).toBe(200);
    expect(state.linkTokenCalls).toHaveLength(1);
    expect(state.linkTokenCalls[0].transactions).toEqual({
      days_requested: PLAID_TRANSACTIONS_DAYS_REQUESTED,
    });
  });

  it("with a webhook set, requests the history days and registers the webhook", async () => {
    // Red if: the transactions field is sent only when no webhook is set.
    const previous = process.env.PLAID_WEBHOOK_URL;
    process.env.PLAID_WEBHOOK_URL = "https://noor.test/api/plaid/webhook";
    try {
      const { status } = await post();
      expect(status).toBe(200);
      expect(state.linkTokenCalls).toHaveLength(1);
      expect(state.linkTokenCalls[0].transactions).toEqual({
        days_requested: PLAID_TRANSACTIONS_DAYS_REQUESTED,
      });
      expect(state.linkTokenCalls[0].webhook).toBe(
        "https://noor.test/api/plaid/webhook"
      );
    } finally {
      if (previous === undefined) delete process.env.PLAID_WEBHOOK_URL;
      else process.env.PLAID_WEBHOOK_URL = previous;
    }
  });

  it("the history-days constant is 730", () => {
    // Red if: the value changes. The test above holds whatever value it has.
    expect(PLAID_TRANSACTIONS_DAYS_REQUESTED).toBe(730);
  });

  it("the history days cannot be set by the body", async () => {
    // Red if: any value from the body reaches the request.
    const { status } = await post({
      days_requested: 30,
      transactions: { days_requested: 30 },
    });
    expect(status).toBe(200);
    expect(state.linkTokenCalls).toHaveLength(1);
    expect(state.linkTokenCalls[0].transactions).toEqual({ days_requested: 730 });
  });
});
