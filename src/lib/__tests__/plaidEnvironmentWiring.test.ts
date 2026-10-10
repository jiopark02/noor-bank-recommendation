import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * ONE VALUE, BOTH ENDS — the wiring behind the revocation fold's third condition.
 *
 * WHAT THE FOLD ASSUMES
 * plaidRevocation.ts deletes a row on an ITEM_NOT_FOUND rejection only when the
 * token's environment segment matches `deps.plaidEnvironment`. That comparison is
 * worth nothing unless the value compared against is the environment the
 * itemRemove call ACTUALLY went to. Two ends have to hold:
 *
 *   1. liveRevocationDeps passes PLAID_ENVIRONMENT, not a literal and not a
 *      second derivation of it.
 *   2. the Plaid client's basePath is built from that same constant.
 *
 * Break either and the guard still runs, still compares two strings, and still
 * looks right — while comparing a token against an environment the request never
 * reached. A hardcoded "sandbox" in liveRevocationDeps on a production deployment
 * would fold production tokens; a basePath built from something else would send
 * the call somewhere the comparison never knew about.
 *
 * WHY THIS IS A SOURCE PROBE AND NOT AN EXECUTED TEST
 * plaidRevocation.test.ts reaches the decision by injecting deps, which is
 * exactly what makes it unable to see the production wiring: liveRevocationDeps
 * is never called there, so a mutation inside it passes every assertion in that
 * file. plaidEnvironmentName.test.ts has the mirror gap — it proves the mapping
 * and the URL equivalence, but does not inspect the Configuration plaid.ts
 * builds. This file covers the seam neither of them can reach, the same way
 * plaidTokenReadSites.test.ts guards a call that no test executes.
 *
 * WHY A SEPARATE FILE. plaidTokenReadSites.test.ts is about one subject — every
 * site that reads access_token — and this is a different one. A header that no
 * longer matches its file is the failure mode CLAUDE.md's opening section exists
 * to prevent.
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT
 * It reads source TEXT. It proves the two spellings are present where they must
 * be; it executes nothing, cannot see a constant that was reassigned elsewhere,
 * and cannot survive a refactor that keeps the behaviour and moves the text. A
 * green run here is "neither end was quietly rewired", not "the guard compares
 * the right environment".
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
 * Duplicated from plaidConnectionLookupWiring.test.ts rather than shared: a test
 * file that another test file imports from stops being independently readable.
 * Same known hole, too — a `}` inside a string, comment or template literal ends
 * the scan early and returns a TRUNCATED block, silently.
 */
function blockAfter(source: string, anchor: RegExp, label: string): string {
  const match = anchor.exec(source);
  if (!match) {
    throw new Error(
      `${label}: anchor ${anchor} not found. Either the wiring was removed (a ` +
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

const REVOCATION_SOURCE = "../plaidRevocation.ts";
const PLAID_SOURCE = "../plaid.ts";

const LIVE_DEPS_ANCHOR =
  /export function liveRevocationDeps\s*\([^)]*\)\s*:\s*RevocationDeps\s*\{/;

describe("the revocation guard compares against the environment it calls", () => {
  it("passes the shared constant into the revocation deps", () => {
    // MUTATION: `plaidEnvironment: "sandbox"` — or any other literal — fails
    // here, and fails nothing else in the suite.
    const body = blockAfter(
      read(REVOCATION_SOURCE),
      LIVE_DEPS_ANCHOR,
      "liveRevocationDeps"
    );

    expect(body).toContain("plaidEnvironment: PLAID_ENVIRONMENT");
  });

  it("does not re-derive the environment at the deps", () => {
    // The other shape of the same defect: calling resolvePlaidEnvironment()
    // here would be correct today and is still wrong, because it is a SECOND
    // derivation of one fact. The constant is computed once, at import, and the
    // basePath is built from that same evaluation; a call here reads process.env
    // again and can disagree with what the client was actually built with.
    const body = blockAfter(
      read(REVOCATION_SOURCE),
      LIVE_DEPS_ANCHOR,
      "liveRevocationDeps"
    );

    expect(body).not.toContain("resolvePlaidEnvironment(");
    expect(body).not.toContain("process.env");
  });

  it("builds the client's basePath from that same constant", () => {
    // The far end. Without this, the guard can be comparing against a value that
    // has nothing to do with where the itemRemove request went.
    //
    // MUTATION: `PlaidEnvironments[resolvePlaidEnvironment(...).name]`, or any
    // other basePath expression, fails here.
    const source = read(PLAID_SOURCE);

    expect(source).toContain("basePath: PlaidEnvironments[PLAID_ENVIRONMENT]");
  });

  it("keeps the constant a single exported evaluation", () => {
    // If PLAID_ENVIRONMENT stopped coming from the one resolution of PLAID_ENV,
    // both assertions above could pass while the two ends read different
    // things. The resolution itself must be the only read of process.env.
    const source = read(PLAID_SOURCE);

    expect(source).toMatch(
      /const RAW_PLAID_ENV:\s*string \| undefined\s*=\s*process\.env\.PLAID_ENV;/
    );
    expect(source).toMatch(
      /const PLAID_ENV_RESOLUTION\s*=\s*resolvePlaidEnvironment\(RAW_PLAID_ENV\);/
    );
    expect(source).toMatch(
      /export const PLAID_ENVIRONMENT:\s*PlaidEnvironmentName\s*=\s*\n?\s*PLAID_ENV_RESOLUTION\.name;/
    );
    expect(source.match(/resolvePlaidEnvironment\(/g)).toHaveLength(2);
  });
});

describe("an unrecognized PLAID_ENV disables Plaid", () => {
  it("isPlaidConfigured reads the recognition flag from the same resolution", () => {
    // plaidEnvironmentGate.test.ts executes this; the probe pins that the flag
    // is the import-time constant and not a second read of process.env.PLAID_ENV.
    // MUTATION: dropping `&& PLAID_ENV_RECOGNIZED` fails here.
    const source = read(PLAID_SOURCE);
    const body = blockAfter(
      source,
      /export function isPlaidConfigured\s*\(\s*\)\s*:\s*boolean\s*\{/,
      "isPlaidConfigured"
    );

    expect(source).toMatch(
      /export const PLAID_ENV_RECOGNIZED:\s*boolean\s*=\s*PLAID_ENV_RESOLUTION\.recognized;/
    );
    expect(body).toContain("PLAID_ENV_RECOGNIZED");
    expect(body).not.toContain("process.env.PLAID_ENV");
  });

  it("reads process.env.PLAID_ENV exactly once, and the log does not re-read it", () => {
    // A second read is where the old log line quoted the raw value from. One
    // read means the log can only see what the module-private constant holds.
    // MUTATION: restoring `JSON.stringify(process.env.PLAID_ENV)` in the log, or
    // any other second read, fails here.
    const source = read(PLAID_SOURCE);

    expect(source.match(/process\.env\.PLAID_ENV\b/g)).toHaveLength(1);
    expect(source).not.toContain("JSON.stringify(process.env.PLAID_ENV)");
  });
});
