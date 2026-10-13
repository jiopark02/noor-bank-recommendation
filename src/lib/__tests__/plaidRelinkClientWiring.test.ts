import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * A completed re-link does not call /api/plaid/exchange-token.
 *
 * Link in update mode repairs the existing Item's login in place; the access
 * token does not change, so there is nothing to exchange. The money screen used
 * to exchange the update-mode public token anyway, and the server's duplicate
 * check answered it with a 409 the screen showed as a failed re-link.
 *
 * WHAT THIS IS
 * A source probe over money/page.tsx, like plaidDisconnectLocalCleanup.test.ts:
 * there is no DOM environment here to run the component. It proves only that the
 * text of handleRelinkSuccess, comments removed, does not name the exchange
 * route. The server separately tolerates an older client that still sends the
 * exchange (plaidExchange.test.ts, "an Item this user already has"), which is
 * also why nothing else would notice the call coming back.
 *
 * IF THIS FILE FAILS
 *  (a) The exchange call is back in handleRelinkSuccess — the regression.
 *  (b) The anchors moved (renamed handlers, reordered declarations) — re-point
 *      them; do not delete the assertion.
 */

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/money/page.tsx", import.meta.url)),
  "utf8"
);

/** Comments removed, so the assertion is about code and not about prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** handleRelinkSuccess alone, bounded by the declaration that follows it. */
function relinkSuccessSource(source: string): string {
  const start = source.indexOf("const handleRelinkSuccess =");
  const end = source.indexOf("const handleRemoveConnection =", start);
  if (start < 0 || end < 0) {
    throw new Error(
      "money/page.tsx: could not bound `handleRelinkSuccess` between its own " +
        "declaration and `const handleRemoveConnection =`. Re-point these anchors."
    );
  }
  return source.slice(start, end);
}

describe("re-link completion", () => {
  it("does not call the exchange route", () => {
    const body = relinkSuccessSource(code(PAGE_SOURCE));
    expect(body).not.toContain("exchange-token");
  });

  it("still refreshes the screen", () => {
    // Red if the handler stops reloading data after the re-link, which would
    // leave the expired-connection notice and stale figures on screen.
    const body = relinkSuccessSource(code(PAGE_SOURCE));
    expect(body).toContain("fetchData()");
  });
});
