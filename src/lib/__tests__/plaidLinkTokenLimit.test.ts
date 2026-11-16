import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  claimLinkTokenIssue,
  LINK_TOKEN_CHECK_CODE,
  LINK_TOKEN_ISSUE_LIMIT,
  LINK_TOKEN_ISSUE_WINDOW_SECONDS,
  LINK_TOKEN_LIMIT_CODE,
  linkTokenClaimRefusal,
  resolveLinkTokenLimitMode,
} from "../plaidLinkTokenLimit";

/**
 * The link-token issue limit's application side, executed: how the database's
 * answer is read, the values sent, the switch, and the refusals.
 *
 * Mutations that turn this file red:
 *   - an error, a throw or a non-boolean answer read as anything but "error" -> "fails closed"
 *   - a cause mislabelled, the error's message/details/hint used as the
 *     cause, or a code copied whatever its shape                              -> "the cause"
 *   - the values sent changed, or the user id altered                         -> "sends"
 *   - the switch trimmed, case-folded, or off on any other value              -> "exact"
 *   - a held claim answered with anything but 429 and its code                -> "refusals"
 *   - the claim called from a route other than create-link-token (re-link
 *     tokens are not counted)                                                 -> "only create-link-token"
 */

describe("claimLinkTokenIssue", () => {
  it("sends the user id verbatim with the limit's values", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await claimLinkTokenIssue(rpc, "User-ID-1 ")).toEqual({ claim: "claimed" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("plaid_link_token_claim", {
      p_user_id: "User-ID-1 ",
      p_max_count: 10,
      p_window_seconds: 86_400,
    });
  });

  it("the limit's values: 10 inside 24 hours", () => {
    expect(LINK_TOKEN_ISSUE_LIMIT).toBe(10);
    expect(LINK_TOKEN_ISSUE_WINDOW_SECONDS).toBe(24 * 60 * 60);
  });

  it("false is held", async () => {
    expect(await claimLinkTokenIssue(async () => ({ data: false, error: null }), "u")).toEqual({
      claim: "held",
    });
  });

  it("fails closed: an error, a throw, or any answer that is not a boolean", async () => {
    const answers: Array<() => PromiseLike<{ data: unknown; error: unknown }>> = [
      async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }),
      async () => ({ data: true, error: { code: "57014" } }),
      async () => {
        throw new Error("network");
      },
      async () => ({ data: null, error: null }),
      async () => ({ data: "true", error: null }),
      async () => ({ data: 1, error: null }),
      async () => ({ data: [true], error: null }),
    ];
    for (const answer of answers) {
      expect((await claimLinkTokenIssue(() => answer(), "u")).claim).toBe("error");
    }
    // A client that cannot be built throws inside the rpc call.
    expect(
      (
        await claimLinkTokenIssue(() => {
          throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
        }, "u")
      ).claim
    ).toBe("error");
  });

  it("the cause: the error's code when it has the safe shape, else a fixed label", async () => {
    const cases: Array<[() => PromiseLike<{ data: unknown; error: unknown }>, string]> = [
      [async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }), "42883"],
      [async () => ({ data: null, error: { code: "PGRST202", message: "not found" } }), "PGRST202"],
      [async () => ({ data: true, error: { code: "57014" } }), "57014"],
      // supabase-js reports a failed fetch as an error with an empty code.
      [async () => ({ data: null, error: { code: "", message: "TypeError: fetch failed" } }), "rpc_error"],
      [async () => ({ data: null, error: { message: "no code" } }), "rpc_error"],
      [async () => ({ data: null, error: { code: 42883 } }), "rpc_error"],
      [async () => ({ data: null, error: { code: "throw" } }), "rpc_error"],
      [async () => ({ data: null, error: { code: "42883 user@example.com" } }), "rpc_error"],
      [async () => ({ data: null, error: { code: "42883\nfake line" } }), "rpc_error"],
      [async () => ({ data: null, error: { code: "A".repeat(17) } }), "rpc_error"],
      [async () => ({ data: null, error: "boom" }), "rpc_error"],
      [
        async () => {
          throw new Error("network");
        },
        "throw",
      ],
      [() => Promise.reject("not an Error"), "throw"],
      [async () => ({ data: null, error: null }), "bad_answer"],
      [async () => ({ data: "true", error: null }), "bad_answer"],
      [async () => ({ data: [true], error: null }), "bad_answer"],
      [async () => null as unknown as { data: unknown; error: unknown }, "bad_answer"],
    ];
    for (const [answer, cause] of cases) {
      expect(await claimLinkTokenIssue(() => answer(), "u")).toEqual({ claim: "error", cause });
    }
    expect(
      await claimLinkTokenIssue(() => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
      }, "u")
    ).toEqual({ claim: "error", cause: "throw" });
  });

  it("the cause never carries the error's message, details or hint", async () => {
    const result = await claimLinkTokenIssue(
      async () => ({
        data: null,
        error: {
          code: "P0001",
          message: "secret-message user@example.com",
          details: "secret-details 123-45-6789",
          hint: "secret-hint",
        },
      }),
      "u"
    );
    expect(result).toEqual({ claim: "error", cause: "P0001" });
    expect(JSON.stringify(result)).not.toMatch(/secret|example\.com|6789/);
  });
});

describe("resolveLinkTokenLimitMode", () => {
  it("exact: only the value off turns the limit off", () => {
    expect(resolveLinkTokenLimitMode("off")).toBe("off");
    for (const raw of [undefined, "", " off", "off ", "OFF", "Off", "false", "0", "observe", "enforce"]) {
      expect(resolveLinkTokenLimitMode(raw), String(raw)).toBe("enforce");
    }
  });
});

describe("linkTokenClaimRefusal", () => {
  it("refusals: claimed goes on; held is 429; error is 503", () => {
    expect(linkTokenClaimRefusal("claimed")).toBeNull();
    const held = linkTokenClaimRefusal("held");
    expect(held?.status).toBe(429);
    expect(held?.body.code).toBe(LINK_TOKEN_LIMIT_CODE);
    expect(held?.body.code).toBe("LINK_TOKEN_LIMIT_REACHED");
    expect(held?.body.error).toMatch(/too many times/);
    const failed = linkTokenClaimRefusal("error");
    expect(failed?.status).toBe(503);
    expect(failed?.body.code).toBe(LINK_TOKEN_CHECK_CODE);
    expect(failed?.body.code).toBe("LINK_TOKEN_CHECK_UNAVAILABLE");
  });

  it("the 429 sentence is not Plaid's own rate-limit sentence", () => {
    const held = linkTokenClaimRefusal("held");
    expect(held?.body.error).not.toContain("Too many requests to your bank");
  });
});

// ---- wiring (source probe) ---------------------------------------------------

const API_DIR = fileURLToPath(new URL("../../app/api/", import.meta.url));

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

describe("which routes claim", () => {
  it("only create-link-token claims; re-link tokens are not counted", () => {
    const claiming = routeFiles(API_DIR)
      .filter((file) =>
        /plaidLinkTokenLimit|plaid_link_token_claim/.test(readFileSync(file, "utf8"))
      )
      .map((file) => path.relative(API_DIR, file).split(path.sep).join("/"));
    expect(claiming).toEqual(["plaid/create-link-token/route.ts"]);
  });
});
