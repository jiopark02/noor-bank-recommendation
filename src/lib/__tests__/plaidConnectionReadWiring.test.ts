import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The WIRING half of "a failed connection read is not an empty one".
 *
 * `plaidApiUtils.test.ts` proves the decision is correct: connectionRowsOrNull
 * returns null for a failed read and [] for a genuine empty one. Correct and
 * misused is worth nothing. The user-visible half of that fix lives in the two
 * data routes, in how they SPEND the null — and that half had no check at all.
 *
 * WHAT ALREADY COVERS THE ROUTES, AND WHAT DOES NOT
 * Deleting the null guard outright is already caught, by the type checker rather
 * than by this suite: `allConnections` is `PlaidConnectionView[] | null`, so the
 * `.filter(...)` on the next line fails with TS18047 and the Vercel build goes
 * red. That is the branch's EXISTENCE.
 *
 * Its DIRECTION is unguarded. Answering the null with the empty-case 404 —
 *
 *     if (allConnections === null) {
 *       return NextResponse.json(
 *         { error: "No active bank connections found. Please connect a bank first." },
 *         { status: 404 }
 *       );
 *     }
 *
 * — is exactly the behavior this change exists to remove, and it type-checks
 * clean and passes every other test in the suite. That regression is what this
 * file is here to fail on. It is a plausible regression rather than a contrived
 * one: the 404 sits a few lines below the guard, and "no connections" is the
 * reading the null invites.
 *
 * Why the direction matters: the 404's wording is string-matched by two screens.
 * money/page.tsx shows the connect-a-bank card on it (pushing an already
 * connected user toward a duplicate connection row) and dashboard/page.tsx
 * clears its cached accounts and transactions. A database hiccup must not reach
 * either. A generic 500 — what handlePlaidError produces for an error carrying
 * no Plaid error_code — matches neither, which is the point of throwing here.
 *
 * IF THIS FILE FAILS, IT IS ONE OF THREE THINGS — AND ONLY ONE IS A DEFECT
 * (a) A direction regression: the guard is still there, but it now answers with
 *     a response instead of handing the failure to the outer catch. That IS the
 *     bug this file exists to catch, and it is user-visible.
 * (b) A refactor that moved the anchor: the guard was renamed, restructured, or
 *     lifted into a helper, with the behavior intact. That is NOT a defect —
 *     this file reads source TEXT, so it is fragile to exactly that. Re-point
 *     the anchor, or replace this file with the behavioral line described below.
 * (c) The brace scan truncated a correct guard: an unbalanced `}` inside a
 *     string, comment or template literal in the guard body ends the scan early,
 *     and the assertions then judge a fragment. NOT a defect either. See
 *     guardBody — this is measured behavior, not a hypothetical.
 * (b) is the one the locator names: the anchor is not found at all and the
 * failure is its explicit "no guard found" error. (a) and (c) both present as
 * "the guard was found and its contents failed", so the locator does not
 * separate them — READ THE PRINTED BODY IN THE FAILURE. Under (a) it is the
 * whole guard and it really does return a response; under (c) it stops
 * mid-statement, at the stray brace.
 *
 * WHAT THIS FILE DOES AND DOES NOT PROVE
 * It proves that the source of each route still routes a null read away from the
 * empty-case 404 and into a throw — unless the guard body defeats the brace scan
 * (see guardBody, where that hole is measured). It does NOT execute either
 * route, so it
 * cannot prove the resulting response is a 500, cannot catch a logic error that
 * keeps the right shape (a guard comparing the wrong variable, say, or one made
 * unreachable by an earlier return), and cannot see any of this through a
 * refactor. It is a wiring probe, not a behavioral proof — do not read a green
 * run here as "a failed read cannot reach the user as 'no bank connected'".
 *
 * A real behavioral regression line — calling the handler and asserting on the
 * response — needs the route reached with the connection read forced to fail.
 * The route authenticates first, and passing `authenticate()` offline requires
 * either a mock or a dependency seam cut through the auth boundary in production
 * code.
 *
 * Two different statements about mocks, and only one of them is still true.
 * THIS FILE uses no mock, and needs none: it reads source text. THE SUITE is not
 * mock-free — plaidConnectionReadSeam.test.ts fakes the server-client factory to
 * reach the read helper behind the routes, and it landed alongside this file. An
 * earlier version of this sentence said mocks were deliberately not used in the
 * suite; that stopped being true the moment that file existed, and saying it here
 * would now be a description of the suite that the suite contradicts.
 *
 * What has NOT changed is the auth seam. Nothing anywhere fakes `authenticate()`
 * or the token verification behind it, and the existence of one mock elsewhere is
 * not an argument for adding that one — the reason it was left alone is that
 * faking an auth boundary in order to test a route is a much larger decision than
 * faking a client factory in order to test a database read. That remains a
 * separate track. Until it is taken, this file is the available check and the
 * limits above are the honest statement of what stays uncovered.
 */

type RouteProbe = {
  label: string;
  relativePath: string;
};

const ROUTES: RouteProbe[] = [
  {
    label: "/api/plaid/accounts",
    relativePath: "../../app/api/plaid/accounts/route.ts",
  },
  {
    label: "/api/plaid/transactions",
    relativePath: "../../app/api/plaid/transactions/route.ts",
  },
];

/** Resolved against this file, not the cwd, so the probe survives being run from anywhere. */
function readRoute(probe: RouteProbe): string {
  return readFileSync(
    fileURLToPath(new URL(probe.relativePath, import.meta.url)),
    "utf8"
  );
}

const GUARD_ANCHOR = /if\s*\(\s*allConnections\s*===\s*null\s*\)\s*\{/;

/** The exact wording the two screens string-match. A contract, not a label. */
const EMPTY_CASE_MESSAGE =
  "No active bank connections found. Please connect a bank first.";

/**
 * The body of the null guard, by brace matching from the anchor.
 *
 * Brace counting here is naive: it does not parse strings, comments or template
 * literals. An unbalanced `}` inside any of those ends the scan early, and what
 * comes back is a TRUNCATED body — silently. The explicit throw below fires only
 * when the scan reaches the end of the file without ever closing, which is the
 * opposite situation and does not cover this one.
 *
 * So a truncated body can pass while the route is wrong. Measured on this repo:
 * with the accounts route answering the null with the empty-case 404 and a `}`
 * placed in a comment above that return, all four assertions passed and tsc
 * stayed clean. It can also fail while the route is right — a `}` inside a
 * string ahead of the throw cuts the throw out of the body and the first
 * assertion goes red on correct code. Measured the same way.
 *
 * Both directions need the truncated prefix to read a particular way (the pass
 * needs the word `throw` still inside it), so neither arrives by accident. But
 * nothing here prevents either, and the counter cannot tell you it happened.
 *
 * What the counter IS reliable for is the regression this file targets: a plain
 * revert to `{ error: ... }, { status: 404 }` counts out even, so the body is
 * whole and the assertions see all of it. That case is measured red.
 */
function guardBody(source: string, label: string): string {
  const match = GUARD_ANCHOR.exec(source);
  if (!match) {
    throw new Error(
      label +
        ": no `if (allConnections === null) {` guard found. Either the null " +
        "branch was removed (a defect — see case (a) in this file's header) or " +
        "it was refactored and this probe's anchor needs re-pointing (case (b))."
    );
  }

  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }

  throw new Error(label + ": the null guard's block never closes.");
}

describe.each(ROUTES)(
  "$label — a failed connection read is not answered as an empty one",
  (probe) => {
    it("hands the null to the outer catch rather than returning a response", () => {
      const body = guardBody(readRoute(probe), probe.label);

      // The whole point: the failure leaves this branch as a throw, so it lands
      // in the route's own catch and is mapped to a generic 500.
      expect(body).toMatch(/\bthrow\b/);

      // And it must NOT construct an answer of its own. Any of these three means
      // the branch decided what the user's connection state is, which is the one
      // thing a failed read does not know.
      expect(body).not.toMatch(/\breturn\b/);
      expect(body).not.toContain("NextResponse");
      expect(body).not.toContain("404");
    });

    it("does not reuse the empty-case wording for a failed read", () => {
      // The specific regression: the 404 below is the reading the null invites,
      // and its message is the string both screens key on.
      expect(guardBody(readRoute(probe), probe.label)).not.toContain(
        EMPTY_CASE_MESSAGE
      );
    });

    it("decides the null before the empty case can absorb it", () => {
      const source = readRoute(probe);
      const guardAt = GUARD_ANCHOR.exec(source)?.index ?? -1;

      // Ordering is load-bearing. A guard placed after the length check would
      // read correctly and type-check while never running for a null.
      expect(guardAt).toBeGreaterThan(-1);
      expect(guardAt).toBeLessThan(source.indexOf(EMPTY_CASE_MESSAGE));
    });

    it("keeps the genuine empty case intact, on the active-connection count", () => {
      const source = readRoute(probe);

      // The other half of the distinction. Deleting this 404 would also satisfy
      // the assertions above, and would take the connect-a-bank affordance with
      // it — the genuine empty case is supposed to reach that wording.
      expect(source).toContain(EMPTY_CASE_MESSAGE);
      expect(source).toMatch(/activeConnections\.length\s*===\s*0/);
    });
  }
);
