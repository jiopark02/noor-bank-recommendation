import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Token verification in apiAuth.ts, executed.
 *
 * The subject is the helper itself: how it reads the Bearer header and what it
 * does with Supabase Auth's answer. To run it offline the supabase module is
 * replaced (the server-client factory and the configuration predicate). No
 * route's authentication is faked here; nothing in this file calls a route.
 *
 * Mutations of apiAuth.ts and the tests each one turns red:
 *   AM1 `error || !user` changed to `!user`              -> A2, A9
 *   AM2 the "Bearer " prefix check removed               -> A4
 *   AM3 .trim() removed from the token                   -> A1
 *   AM4 the isSupabaseConfigured() check removed         -> A6
 *   AM5 the try/catch removed                            -> A7, A8
 *   AM6 the id variant given its own copy of the logic   -> A10
 */

const { isSupabaseConfiguredMock, createServerClientMock, getUserMock } =
  vi.hoisted(() => ({
    isSupabaseConfiguredMock: vi.fn(),
    createServerClientMock: vi.fn(),
    getUserMock: vi.fn(),
  }));

vi.mock("../supabase", () => ({
  isSupabaseConfigured: isSupabaseConfiguredMock,
  createServerClient: createServerClientMock,
  createAdminClient: vi.fn(),
}));

// Imported after the mock is registered (vi.mock is hoisted above it anyway).
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import {
  getAuthenticatedUserFromRequest,
  getAuthenticatedUserIdFromRequest,
  resolveRequestAuth,
} from "../apiAuth";

const USER = { id: "user_1", email: "owner@example.com" };

/** Only headers.get is read; a plain getter avoids Headers' normalization. */
function request(authorization?: string): NextRequest {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? authorization ?? null : null,
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  isSupabaseConfiguredMock.mockReset().mockReturnValue(true);
  getUserMock.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
  createServerClientMock
    .mockReset()
    .mockImplementation(() => ({ auth: { getUser: getUserMock } }));
});

describe("getAuthenticatedUserFromRequest", () => {
  it("A1 verifies the trimmed token after the Bearer prefix and returns the user", async () => {
    const user = await getAuthenticatedUserFromRequest(request("Bearer  tok "));
    expect(getUserMock).toHaveBeenCalledWith("tok");
    expect(user).toBe(USER);
  });

  it("A2 returns null when verification reports an error, even with a user", async () => {
    getUserMock.mockResolvedValue({
      data: { user: USER },
      error: { message: "invalid JWT" },
    });
    expect(await getAuthenticatedUserFromRequest(request("Bearer tok"))).toBeNull();
  });

  it("A3 returns null when verification returns no user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getAuthenticatedUserFromRequest(request("Bearer tok"))).toBeNull();
  });

  it.each(["Basic abcdefgh", "bearer tok", "Token tok"])(
    "A4 returns null without verifying for the header %j",
    async (header) => {
      expect(await getAuthenticatedUserFromRequest(request(header))).toBeNull();
      expect(getUserMock).not.toHaveBeenCalled();
    }
  );

  it("A5 returns null without building a client when there is no header", async () => {
    expect(await getAuthenticatedUserFromRequest(request())).toBeNull();
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("A6 returns null without building a client when Supabase is not configured", async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    expect(await getAuthenticatedUserFromRequest(request("Bearer tok"))).toBeNull();
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("A7 returns null rather than rejecting when the client cannot be built", async () => {
    createServerClientMock.mockImplementation(() => {
      throw new Error("Supabase service role key is required");
    });
    await expect(
      getAuthenticatedUserFromRequest(request("Bearer tok"))
    ).resolves.toBeNull();
  });

  it("A8 returns null rather than rejecting when verification rejects", async () => {
    getUserMock.mockRejectedValue(new Error("network"));
    await expect(
      getAuthenticatedUserFromRequest(request("Bearer tok"))
    ).resolves.toBeNull();
  });
});

/**
 * resolveRequestAuth: the same verification, with the cause kept.
 *
 * Mutations of apiAuth.ts and the tests each one turns red:
 *   AM7 a cause renamed, merged with another, or returned
 *       for a different case                              -> C1
 *   AM8 a returned verification error no longer read by
 *       classifyGetUserFailure                            -> C2
 *   AM9 a rejected verification read as a refused token   -> C1 (auth_unreachable)
 *   AM10 the user-returning helper given logic of its own,
 *        so the two disagree                              -> C3
 */
type Arrange = () => void;

const FAILURES: Array<[string, string | undefined, Arrange]> = [
  ["supabase_unconfigured", "Bearer tok", () => isSupabaseConfiguredMock.mockReturnValue(false)],
  ["no_header", undefined, () => {}],
  ["no_header", "", () => {}],
  ["not_bearer", "Basic abcdefgh", () => {}],
  ["not_bearer", "bearer tok", () => {}],
  ["empty_token", "Bearer   ", () => {}],
  [
    "client_unavailable",
    "Bearer tok",
    () =>
      createServerClientMock.mockImplementation(() => {
        throw new Error("Supabase service role key is required");
      }),
  ],
  [
    "token_rejected",
    "Bearer tok",
    () => getUserMock.mockResolvedValue({ data: { user: null }, error: null }),
  ],
  [
    "token_rejected",
    "Bearer tok",
    () =>
      getUserMock.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError("invalid JWT", 403, "bad_jwt"),
      }),
  ],
  ["auth_unreachable", "Bearer tok", () => getUserMock.mockRejectedValue(new Error("network"))],
];

describe("resolveRequestAuth", () => {
  it.each(FAILURES)("C1 reports %s for the header %j", async (cause, header, arrange) => {
    arrange();
    expect(await resolveRequestAuth(request(header))).toEqual({ ok: false, cause });
  });

  it("C2 a returned error that says nothing about the token is auth_unreachable", async () => {
    for (const error of [
      new AuthRetryableFetchError("fetch failed", 0),
      new AuthRetryableFetchError("bad gateway", 503),
      new AuthApiError("internal", 500, undefined),
    ]) {
      getUserMock.mockResolvedValue({ data: { user: null }, error });
      expect(await resolveRequestAuth(request("Bearer tok"))).toEqual({
        ok: false,
        cause: "auth_unreachable",
      });
    }
  });

  it("C3 the user-returning helper answers the same user, and null for every cause", async () => {
    const ok = await resolveRequestAuth(request("Bearer tok"));
    expect(ok).toEqual({ ok: true, user: USER });
    expect(await getAuthenticatedUserFromRequest(request("Bearer tok"))).toBe(USER);

    for (const [, header, arrange] of FAILURES) {
      isSupabaseConfiguredMock.mockReset().mockReturnValue(true);
      getUserMock.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
      createServerClientMock
        .mockReset()
        .mockImplementation(() => ({ auth: { getUser: getUserMock } }));
      arrange();
      expect(await getAuthenticatedUserFromRequest(request(header))).toBeNull();
      expect(await getAuthenticatedUserIdFromRequest(request(header))).toBeNull();
    }
  });
});

describe("getAuthenticatedUserIdFromRequest", () => {
  it("A9 returns the verified user's id, and null when verification fails", async () => {
    expect(await getAuthenticatedUserIdFromRequest(request("Bearer tok"))).toBe(
      "user_1"
    );

    getUserMock.mockResolvedValue({
      data: { user: USER },
      error: { message: "invalid JWT" },
    });
    expect(
      await getAuthenticatedUserIdFromRequest(request("Bearer tok"))
    ).toBeNull();
  });

  it("A10 token verification exists once for both helpers (plus requireAdmin)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../apiAuth.ts", import.meta.url)),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(src.match(/\.auth\.getUser\(/g) ?? []).toHaveLength(2);
  });
});
