import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe: what /api/plaid/create-link-token tells its caller when Plaid
 * is not configured.
 *
 * The bank-link button shows the route's `error` to the user verbatim, so the
 * response must not carry setup instructions or environment variable names.
 * Those go to the server log, without any user identifier. The route cannot be
 * executed here; this reads its text. What the screen shows is a live check.
 *
 * Response calls are cut by paren balance on comment-stripped text. That is
 * safe for this file because none of its string literals contains a paren; a
 * literal that did would cut a call short, and the failure would look like a
 * missing anchor.
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** Comments removed, so assertions are about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTE = code(read("../../app/api/plaid/create-link-token/route.ts"));

/** Every `<callee>(...)` call in the text, cut by paren balance. */
function calls(source: string, callee: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(`${callee}(`, from);
    if (start === -1) return out;
    let depth = 0;
    let k = start + callee.length;
    for (; k < source.length; k++) {
      if (source[k] === "(") depth++;
      else if (source[k] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(source.slice(start, k + 1));
    from = k + 1;
  }
}

function unconfiguredBranch(): string {
  const start = ROUTE.indexOf("if (!isPlaidConfigured())");
  const end = ROUTE.indexOf("const auth =", start);
  if (start < 0 || end < 0) {
    throw new Error(
      "create-link-token/route.ts: could not bound the unconfigured branch " +
        "between `if (!isPlaidConfigured())` and `const auth =`; re-point these anchors."
    );
  }
  return ROUTE.slice(start, end);
}

describe("create-link-token responses", () => {
  it("no env var name or setup instruction in a response", () => {
    // Red if: the old sentence comes back, or any of these strings is put into
    // a response body.
    const responses = calls(ROUTE, "NextResponse.json");
    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      expect(response).not.toContain("PLAID_CLIENT_ID");
      expect(response).not.toContain("PLAID_SECRET");
      expect(response).not.toContain("environment variables");
    }
  });

  it("the unconfigured 503 keeps its status and says the user sentence", () => {
    // Red if: the sentence or the status changes.
    const branch = unconfiguredBranch();
    const response = calls(branch, "NextResponse.json");
    expect(response).toHaveLength(1);
    expect(response[0]).toContain(
      "\"Bank connections aren't available right now. Please try again later.\""
    );
    expect(response[0]).toMatch(/\{\s*status:\s*503\s*\}/);
  });

  it("the configuration detail goes to the server log, with no user identifier", () => {
    // Red if: the log line is removed, or a user identifier is added to it.
    const logs = calls(unconfiguredBranch(), "console.error");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("PLAID_CLIENT_ID");
    expect(logs[0]).toContain("PLAID_SECRET");
    expect(logs[0]).not.toMatch(/\b(userId|auth|user_id)\b/);
  });
});
