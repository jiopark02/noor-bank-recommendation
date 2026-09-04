import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * PL1 — the exhaustiveness probe for plaid_connections.access_token.
 *
 * WHAT IT IS FOR
 * The column now holds ciphertext. Every place that reads it must run the value
 * through decryptPlaidAccessToken before it can be given to the Plaid SDK. Miss
 * one and that feature breaks at runtime — not at build time, because the
 * column's type is still `string` and ciphertext is a perfectly good string.
 * tsc cannot see the difference and neither can any unit test of the crypto
 * module. So the guarantee has to be a probe over the source.
 *
 * WHY A FILE-LEVEL ALLOW-LIST RATHER THAN A LINE-LEVEL ONE
 * The two helpers in plaidApiUtils that return token-bearing rows use
 * `select("*")`, so the column name does not appear at the query. A probe that
 * looked for `access_token` in queries would therefore find two of the three
 * read paths and miss the ones that matter most. Working from the set of FILES
 * that mention the identifier at all is the coarser but honest version: a new
 * read site has to touch a file, and a file that is not on this list fails the
 * test the moment it does.
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT
 * It proves that no file outside the recorded set mentions `access_token`, and
 * that in each of the five consuming routes the read is textually wrapped in a
 * decrypt call. It does NOT execute anything. It cannot prove the decrypt is
 * reached at runtime, cannot see a decrypt whose result is then discarded, and
 * cannot follow the value through a rename or a helper.
 *
 * One more limit, specific to the third assertion below: it matches ONE LINE AT
 * A TIME, so `access_token: connection.access_token` split across two lines —
 * which is what a formatter does as soon as the surrounding call grows — does
 * not match and the regression goes unreported. Its comment filter is
 * line-oriented for the same reason and only skips lines whose first non-space
 * characters are `//` or `*`; a trailing comment on a code line is still
 * scanned. Widening it means matching across newlines, not adding more
 * patterns. Until then the first two assertions are the load-bearing ones: they
 * catch a new read site and a consuming site with no decrypt call at all, which
 * is how this regression actually arrives. It is a wiring probe,
 * exactly like plaidConnectionReadWiring.test.ts, and a green run here is not
 * proof that ciphertext never reaches Plaid — it is proof that nobody added a
 * read site without being told about this file.
 *
 * IF THIS FILE FAILS
 *  (a) "unexpected file mentions access_token" — a new read or write site. STOP
 *      and check it: does it need to decrypt, and does it have a verified-token
 *      userId to decrypt with? Add it to the right list below only after that.
 *  (b) "expected file no longer mentions access_token" — a site was removed or
 *      renamed. Prune the list; do not delete the assertion.
 *  (c) "reads access_token without decrypting" — the regression this exists to
 *      catch. Ciphertext is on its way to the Plaid SDK.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

/** The identifier this probe tracks, split so the probe never matches itself. */
const IDENTIFIER = ["access", "token"].join("_");

/**
 * Files that legitimately mention the identifier and that CONSUME a stored
 * token — every one of these must decrypt before use.
 */
const CONSUMING_SITES = [
  "app/api/plaid/accounts/route.ts",
  "app/api/plaid/transactions/route.ts",
  "app/api/plaid/relink/route.ts",
  "app/api/account/delete/route.ts",
  "lib/plaidChatState.ts",
];

/**
 * Files that mention the identifier for another reason entirely. Each is
 * annotated with WHY, so a future reader can tell an allowance from an
 * oversight without opening the file.
 */
const NON_CONSUMING_SITES: Record<string, string> = {
  // The crypto boundary itself.
  "lib/plaidTokenCrypto.ts": "defines the encryption of the column",
  // The single write site, plus the row-shape doc comment.
  "lib/plaidApiUtils.ts": "the only write site; encrypts before insert",
  // Holds a Plaid response field, never a stored value.
  "app/api/plaid/exchange-token/route.ts":
    "reads the token off the Plaid exchange response, before storage",
  // Comments only — these files name the identifier to say they exclude it.
  "app/api/plaid/connections/route.ts": "comment: deliberately not selected",
  "app/api/account/export/route.ts": "comment: deliberately not exported",
  // Comment only. This route deletes the row and never reads the column — it
  // imports neither plaidClient nor any read helper. The comment describes the
  // itemRemove call it does NOT make; that gap is tracked separately and is
  // deliberately untouched here.
  "app/api/plaid/disconnect/route.ts":
    "comment: describes an itemRemove this route does not perform",
  "lib/plaid.ts": "comment: axios error redaction rationale",
  "lib/plaidErrorRedaction.ts": "comment: axios error redaction rationale",
  // Supabase SESSION tokens. Same spelling, unrelated to plaid_connections —
  // these are the JWTs sent as Authorization headers.
  "lib/supabase-browser.ts": "Supabase session access_token, not Plaid",
  "app/auth/callback/page.tsx": "Supabase session access_token, not Plaid",
  "app/survey/page.tsx": "Supabase session access_token, not Plaid",
  // NOT LISTED, and it is not an oversight: src/hooks/usePlaidConnections.ts
  // has a field called `accessToken` that actually carries a Plaid Link PUBLIC
  // token. It is camelCase, so this probe — which tracks the snake_case column
  // identifier — does not see it, and it must not be added here: doing so would
  // fail the "expected file no longer mentions" assertion on every run.
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Every non-test source file mentioning the identifier, as posix-ish paths. */
function filesMentioningIdentifier(): string[] {
  return walk(SRC)
    .filter((file) => readFileSync(file, "utf8").includes(IDENTIFIER))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .sort();
}

describe("PL1 — every access_token site is accounted for", () => {
  it("no file outside the recorded set mentions the identifier", () => {
    const expected = [
      ...CONSUMING_SITES,
      ...Object.keys(NON_CONSUMING_SITES),
    ].sort();

    const actual = filesMentioningIdentifier();

    // Reported as two directed differences rather than one equality, because
    // "someone added a read site" and "someone removed one" need different
    // responses and the assertion should say which happened.
    const unexpected = actual.filter((f) => !expected.includes(f));
    const missing = expected.filter((f) => !actual.includes(f));

    expect(
      unexpected,
      "unexpected file mentions access_token — a new read or write site? " +
        "It must decrypt before use. See this file's header."
    ).toEqual([]);
    expect(
      missing,
      "expected file no longer mentions access_token — prune the list above"
    ).toEqual([]);
  });

  it("every consuming site decrypts before use", () => {
    for (const relative of CONSUMING_SITES) {
      const source = readFileSync(path.join(SRC, relative), "utf8");
      expect(
        source.includes("decryptPlaidAccessToken("),
        `${relative} reads ${IDENTIFIER} but never calls decryptPlaidAccessToken`
      ).toBe(true);
    }
  });

  it("no consuming site hands a stored row field straight to the Plaid SDK", () => {
    // The specific regression: `access_token: connection.access_token` (or any
    // `<something>.access_token`) as an SDK argument. After this change the only
    // legal SDK argument is a decrypted local.
    const offenders: string[] = [];
    for (const relative of CONSUMING_SITES) {
      const source = readFileSync(path.join(SRC, relative), "utf8");
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) {
          return;
        }
        if (new RegExp(`${IDENTIFIER}:\\s*\\w+\\.${IDENTIFIER}`).test(line)) {
          offenders.push(`${relative}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "a stored (encrypted) field is being passed as a Plaid SDK access_token"
    ).toEqual([]);
  });

  it("the single write site encrypts", () => {
    const source = readFileSync(path.join(SRC, "lib/plaidApiUtils.ts"), "utf8");
    expect(source).toContain("encryptPlaidAccessToken(");
    // The insert must use the encrypted local, never the raw parameter. This is
    // the line that would silently reintroduce plaintext storage.
    expect(source).toContain(`${IDENTIFIER}: encryptedAccessToken`);
    expect(source).not.toContain(`${IDENTIFIER}: accessToken`);
  });
});
