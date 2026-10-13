import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * GET /api/plaid/connections must answer `Cache-Control: private, no-store`.
 *
 * WHY
 * The body names the user's banks, their Plaid Item ids and connection status.
 * Without an explicit header the deployment answered
 * `public, max-age=0, must-revalidate`, which permits a shared cache to store
 * the response. The route now sets the header in GET itself, on whatever the
 * inner reader returns, so every response the route produces — 401, 500 and
 * 200 — carries it.
 *
 * WHAT THIS FILE PROVES AND DOES NOT PROVE
 * It reads source TEXT. It proves GET sets the header on the response it
 * returns and has no other way out: one return, after the header, and no
 * response built inside GET itself. It does NOT run the route, so it cannot
 * prove the deployed response carries the header — check that in the
 * browser's network panel on a deployment. A throw out of the reader skips the
 * header and gets Next's own error response; that response carries no
 * connection data, and this file does not cover it.
 *
 * MUTATIONS THAT MUST TURN THIS FILE RED
 * - Delete the `response.headers.set("Cache-Control", "private, no-store")`
 *   line, or change its value (for example to "no-cache").
 * - Add an early return in GET before the header is set, for example
 *   `if (!request) return NextResponse.json({});`.
 *
 * IF THIS FILE FAILS
 * (a) The header line was removed or changed, or GET gained a return path that
 *     skips it. That is the defect.
 * (b) GET could not be bounded — the handler was renamed or restructured. Not
 *     a defect; re-point the anchors.
 */

const ROUTE = readFileSync(
  fileURLToPath(
    new URL("../../app/api/plaid/connections/route.ts", import.meta.url)
  ),
  "utf8"
);

/** Comments removed; naive about strings, and the route has no `//` in one. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** GET's body, from its declaration to the first closing brace at column 0. */
function getHandlerSource(): string {
  const code = withoutComments(ROUTE);
  const start = code.indexOf("export async function GET(");
  if (start < 0) {
    throw new Error(
      "connections/route.ts: `export async function GET(` not found; " +
        "re-point this anchor."
    );
  }
  const close = code.slice(start).search(/\r?\n\}/);
  if (close < 0) {
    throw new Error(
      "connections/route.ts: could not find the end of GET; re-point this anchor."
    );
  }
  return code.slice(start, start + close);
}

describe("plaid connections route — responses are not cacheable", () => {
  it("GET sets Cache-Control: private, no-store and returns only after it", () => {
    const body = getHandlerSource();

    const setAt = body.indexOf(
      'response.headers.set("Cache-Control", "private, no-store")'
    );
    expect(setAt).toBeGreaterThan(-1);

    // Exactly one way out of GET, and it comes after the header.
    const returns = body.match(/\breturn\b/g) ?? [];
    expect(returns.length).toBe(1);
    expect(body.indexOf("return response;")).toBeGreaterThan(setAt);

    // No response built in GET itself, which would bypass the shared path.
    expect(body).not.toContain("NextResponse.");
  });
});
