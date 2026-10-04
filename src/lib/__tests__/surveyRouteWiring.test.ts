import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe of POST /api/survey's wiring for the email/password signup
 * path: the route hands the decision to createEmailAccount, passes the real
 * pause gate, and its adapters pass values through without deciding anything.
 * emailSignup.test.ts executes the decision itself; this file does not execute
 * the route.
 *
 * Mutations of route.ts and the tests each one turns red:
 *   R1  the gate passed as a constant (() => false)            -> W2
 *   R2  the gate function's body changed to return a constant  -> W2
 *   R3  createUser attributes rebuilt in the adapter           -> W3
 *   R4  .catch restored on the delete, result discarded        -> W4
 *   R5  the delete adapter returns error: null                 -> W4
 *   R6  createEmailAccount bypassed                            -> W1
 *   R7  the result status replaced with a constant             -> W1
 *   R8  users or survey_responses insert retargeted            -> W5
 *   R9  the duplicate-email lookup retargeted or its error lost -> W6
 *   R10 the stored-name lookup removed or moved after the update -> W7
 *   R11 a lookup error that does not return before any write  -> W7
 *   R12 decideNameUpdate bypassed                              -> W7
 *   R13 users inserted or upserted on the signed-in path       -> W7
 *   R14 the placeholder written as a literal in the route      -> W8
 *   R15 the signed-in response skipping firstNameForClient     -> W8
 *
 * Two masked views of the source are used, as in
 * syncProfileRouteWiring.test.ts: `code` has comments and string contents
 * blanked; `codeWithStrings` has only comments blanked. Whitespace is
 * collapsed in both.
 */

const ROUTE = fileURLToPath(
  new URL("../../app/api/survey/route.ts", import.meta.url)
);

/** Comments become spaces; with blankStrings, so do literal contents. */
function mask(src: string, blankStrings: boolean): string {
  const out = src.split("");
  const n = src.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      if (blankStrings) blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

const source = readFileSync(ROUTE, "utf8");
const code = mask(source, true).replace(/\s+/g, " ");
const codeWithStrings = mask(source, false).replace(/\s+/g, " ");

/** The text from `start` up to (not including) `end`; both must be present. */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `${start} must be present`).not.toBe(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to, `${end} must follow ${start}`).not.toBe(-1);
  return text.slice(from, to);
}

describe("survey route wiring: email/password signup", () => {
  it("W1 the unauthenticated path returns createEmailAccount's result as is", () => {
    const block = between(code, "if (!authUserId) {", "const userId = authUserId;");
    expect(block).toMatch(/const result = await createEmailAccount\(/);
    expect(block).toMatch(
      /return NextResponse\.json\( ?result\.body, ?\{ ?status: ?result\.status ?\} ?\)/
    );
  });

  it("W2 passes the real SIGNUP_DISABLED gate", () => {
    const block = between(code, "createEmailAccount(", "createAuthUser:");
    expect(block).toMatch(/\{ ?isSignupDisabled, ?$|isSignupDisabled: isSignupDisabled,/);
    expect(codeWithStrings).toMatch(
      /function isSignupDisabled\(\): boolean \{ return process\.env\.SIGNUP_DISABLED === "true"; \}/
    );
  });

  it("W3 the createUser adapter passes the attributes through unchanged", () => {
    const block = between(code, "createAuthUser:", "insertProfile:");
    expect(block).toMatch(/async \( ?attributes ?\) =>/);
    expect(block).toMatch(/\.auth\.admin\.createUser\( ?attributes ?\)/);
    expect(block).toMatch(/return \{ userId: data\?\.user\?\.id \?\? null, error \}/);
    expect(code).not.toMatch(/\bemail_confirm\b/);
    expect(code).not.toMatch(/\buser_metadata\b/);
  });

  it("W4 the delete adapter returns the admin API's error instead of catching it", () => {
    const block = between(code, "deleteAuthUser:", "insertSurveyResponse:");
    expect(block).toMatch(
      /const \{ error \} = await supabaseAdmin\.auth\.admin\.deleteUser\( ?userId ?\)/
    );
    expect(block).toMatch(/return \{ error \}/);
    expect(block).not.toMatch(/\.catch\(/);
    expect(code).not.toMatch(/deleteUser\([^)]*\)\s*\.catch\(/);
  });

  it("W5 the insert adapters target users and survey_responses", () => {
    const profile = between(codeWithStrings, "insertProfile:", "deleteAuthUser:");
    expect(profile).toMatch(/\.from\("users"\) ?\.insert\( ?row ?\)/);
    const survey = between(codeWithStrings, "insertSurveyResponse:", "sendWelcomeEmail");
    expect(survey).toMatch(/\.from\("survey_responses"\) ?\.insert\( ?buildSurveyRow\( ?userId, ?surveyData, ?now ?\) ?\)/);
  });

  it("W6 the duplicate-email lookup reads users by the email it is given and returns its error", () => {
    const block = between(codeWithStrings, "findProfileByEmail:", "now:");
    expect(block).toMatch(/async \( ?email ?\) =>/);
    expect(block).toMatch(
      /\.from\("users"\) ?\.select\("id"\) ?\.eq\("email", ?email ?\) ?\.maybeSingle\(\)/
    );
    expect(block).toMatch(/return \{ found: !!data, error \}/);
    expect(block).not.toMatch(/\.(insert|upsert|update|delete)\(/);
  });
});

describe("survey route wiring: signed-in names", () => {
  const signedIn = codeWithStrings.slice(
    codeWithStrings.indexOf("const userId = authUserId;")
  );

  it("W7 reads the stored names, stops on a failed read, and writes only what decideNameUpdate returns", () => {
    expect(signedIn.length).toBeGreaterThan(0);
    const lookup = signedIn.search(
      /\.from\("users"\) ?\.select\("first_name, last_name"\) ?\.eq\("id", ?userId ?\) ?\.maybeSingle\(\)/
    );
    const stop = signedIn.indexOf("if (lookupError) {");
    const update = signedIn.indexOf(".update(profileUpdate)");
    const surveyWrite = signedIn.indexOf('.from("survey_responses")');
    expect(lookup).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(lookup);
    expect(update).toBeGreaterThan(stop);
    expect(surveyWrite).toBeGreaterThan(update);

    const stopBlock = between(signedIn, "if (lookupError) {", "const profileUpdate");
    expect(stopBlock).toMatch(/return NextResponse\.json\(/);

    expect(signedIn).toMatch(
      /const profileUpdate: Record<string, unknown> = \{ updated_at: now, \.\.\.\(decideNameUpdate\( ?storedNames, ?firstName ?\) \?\? \{\}\), \};/
    );
    expect(signedIn).not.toMatch(/profileUpdate\.(first_name|last_name) =/);
    expect(signedIn).not.toMatch(/\.from\("users"\)[^;]*\.(insert|upsert)\(/);
  });

  it("W8 the placeholder comes from the shared constant, never a literal", () => {
    expect(codeWithStrings).not.toMatch(/"User"|'User'|`User`/);
    expect(codeWithStrings).toMatch(
      /import \{ DEFAULT_FIRST_NAME, firstNameForClient \} from "@\/lib\/defaultFirstName";/
    );
    expect(signedIn).toMatch(
      /firstName: firstNameForClient\( ?firstName \|\| DEFAULT_FIRST_NAME ?\),/
    );
  });
});
