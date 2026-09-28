import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * /api/plaid/disconnect refuses before it reads anything when the service-role
 * key is missing.
 *
 * WHAT THE GATE IS FOR
 * createServerClient() now throws on a missing service-role key. Without this
 * gate that throw lands inside authenticate(), which catches it and reports "no
 * user", so the route answers 401 and the fault reads as the caller's sign-in
 * problem rather than as our configuration. The gate names it instead.
 *
 * The gate was written against the behaviour that preceded that throw: the
 * client fell back to the anon key and attached no user JWT, so `auth.uid()` was
 * NULL. Every policy on plaid_connections is `(auth.uid())::text = user_id`
 * (live schema as observed 2026-09-25), so in that deployment the row lookup
 * matched zero rows, this route read that as "already gone", and answered
 * 200 { success: true } while the row and its live Plaid Item both survived.
 * The user was told their bank was removed when it was not.
 *
 * /api/account/delete has refused on exactly this condition since before the
 * revocation work (accountDeletion.ts, step 1a). This route did not, and the
 * asymmetry was invisible: both routes reach the same helpers, and the helpers
 * cannot tell which key they were built with.
 *
 * WHY THIS IS A SOURCE PROBE AND NOT AN EXECUTED TEST
 * The route cannot be executed offline. It authenticates first and nothing in
 * this suite fakes that boundary — plaidConnectionReadWiring.test.ts explains at
 * length why it declined to cut a seam through it, and accountDeletion.ts exists
 * because the same problem was solved there by moving the DECISION out of the
 * route instead. That option is not available here: this gate is a precondition
 * on the route's own first statements, not a decision with a seam around it.
 *
 * ⚠️ SO THIS FILE CANNOT OBSERVE A CALL THAT DID NOT HAPPEN. It proves the guard
 * is present and that it appears before the reads in source order. It does NOT
 * prove the lookup and the revocation are skipped at runtime — an early return
 * made unreachable by an edit above it would pass here. What closes that gap is
 * reading the route and the live verification, not this file.
 *
 * WHY A SEPARATE FILE FROM plaidConnectionLookupWiring.test.ts
 * That file's header declares three specific reverts it exists to catch, all
 * about a failed read not being an absent row. This is a fourth subject. Folding
 * it in would leave that header describing a file it no longer matches, which is
 * the failure mode CLAUDE.md's opening section exists to prevent.
 */

/** Resolved against this file, not the cwd, so the probe survives being run from anywhere. */
function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8"
  );
}

/**
 * The source with its comments removed, so an assertion can be about the CODE.
 *
 * Needed because the gate's own comment names the environment variable it exists
 * to talk about, and an assertion over the raw text could not tell that apart
 * from the code reading the variable directly.
 *
 * ⚠️ REGEX-LEVEL, WITH THE LIMITS THAT IMPLIES. It does not parse: a `//` or a
 * `/*` inside a string or template literal is treated as the start of a comment
 * and everything after it on that line is dropped. The `[^:]` guard keeps the
 * common case — a `https://` URL in a string — from being mangled, and nothing
 * more. If an assertion below ever fails inexplicably, check whether this
 * function ate a line it should not have before assuming a defect in the route.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The braced block that follows `anchor`, by brace matching from its `{`.
 *
 * Duplicated from plaidConnectionLookupWiring.test.ts rather than shared, for the
 * reason that file gives: a test file another test file imports from stops being
 * independently readable. Same known hole — a `}` inside a string, comment or
 * template literal ends the scan early and returns a TRUNCATED block, silently.
 */
function blockAfter(source: string, anchor: RegExp, label: string): string {
  const match = anchor.exec(source);
  if (!match) {
    throw new Error(
      `${label}: anchor ${anchor} not found. Either the guard was removed (a ` +
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

const DISCONNECT_SOURCE = "../../app/api/plaid/disconnect/route.ts";
const ADMIN_GATE_ANCHOR = /if\s*\(\s*!\s*isSupabaseAdminConfigured\(\)\s*\)\s*\{/;

/** First index of `needle` in the source, or -1. Plain text, not a regex. */
function indexOf(source: string, needle: string): number {
  return source.indexOf(needle);
}

describe("/api/plaid/disconnect — the service-role key is a precondition", () => {
  it("refuses with a named 503 and never with success", () => {
    // MUTATION: deleting the guard fails all three assertions; answering
    // { success: true } in its body fails the last two.
    const body = blockAfter(
      read(DISCONNECT_SOURCE),
      ADMIN_GATE_ANCHOR,
      "/api/plaid/disconnect !isSupabaseAdminConfigured()"
    );

    expect(body).toContain("ADMIN_UNCONFIGURED");
    expect(body).toMatch(/status:\s*503/);
    expect(body).not.toMatch(/success/);
  });

  it("uses the same code string /api/account/delete uses for this fault", () => {
    // One fault, one name in the logs. The two routes answer with different
    // statuses on purpose — each matches its own route's convention — but a
    // support conversation and a log search key on the code.
    const accountDeletion = read("../accountDeletion.ts");

    expect(accountDeletion).toContain("ADMIN_UNCONFIGURED");
  });

  it("checks the key before anything reads the database", () => {
    // ORDERING IS THE WHOLE GUARANTEE and it is invisible to the type checker.
    // authenticate() builds a createServerClient of its own, so a gate placed
    // after it never runs on a deployment missing the key — the construction
    // throws there, is caught, and the route has already answered 401 under a
    // name that blames the caller. A gate after the lookup is worthless for the
    // same reason plus one more: the lookup is where a wrong answer would be
    // produced.
    //
    // MUTATION: moving the guard below `authenticate(request)` fails this.
    const source = read(DISCONNECT_SOURCE);

    const gateAt = ADMIN_GATE_ANCHOR.exec(source)?.index ?? -1;
    const authAt = indexOf(source, "await authenticate(request)");
    const lookupAt = indexOf(source, "await getPlaidConnectionByItemId(");
    const revokeAt = indexOf(source, "await revokeAndDeleteConnection(");

    expect(gateAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(-1);
    expect(lookupAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeGreaterThan(-1);

    expect(gateAt).toBeLessThan(authAt);
    expect(authAt).toBeLessThan(lookupAt);
    expect(lookupAt).toBeLessThan(revokeAt);
  });

  it("asks the predicate rather than reading the variable itself", () => {
    // isSupabaseAdminConfigured reads the same module-scope service role key
    // that createServerClient requires, so the two cannot disagree about that
    // key. Re-reading the environment here would be a second source of truth
    // for one fact.
    //
    // Asserted over the code only: the gate's comment names the variable
    // deliberately, and that is documentation, not a read.
    const code = withoutComments(read(DISCONNECT_SOURCE));

    expect(code).toContain("isSupabaseAdminConfigured");
    expect(code).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(code).not.toContain("process.env");
  });
});
