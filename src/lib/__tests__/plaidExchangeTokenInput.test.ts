import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { INSTITUTION_NAME_MAX } from "../plaidExchange";

/**
 * POST /api/plaid/exchange-token, executed up to exchangeForUser: what the
 * route passes on as the client's institution id. exchangeForUser itself is
 * replaced by a spy; its decisions are executed in plaidExchange's own tests.
 *
 * Mutations that turn this file red:
 *   - the cap removed                                   -> "cut to the cap"
 *   - the cap counted in UTF-16 units, not code points  -> "never splits"
 *   - a value at or under the cap altered               -> "unchanged"
 *   - a non-string turned into a string                 -> "absent"
 */

const state = {
  inputs: [] as Array<Record<string, unknown>>,
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

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => true,
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
}));

vi.mock("@/lib/plaidExchange", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidExchange")>()),
  exchangeForUser: async (_userId: string, input: Record<string, unknown>) => {
    state.inputs.push(input);
    return { kind: "response", status: 200, body: { success: true } };
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
  state.inputs = [];
});

describe("exchange-token: the client's institution id", () => {
  it("the cap is 80 code points, the institution name's", () => {
    expect(INSTITUTION_NAME_MAX).toBe(80);
  });

  it("a longer value is cut to the cap, and the exchange still runs", async () => {
    expect(await post({ publicToken: "public-1", institutionId: "i".repeat(5000) })).toBe(200);
    expect(state.inputs).toHaveLength(1);
    expect(state.inputs[0].institutionId).toBe("i".repeat(80));
  });

  it("never splits a character outside the BMP at the cut", async () => {
    const value = "a".repeat(79) + "😀" + "b".repeat(10);
    await post({ publicToken: "public-1", institutionId: value });
    const sent = state.inputs[0].institutionId as string;
    expect(Array.from(sent)).toHaveLength(80);
    expect(sent.endsWith("😀")).toBe(true);
    expect(sent).toBe("a".repeat(79) + "😀");
  });

  it("a value at or under the cap passes unchanged, the empty string included", async () => {
    for (const value of ["ins_109508", "x".repeat(80), "", " ins_1 "]) {
      state.inputs = [];
      await post({ publicToken: "public-1", institutionId: value });
      expect(state.inputs[0].institutionId).toBe(value);
    }
  });

  it("absent or not a string stays absent", async () => {
    for (const body of [{ publicToken: "public-1" }, { publicToken: "public-1", institutionId: 42 }]) {
      state.inputs = [];
      await post(body);
      expect(state.inputs[0].institutionId).toBeUndefined();
    }
  });

  it("the other fields pass as before", async () => {
    await post({ publicToken: "public-1", institutionId: "ins_1", institutionName: "Bank" });
    expect(state.inputs[0]).toEqual({
      publicToken: "public-1",
      institutionId: "ins_1",
      institutionName: "Bank",
    });
  });
});
