import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The cached-bank-data cleanup on disconnect must fire on SUCCESS ONLY.
 *
 * WHY THE DIRECTION IS THE WHOLE POINT
 * `usePlaidConnections.disconnect` POSTs to /api/plaid/disconnect, which returns
 * 200 only after the connection row was actually deleted. Clearing the three
 * noor_plaid_* caches on that 200 answers a CONFIRMED fact.
 *
 * Clearing them in the `catch` — or in a `finally` — answers an INFERRED one,
 * and infers it wrongly: if the POST failed, the row still exists and the bank
 * is still connected, so wiping the caches shows the user a failed operation as
 * a partial success. That is the silent-failure mode CLAUDE.md names, and it is
 * also the exact reasoning behind the "do not delete noor_plaid_connections"
 * comments in dashboard/page.tsx and money/page.tsx: a failed read is not
 * evidence of absence.
 *
 * The regression is invisible to everything else. Moving the call into the
 * catch, or into a finally, type-checks clean, renders identically on the happy
 * path, and passes every other test in this suite. Only a hand test with the
 * request blocked would catch it. This file is the cheap standing check —
 * the same argument, and the same shape, as plaidConnectionReadWiring.test.ts.
 *
 * WHAT THIS FILE PROVES AND DOES NOT PROVE
 * It reads source TEXT. It proves the call appears exactly once in the hook,
 * that it sits after the !response.ok throw and before the refetch, and that
 * neither the catch body nor any finally mentions it. It does NOT execute the
 * hook — no DOM environment exists in this repo, so no test here can touch
 * localStorage at all — so it cannot prove the three keys are the right three,
 * that the helper removes them, or that the server really returns non-2xx when
 * the delete fails. A green run here is not "nothing is cleared on failure";
 * it is "the source still routes the cleanup through the success path".
 *
 * IF THIS FILE FAILS
 * (a) The call moved into the catch/finally, or the ordering against the
 *     refetch flipped. That is the defect.
 * (b) The hook was refactored — the cleanup lifted into a helper, the guard
 *     restructured, the disconnect rewritten. Not a defect; re-point the
 *     anchors or replace this with a behavioral test once a DOM environment
 *     exists.
 */

const HOOK_SOURCE = readFileSync(
  fileURLToPath(new URL("../../hooks/usePlaidConnections.ts", import.meta.url)),
  "utf8"
);

const VALIDATION_SOURCE = readFileSync(
  fileURLToPath(new URL("../validation.ts", import.meta.url)),
  "utf8"
);

const CLEANUP_CALL = "clearPlaidLocalState()";

/**
 * The source of `disconnect` alone, bounded by the declarations either side.
 *
 * Positional, not pattern-based. An earlier version of this file matched
 * `catch (err) { ... return false; }` against the whole file and it silently
 * located the WRONG region: the first `catch (err) {` in the file belongs to
 * fetchConnections, and the first `return false;` after it is disconnect's
 * `!userId` guard, several lines ABOVE the try. The captured body therefore
 * never contained disconnect's catch at all, and the cleanup-in-the-catch
 * regression passed. Measured, then fixed — hence the bounding by declaration.
 */
function disconnectSource(source: string): string {
  const start = source.indexOf("const disconnect =");
  const end = source.indexOf("const relink =", start);
  if (start < 0 || end < 0) {
    throw new Error(
      "usePlaidConnections: could not bound `disconnect` between its own " +
        "declaration and `const relink =`. The hook was restructured; " +
        "re-point these anchors."
    );
  }
  return source.slice(start, end);
}

/**
 * `disconnect`'s catch block, from the `catch` keyword to the end of the
 * callback.
 *
 * Deliberately over-captures the callback's closing lines rather than brace
 * matching to the exact end of the block: every assertion against this body is
 * a `not.toContain`, so a body that is too LARGE can only produce a false
 * failure, never a false pass. Brace matching would buy precision in the one
 * direction that does not matter here and would add the truncation hazard.
 */
function disconnectCatchBody(): string {
  const body = disconnectSource(withoutComments(HOOK_SOURCE));
  const catchAt = body.search(/\}\s*catch\s*\(\s*err\s*\)\s*\{/);
  if (catchAt < 0) {
    throw new Error(
      "usePlaidConnections: disconnect has no `catch (err) {`. Its failure " +
        "handling changed shape — confirm a failed POST still leaves the " +
        "caches alone before re-pointing this anchor."
    );
  }
  return body.slice(catchAt);
}

/**
 * Source with `//` and block comments removed, for the keyword scans below.
 *
 * Not cosmetic: the comment that explains WHY the cleanup is not in a finally
 * necessarily contains the word `finally`, and the raw-text scan matched it and
 * went red on correct code. Measured, not hypothetical.
 *
 * The stripper is naive — it does not know strings, so a `//` or `/*` inside a
 * string literal would eat the rest of that line or block. There is none in this
 * hook. If one is added, this reads a mangled body and the failure will look
 * like a missing anchor rather than like the defect.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("plaid disconnect — local cache cleanup runs on success only", () => {
  it("calls the cleanup exactly once in the hook", () => {
    // More than one call means a second, unreviewed site — quite possibly the
    // catch. Zero means the cleanup was dropped and stale balances come back.
    const calls = HOOK_SOURCE.split(CLEANUP_CALL).length - 1;
    expect(calls).toBe(1);
  });

  it("does not clear anything in the failure path", () => {
    const body = disconnectCatchBody();

    expect(body).not.toContain(CLEANUP_CALL);
    // Nor by any other route: no direct storage access belongs in this catch.
    expect(body).not.toContain("localStorage");
    expect(body).not.toContain("removeItem");
  });

  it("has no finally on disconnect that could clear regardless of outcome", () => {
    // A `finally` would run on both outcomes, which is the same defect wearing
    // a different keyword — and it would still satisfy the catch assertion
    // above.
    const code = withoutComments(HOOK_SOURCE);
    const disconnectStart = code.indexOf("const disconnect =");
    const relinkStart = code.indexOf("const relink =");
    expect(disconnectStart).toBeGreaterThan(-1);
    expect(relinkStart).toBeGreaterThan(disconnectStart);

    const disconnectBody = code.slice(disconnectStart, relinkStart);
    expect(disconnectBody).not.toMatch(/\bfinally\b/);
  });

  it("clears after the !response.ok throw and before the refetch", () => {
    // Ordering is load-bearing in both directions. Before the throw, the
    // cleanup would run on a failed disconnect. After the refetch, a slow or
    // failing reload would leave the stale caches in place in the meantime.
    const guardAt = HOOK_SOURCE.indexOf('"Failed to disconnect"');
    const cleanupAt = HOOK_SOURCE.indexOf(CLEANUP_CALL);
    const refetchAt = HOOK_SOURCE.indexOf(
      "await fetchConnections();",
      guardAt
    );

    expect(guardAt).toBeGreaterThan(-1);
    expect(cleanupAt).toBeGreaterThan(guardAt);
    expect(refetchAt).toBeGreaterThan(cleanupAt);
  });

  it("exports a no-argument helper that removes the three Plaid keys", () => {
    // No itemId parameter: the removal is wholesale, not per-item. A signature
    // that grew an argument back would mean the pruning design returned.
    expect(VALIDATION_SOURCE).toMatch(
      /export function clearPlaidLocalState\(\): void \{/
    );

    const start = VALIDATION_SOURCE.indexOf(
      "export function clearPlaidLocalState(): void {"
    );
    const body = VALIDATION_SOURCE.slice(
      start,
      VALIDATION_SOURCE.indexOf("\n}", start)
    );

    expect(body).toContain("removeItem('noor_plaid_connections')");
    expect(body).toContain("removeItem('noor_plaid_accounts')");
    expect(body).toContain("removeItem('noor_plaid_transactions')");
  });
});
