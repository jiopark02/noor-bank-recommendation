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
 *   - the issue claim moved after linkTokenCreate, or removed   -> "claims before Plaid"
 *   - a failed claim lets the request through (fail-open)       -> "a claim that cannot be made"
 *   - a held claim lets the request through                     -> "over the limit"
 *   - the claim moved before the connection-limit check         -> "at the connection limit"
 *   - the claim keyed on anything but the verified user         -> "claims before Plaid"
 *   - the off switch ignored, or matched loosely                -> "the switch"
 *   - the failed-claim line without its cause, with the wrong
 *     cause, or with the error's message, details or hint       -> "the failed-claim log line"
 *
 * Whether Plaid accepts the value is a live check; the client is faked here.
 * The database function is faked too; its decision is checked with SQL.
 */

const state = {
  userId: "user-1" as string | null,
  count: 0 as number | null,
  linkTokenCalls: [] as Array<Record<string, any>>,
  // What the fake plaid_link_token_claim answers, or a throw.
  claim: { data: true, error: null } as { data: unknown; error: unknown } | "throw",
  adminThrows: false,
  claimCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  order: [] as string[],
};

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => state.userId,
}));

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => {
    throw new Error("server client must not be used in this test");
  },
  // Only the issue claim's rpc is answered; anything else fails the test.
  createAdminClient: () => {
    if (state.adminThrows) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    }
    return {
      async rpc(fn: string, args: Record<string, unknown>) {
        if (fn !== "plaid_link_token_claim") {
          throw new Error(`unexpected rpc ${fn}`);
        }
        state.order.push("claim");
        state.claimCalls.push({ fn, args });
        if (state.claim === "throw") throw new Error("network");
        return state.claim;
      },
    };
  },
  isSupabaseConfigured: () => false,
  isSupabaseAdminConfigured: () => false,
}));

vi.mock("@/lib/plaidApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaidApiUtils")>()),
  countPlaidConnections: async () => {
    state.order.push("count");
    return state.count;
  },
}));

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => true,
  plaidClient: {
    async linkTokenCreate(request: Record<string, any>) {
      state.order.push("plaid");
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
  state.claim = { data: true, error: null };
  state.adminThrows = false;
  state.claimCalls = [];
  state.order = [];
  delete process.env.PLAID_WEBHOOK_URL;
  delete process.env.PLAID_LINK_TOKEN_LIMIT_MODE;
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

describe("create-link-token issue limit", () => {
  it("claims before Plaid, after the connection count, for the verified user", async () => {
    const { status } = await post({ userId: "someone-else" });
    expect(status).toBe(200);
    expect(state.order).toEqual(["count", "claim", "plaid"]);
    expect(state.claimCalls).toEqual([
      {
        fn: "plaid_link_token_claim",
        args: { p_user_id: "user-1", p_max_count: 10, p_window_seconds: 86_400 },
      },
    ]);
  });

  it("over the limit: 429 with its code, and Plaid is never asked", async () => {
    state.claim = { data: false, error: null };
    const { status, json } = await post();
    expect(status).toBe(429);
    expect(json.code).toBe("LINK_TOKEN_LIMIT_REACHED");
    expect(typeof json.error).toBe("string");
    expect(state.linkTokenCalls).toHaveLength(0);
  });

  it("a claim that cannot be made: 503, and Plaid is never asked", async () => {
    const failures: Array<() => void> = [
      () => {
        state.claim = { data: null, error: { code: "42883", message: "function does not exist" } };
      },
      () => {
        state.claim = "throw";
      },
      () => {
        state.claim = { data: null, error: null };
      },
      () => {
        state.adminThrows = true;
      },
    ];
    for (const arrange of failures) {
      state.claim = { data: true, error: null };
      state.adminThrows = false;
      state.linkTokenCalls = [];
      arrange();
      const { status, json } = await post();
      expect(status).toBe(503);
      expect(json.code).toBe("LINK_TOKEN_CHECK_UNAVAILABLE");
      expect(state.linkTokenCalls).toHaveLength(0);
    }
  });

  it("the failed-claim log line carries the cause, and never the error's text", async () => {
    const cases: Array<[() => void, string]> = [
      [
        () => {
          state.claim = {
            data: null,
            error: {
              code: "42883",
              message: "secret-message user@example.com",
              details: "secret-details",
              hint: "secret-hint",
            },
          };
        },
        "42883",
      ],
      [
        () => {
          state.claim = { data: null, error: { code: "", message: "secret-message fetch failed" } };
        },
        "rpc_error",
      ],
      [
        () => {
          state.claim = "throw";
        },
        "throw",
      ],
      [
        () => {
          state.adminThrows = true;
        },
        "throw",
      ],
      [
        () => {
          state.claim = { data: "secret-answer", error: null };
        },
        "bad_answer",
      ],
    ];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const [arrange, cause] of cases) {
        state.claim = { data: true, error: null };
        state.adminThrows = false;
        for (const spy of [errorSpy, infoSpy, warnSpy, logSpy]) spy.mockClear();
        arrange();
        const { status } = await post();
        expect(status).toBe(503);

        const lines = errorSpy.mock.calls.filter((args) =>
          String(args[0]).includes("refused=issue_check_failed")
        );
        expect(lines, cause).toHaveLength(1);
        expect(lines[0], cause).toEqual([
          `[plaid-link-token] user_id=user-1 refused=issue_check_failed cause=${cause}`,
        ]);

        const everything = [errorSpy, infoSpy, warnSpy, logSpy]
          .flatMap((spy) => spy.mock.calls)
          .map((args) => args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "))
          .join("\n");
        expect(everything, cause).not.toMatch(/secret|example\.com|SUPABASE_SERVICE_ROLE_KEY|network/);
      }
    } finally {
      errorSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("at the connection limit: 422, and no issue is claimed", async () => {
    state.count = 5;
    const { status } = await post();
    expect(status).toBe(422);
    expect(state.claimCalls).toHaveLength(0);
    expect(state.linkTokenCalls).toHaveLength(0);
  });

  it("unauthenticated: no issue is claimed", async () => {
    state.userId = null;
    const { status } = await post();
    expect(status).toBe(401);
    expect(state.claimCalls).toHaveLength(0);
  });

  it("the switch: exactly off skips the claim; anything else enforces", async () => {
    process.env.PLAID_LINK_TOKEN_LIMIT_MODE = "off";
    state.claim = { data: false, error: null };
    const off = await post();
    expect(off.status).toBe(200);
    expect(state.claimCalls).toHaveLength(0);
    expect(state.linkTokenCalls).toHaveLength(1);

    process.env.PLAID_LINK_TOKEN_LIMIT_MODE = "OFF";
    state.linkTokenCalls = [];
    const loose = await post();
    expect(loose.status).toBe(429);
    expect(state.claimCalls).toHaveLength(1);
    expect(state.linkTokenCalls).toHaveLength(0);
  });
});
