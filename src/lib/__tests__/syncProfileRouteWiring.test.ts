import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe of POST /api/auth/sync-profile's wiring: the identity handed to
 * syncProfileForUser is built from the verified token's user, the request body
 * is used only as that call's argument, and the adapters around the database
 * calls pass their results through unchanged.
 *
 * Mutations of route.ts and the tests each one turns red:
 *   R1  the body email passed as the identity email          -> W1, W2
 *   R2  getAuthenticatedUserIdFromRequest restored           -> W1, W2
 *   R3  findExisting returns error: null                     -> W3a
 *   R4  .eq("id", userId) changed to .eq("user_id", userId)  -> W3b
 *   R5  onConflict removed from the upsert                   -> W3c
 *   R6  upsertProfile returns error: null                    -> W3d
 *   R7  the response status fixed at 200                     -> W3e
 *   R8  body destructured                                    -> W2
 *   R9  body read through an `as` cast                       -> W2
 *   R10 body read with bracket access                        -> W2
 *   R11 body aliased to another name                         -> W2
 *   R12 body spread into the identity                        -> W2
 *   R13 findExisting reads from another table                -> W3f
 *   R14 a column dropped from findExisting's select          -> W3g
 *   R15 .maybeSingle() changed to .single()                  -> W3h
 *   R16 upsertProfile writes to another table                -> W3i
 *   R17 .upsert( changed to .insert(                         -> W3j
 *
 * Two masked views of the source are used. `code` has comments and the
 * contents of string literals blanked, so text in either cannot satisfy or
 * trip a check. `codeWithStrings` has only comments blanked, for the checks
 * whose subject is a string literal (a column name, a conflict target). Each
 * W3 check asserts that a fragment is present in its block; it does not see
 * anything added next to it, such as an extra filter. It does not execute the
 * route.
 */

const ROUTE = fileURLToPath(
  new URL("../../app/api/auth/sync-profile/route.ts", import.meta.url)
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

/**
 * Each occurrence of the identifier `body`, except member access such as
 * `result.body`. A spread (`...body`) counts.
 */
function bodyOccurrences(text: string): number[] {
  const found: number[] = [];
  const re = /(?<![\w$])body(?![\w$])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const memberAccess =
      text.charAt(m.index - 1) === "." && text.charAt(m.index - 2) !== ".";
    if (!memberAccess) found.push(m.index);
  }
  return found;
}

describe("sync-profile route wiring", () => {
  it("W1 builds the identity from the user returned by getAuthenticatedUserFromRequest", () => {
    expect(code).toMatch(
      /const user = await getAuthenticatedUserFromRequest\( ?request ?\)/
    );
    expect(code).toMatch(
      /syncProfileForUser\( ?\{ ?id: user\.id, email: user\.email, userMetadata: user\.user_metadata ?\}, body,/
    );
  });

  it("W2 uses the request body only as the argument to syncProfileForUser", () => {
    const at = bodyOccurrences(code);
    expect(at).toHaveLength(2);
    expect(code.slice(at[0] - "const ".length)).toMatch(
      /^const body = await request\.json\(\)/
    );
    expect(code.slice(0, at[1] + "body,".length)).toMatch(
      /syncProfileForUser\( ?\{[^{}]*\}, body,$/
    );
    expect(code).not.toMatch(/\bgetAuthenticatedUserIdFromRequest\b/);
  });

  it("W3a findExisting passes the query's row and error through", () => {
    const block = between(code, "findExisting:", "upsertProfile:");
    expect(block).toMatch(/return \{ row: data \?\? null, error \}/);
  });

  it("W3b findExisting filters on the id column with the given userId", () => {
    const block = between(codeWithStrings, "findExisting:", "upsertProfile:");
    expect(block).toContain('.eq("id", userId)');
  });

  it("W3c the upsert resolves conflicts on id", () => {
    const block = between(codeWithStrings, "upsertProfile:", "now:");
    expect(block).toContain('{ onConflict: "id" }');
  });

  it("W3d upsertProfile passes the query's error through", () => {
    const block = between(code, "upsertProfile:", "now:");
    expect(block).toMatch(/return \{ error \};/);
    expect(block).not.toMatch(/error: null/);
  });

  it("W3f findExisting reads from the users table", () => {
    const block = between(codeWithStrings, "findExisting:", "upsertProfile:");
    expect(block).toContain('.from("users")');
  });

  it("W3g findExisting selects both name columns", () => {
    const block = between(codeWithStrings, "findExisting:", "upsertProfile:");
    expect(block).toContain('.select("first_name, last_name")');
  });

  it("W3h findExisting reads at most one row without treating none as an error", () => {
    const block = between(code, "findExisting:", "upsertProfile:");
    expect(block).toContain(".maybeSingle()");
  });

  it("W3i upsertProfile writes to the users table", () => {
    const block = between(codeWithStrings, "upsertProfile:", "now:");
    expect(block).toContain('.from("users")');
  });

  it("W3j upsertProfile upserts rather than inserts", () => {
    const block = between(code, "upsertProfile:", "now:");
    expect(block).toContain(".upsert(");
  });

  it("W3e the response carries the decision's status and body", () => {
    expect(code).toContain(
      "NextResponse.json(result.body, { status: result.status })"
    );
  });
});
