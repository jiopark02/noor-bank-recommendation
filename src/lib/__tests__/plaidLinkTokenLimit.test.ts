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
 *   - the values sent changed, or the user id altered                         -> "sends"
 *   - the switch trimmed, case-folded, or off on any other value              -> "exact"
 *   - a held claim answered with anything but 429 and its code                -> "refusals"
 *   - the claim called from a route other than create-link-token (re-link
 *     tokens are not counted)                                                 -> "only create-link-token"
 */

describe("claimLinkTokenIssue", () => {
  it("sends the user id verbatim with the limit's values", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await claimLinkTokenIssue(rpc, "User-ID-1 ")).toBe("claimed");
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
    expect(await claimLinkTokenIssue(async () => ({ data: false, error: null }), "u")).toBe(
      "held"
    );
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
      expect(await claimLinkTokenIssue(() => answer(), "u")).toBe("error");
    }
    // A client that cannot be built throws inside the rpc call.
    expect(
      await claimLinkTokenIssue(() => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
      }, "u")
    ).toBe("error");
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
