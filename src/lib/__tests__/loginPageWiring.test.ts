import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe of the login page: no metadata is spread into the local
 * profile (L3), and auth errors reach the screen only as fixed copy (L5-L7).
 *
 * Where the local profile's names come from — the profile sync's answer only,
 * never user_metadata or a browser read of public.users — and that the profile
 * is stored only after the sync has answered or timed out, is held by
 * loginProfileSync.test.ts.
 *
 * The masking matches surveyPageWiring.test.ts: comments are blanked and,
 * in `code`, so are string contents; whitespace is collapsed. Only
 * handleSubmit is searched, so JSX text elsewhere in the file cannot
 * confuse the quote tracking.
 */

const PAGE = fileURLToPath(new URL("../../app/login/page.tsx", import.meta.url));

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

const source = readFileSync(PAGE, "utf8");

/** handleSubmit's source, from its declaration to the form-validity line. */
function handleSubmitSource(): string {
  const start = source.indexOf("const handleSubmit = async");
  expect(start, "handleSubmit must be present").not.toBe(-1);
  const end = source.indexOf("const isFormValid", start);
  expect(end, "isFormValid must follow handleSubmit").not.toBe(-1);
  return source.slice(start, end);
}

const submit = mask(handleSubmitSource(), false).replace(/\s+/g, " ");

describe("login page wiring: the local profile", () => {
  it("L3 spreads no metadata into the local profile", () => {
    expect(submit).toContain(
      "firstName: names.firstName, lastName: names.lastName, };"
    );
    expect(submit).not.toContain("raw_user_meta_data");
    expect(submit).not.toContain("user_metadata");
  });
});

describe("login page wiring: auth error copy", () => {
  // Comments and string contents blanked, so a `.message` in either does not
  // count; whitespace collapsed.
  const page = mask(source, true).replace(/\s+/g, " ");

  it("L5 no setError argument reads an error's message", () => {
    const calls = page.match(/setError\([^;]*\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // The only message a setError may read is a fixed copy's.
      const rest = call
        .replace("setError(copy.message);", "")
        .replace(/copyForAuthError\((?:[^()]|\([^()]*\))*\)\.message/g, "");
      expect(rest, call).not.toContain(".message");
    }
    expect(page).not.toMatch(/(?:signInError|error|err|lateError)\??\.message/);
  });

  it("L6 both Supabase refusals go through copyForAuthError by code", () => {
    expect(page).toContain(
      'setError(copyForAuthError(authErrorCode(error), " ").message);'
    );
    expect(page).toContain(
      'const copy = copyForAuthError(authErrorCode(signInError), " "); setError(copy.message); setOfferResend(Boolean(copy.offerResend)); return;'
    );
  });

  it("L7 the resend posts the typed email only and shows fixed text", () => {
    const flat = mask(source, false).replace(/\s+/g, " ");
    expect(flat).toContain('fetch("/api/auth/resend-confirmation", {');
    expect(flat).toContain("body: JSON.stringify({ email: email.trim().toLowerCase() }),");
    expect(flat).toContain(
      "setResendNotice(res.ok ? AUTH_COPY.RESEND_SENT : AUTH_COPY.RESEND_FAILED);"
    );
    expect(flat).toContain("{offerResend && (");
  });
});
