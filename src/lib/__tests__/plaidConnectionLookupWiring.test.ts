import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The WIRING half of "a failed SINGLE-ROW read is not an absent row".
 *
 * plaidApiUtils.test.ts proves the decision is correct: connectionRowOrFailure
 * answers a query error with { ok: false } and a genuine zero-row read with
 * { ok: true, connection: null }. Those five cases pin a PURE FUNCTION and
 * nothing else, and a review measured what that leaves open — three edits that
 * keep all five green while restoring the exact defect the union was introduced
 * to remove:
 *
 *   1. getPlaidConnectionByItemId's catch returns { ok: true, connection: null }
 *      instead of { ok: false }. createServerClient() throws on missing env, so
 *      a misconfigured deployment reports "this connection is already gone".
 *   2. getPlaidConnectionByItemId stops calling connectionRowOrFailure and
 *      inlines the old `if (error || !data) return null`. The pure function
 *      stays exported and stays tested; nothing reaches it.
 *   3. /api/plaid/disconnect answers !lookup.ok with 200 { success: true } —
 *      telling the user their bank was removed while the row and its live Plaid
 *      Item both survive.
 *
 * All three type-check clean. (2) is not even silent-wrong at runtime — it
 * returns null and the caller's `!lookup.ok` throws — but it is still a revert
 * of the fix, and a revert that no test noticed is how the first version of this
 * defect survived. Each of the three was PLANTED AND MEASURED RED against this
 * file before it was trusted; the mutations were applied one at a time and
 * reverted.
 *
 * WHY A SEPARATE FILE FROM plaidConnectionReadWiring.test.ts
 * That file is the same idea for the LIST path, and it is welded to it: one
 * anchor (`allConnections === null`), one regression (the empty-case 404 whose
 * wording two screens string-match), and a RouteProbe/describe.each shape that
 * assumes every target is a route. Half of what this file has to read is not a
 * route at all — it is the helper in plaidApiUtils.ts — and neither of its two
 * anchors is that one. Folding this in would leave that file's header describing
 * two routes and one guard while the file covered three targets and three, and a
 * header that no longer matches its file is the failure mode CLAUDE.md's opening
 * section exists to prevent. The brace-matching below is deliberately duplicated
 * rather than shared: a test file that another test file imports from stops
 * being independently readable, and twenty lines is a cheaper price than that.
 *
 * WHAT THIS FILE DOES AND DOES NOT PROVE
 * It reads source TEXT. It proves the helper still routes both of its failure
 * exits into { ok: false } and still delegates the decision to the tested pure
 * function, and that disconnect still answers a failed read with a named 500 and
 * an absent row with success. It executes nothing, so it cannot prove the
 * responses are actually produced, cannot see a guard made unreachable by an
 * earlier return, and cannot survive a refactor that keeps the behaviour and
 * moves the text. A green run here is not "a failed read cannot reach the user
 * as 'removed'" — it is "the three specific reverts named above did not happen".
 *
 * IF THIS FILE FAILS, READ THE PRINTED BODY BEFORE ASSUMING A DEFECT. An anchor
 * that is not found at all throws with its own message and usually means a
 * refactor (re-point the anchor). An anchor found whose body fails the
 * assertions is the regression this file is for. The brace scan is naive — it
 * does not parse strings, comments or template literals — so an unbalanced brace
 * inside any of those truncates a body silently, exactly as measured in
 * plaidConnectionReadWiring.test.ts's guardBody.
 *
 * WHAT STAYS UNCOVERED, DELIBERATELY
 * /api/plaid/relink is not asserted on. It maps BOTH `!lookup.ok` and an absent
 * row onto the 404 it has always answered, and whether it should keep doing so
 * is an open question its own comment records. Pinning that here would make the
 * eventual deliberate change fail a test named "wiring", which is the wrong
 * signal. What protects relink meanwhile is the type checker: `{ ok: false }`
 * carries no `connection`, so a caller cannot reach the row without deciding
 * what a failed read means, and that guarantee needs no probe.
 */

/** Resolved against this file, not the cwd, so the probe survives being run from anywhere. */
function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8"
  );
}

/**
 * The braced block that follows `anchor`, by brace matching from its `{`.
 *
 * Naive on purpose, and with the same hole plaidConnectionReadWiring.test.ts
 * measured: a `}` inside a string, comment or template literal ends the scan
 * early and returns a TRUNCATED block, silently. The throw below fires only for
 * the opposite case, a block that never closes.
 */
function blockAfter(source: string, anchor: RegExp, label: string): string {
  const match = anchor.exec(source);
  if (!match) {
    throw new Error(
      `${label}: anchor ${anchor} not found. Either the branch was removed (a ` +
        `defect) or it was refactored and this probe needs re-pointing.`
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

  throw new Error(`${label}: the block opened at the anchor never closes.`);
}

const HELPER_SOURCE = "../plaidApiUtils.ts";
const DISCONNECT_SOURCE = "../../app/api/plaid/disconnect/route.ts";

const HELPER_ANCHOR =
  /export async function getPlaidConnectionByItemId\s*\([^)]*\)\s*\{/;
const HELPER_CATCH_ANCHOR = /catch\s*\(\s*error\s*\)\s*\{/;
const READ_FAILED_ANCHOR = /if\s*\(\s*!\s*lookup\.ok\s*\)\s*\{/;
const ABSENT_ROW_ANCHOR = /if\s*\(\s*!\s*lookup\.connection\s*\)\s*\{/;

function helperBody(): string {
  return blockAfter(
    read(HELPER_SOURCE),
    HELPER_ANCHOR,
    "getPlaidConnectionByItemId"
  );
}

describe("getPlaidConnectionByItemId — both failure exits stay failures", () => {
  it("delegates the decision to the pure function the suite actually tests", () => {
    // MUTATION MEASURED RED: replacing the delegation with the old
    // `if (result.error || !result.data) return null; return result.data;`
    // fails this. connectionRowOrFailure stays exported and stays green in
    // plaidApiUtils.test.ts throughout — which is the whole point of this file.
    expect(helperBody()).toContain("connectionRowOrFailure(");
  });

  it("never answers with a bare null again", () => {
    // The shape of the original defect. `null` is the value that could not say
    // which of the two things happened, and no exit here may produce one.
    expect(helperBody()).not.toMatch(/return\s+null\b/);
  });

  it("reports a thrown read as a failure, not as an absent row", () => {
    // MUTATION MEASURED RED: returning `{ ok: true, connection: null } as const`
    // from the catch fails both assertions below.
    //
    // This is the exit connectionRowOrFailure cannot cover: createServerClient()
    // throws on missing env, so the catch is a second, independent place where
    // "we do not know" has to be preserved. Getting it wrong resurrects the bug
    // through the other door — a misconfigured deployment answering every
    // disconnect with "already gone".
    const catchBody = blockAfter(
      helperBody(),
      HELPER_CATCH_ANCHOR,
      "getPlaidConnectionByItemId catch"
    );

    expect(catchBody).toMatch(/return\s*\{\s*ok:\s*false\s*\}/);
    // The object-literal property, not the word: the log line in this same
    // block legitimately contains "connection" in its message text.
    expect(catchBody).not.toMatch(/connection\s*:/);
  });
});

describe("/api/plaid/disconnect — a failed read is not a completed removal", () => {
  it("answers a failed read with a named 500, never with success", () => {
    // MUTATION MEASURED RED: replacing this guard's body with
    // `return NextResponse.json({ success: true });` fails all three.
    //
    // Answering success here is the worst available answer under the
    // revoke-before-delete rule: the row survives, its Plaid Item is still live,
    // and the user has been told their bank was removed.
    const body = blockAfter(
      read(DISCONNECT_SOURCE),
      READ_FAILED_ANCHOR,
      "/api/plaid/disconnect !lookup.ok"
    );

    expect(body).toContain("CONNECTION_READ_FAILED");
    expect(body).toMatch(/status:\s*500/);
    expect(body).not.toMatch(/success/);
  });

  it("keeps the genuine absent-row case answering success", () => {
    // The other half of the distinction, and the reason the first assertion is
    // not enough on its own: collapsing both branches into the 500 would satisfy
    // it while breaking idempotence — a retry after a disconnect that really
    // succeeded would show an error for work that is already done.
    const body = blockAfter(
      read(DISCONNECT_SOURCE),
      ABSENT_ROW_ANCHOR,
      "/api/plaid/disconnect !lookup.connection"
    );

    expect(body).toMatch(/success:\s*true/);
    expect(body).not.toContain("CONNECTION_READ_FAILED");
  });

  it("decides the failed read before the absent row can absorb it", () => {
    // Ordering is load-bearing and invisible to the type checker. `{ ok: false }`
    // has no `connection` property, so `!lookup.connection` on a failed read is
    // truthy — placing the absence branch first would answer every failed read
    // with success while every assertion above still passed.
    const source = read(DISCONNECT_SOURCE);
    const failedAt = READ_FAILED_ANCHOR.exec(source)?.index ?? -1;
    const absentAt = ABSENT_ROW_ANCHOR.exec(source)?.index ?? -1;

    expect(failedAt).toBeGreaterThan(-1);
    expect(absentAt).toBeGreaterThan(-1);
    expect(failedAt).toBeLessThan(absentAt);
  });
});
