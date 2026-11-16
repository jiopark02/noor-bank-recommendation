import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/plaid/disconnect, executed: how one revocation outcome becomes one
 * response.
 *
 * The real route and the real authenticate() run. Faked: the token
 * verification under authenticate(), the configuration predicates, the row
 * lookup, and revokeAndDeleteConnection itself (its own behaviour is executed
 * in plaidRevocation.test.ts). This file pins only the mapping.
 *
 * The lookup is faked under BOTH helper names the route has used for this read
 * (the full-row one and the revocation-only one), answering from the same
 * state, so this file does not depend on which of the two the route calls.
 *
 * Mutations that turn this file red:
 *   - two failure kinds' answers swapped, or a kind's status or code changed -> "maps"
 *   - a failed read answered as anything but 500 CONNECTION_READ_FAILED      -> "failed read"
 *   - an absent row answered as anything but success                         -> "absent row"
 *   - a `default:` branch put back in the outcome switch                     -> "no default"
 */

type Lookup = { ok: true; connection: unknown } | { ok: false };
type Outcome =
  | { itemId: string; ok: true }
  | { itemId: string; ok: false; failure: string };

const state = {
  lookup: { ok: true, connection: null } as Lookup,
  outcome: { itemId: "item-1", ok: true } as Outcome,
  revokeCalls: 0,
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
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidTokenCrypto")>()),
  isPlaidTokenCryptoConfigured: () => true,
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  getPlaidConnectionByItemId: async () => state.lookup,
  getRevocableConnectionByItemId: async () => state.lookup,
}));

vi.mock("@/lib/plaidRevocation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidRevocation")>()),
  liveRevocationDeps: () => ({}),
  revokeAndDeleteConnection: async () => {
    state.revokeCalls++;
    return state.outcome;
  },
}));

async function post(): Promise<{ status: number; json: any }> {
  const { POST } = await import("../../app/api/plaid/disconnect/route");
  const res = await POST(
    new Request("https://noor.test/api/plaid/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ itemId: "item-1" }),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

const ROW = { item_id: "item-1", access_token: "v1:ciphertext" };

beforeEach(() => {
  state.lookup = { ok: true, connection: ROW };
  state.outcome = { itemId: "item-1", ok: true };
  state.revokeCalls = 0;
});

describe("disconnect maps each revocation outcome to its answer", () => {
  it.each([
    ["crypto_config", 503, "PLAID_CRYPTO_UNCONFIGURED"],
    ["row_delete", 500, "ROW_DELETE_FAILED"],
    ["crypto_row", 500, "REVOKE_FAILED"],
    ["plaid", 500, "REVOKE_FAILED"],
  ])("maps %s to %i %s", async (failure, status, code) => {
    state.outcome = { itemId: "item-1", ok: false, failure };
    const res = await post();
    expect(state.revokeCalls).toBe(1);
    expect(res.status).toBe(status);
    expect(res.json.code).toBe(code);
    expect(res.json.success).toBeUndefined();
  });

  it("maps a completed revocation to success", async () => {
    const res = await post();
    expect(state.revokeCalls).toBe(1);
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
  });

  it("answers a failed read with 500 CONNECTION_READ_FAILED and revokes nothing", async () => {
    state.lookup = { ok: false };
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json.code).toBe("CONNECTION_READ_FAILED");
    expect(state.revokeCalls).toBe(0);
  });

  it("answers an absent row with success and revokes nothing", async () => {
    state.lookup = { ok: true, connection: null };
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(state.revokeCalls).toBe(0);
  });
});

describe("disconnect's outcome switch", () => {
  it("has no default branch and ends in a never check", () => {
    // The compiler enforces exhaustiveness only while there is no default to
    // absorb a new kind. Comments are stripped so the assertion reads code.
    const source = readFileSync(
      fileURLToPath(new URL("../../app/api/plaid/disconnect/route.ts", import.meta.url)),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const start = source.indexOf("switch (outcome.failure) {");
    const end = source.indexOf("const _exhaustive: never = outcome.failure;");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toMatch(/\bdefault\s*:/);
  });
});
