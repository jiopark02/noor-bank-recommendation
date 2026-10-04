import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe of the survey page's wiring for a failed survey save. The
 * decisions themselves are executed in surveySubmitOutcome.test.ts; this file
 * checks that the page hands them the right values and passes their results
 * on. It does not render the page.
 *
 * Mutations of page.tsx and the tests each one turns red:
 *   P1  the failure decision given a constant instead of isAuthed   -> W1
 *   P2  the recovery record adapter not remembering the choice      -> W2
 *   P3  the recovery record adapter recording a different value     -> W2
 *   P4  clearPassword leaving confirmPassword in place              -> W3
 *   P5  the success path ignoring the recovered choice              -> W4
 *
 * The masking matches surveyRouteWiring.test.ts: comments are blanked and,
 * in `code`, so are string contents; whitespace is collapsed. Only
 * handleSubmit is searched, so JSX text elsewhere in the file cannot
 * confuse the quote tracking.
 */

const PAGE = fileURLToPath(new URL("../../app/survey/page.tsx", import.meta.url));

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

/** handleSubmit's source, from its declaration to the page's JSX return. */
function handleSubmitSource(): string {
  const source = readFileSync(PAGE, "utf8");
  const start = source.indexOf("const handleSubmit = async () => {");
  expect(start, "handleSubmit must be present").not.toBe(-1);
  const end = source.indexOf("\n  return (", start);
  expect(end, "the page's return must follow handleSubmit").not.toBe(-1);
  return source.slice(start, end);
}

const submit = handleSubmitSource();
const code = mask(submit, true).replace(/\s+/g, " ");
const codeWithStrings = mask(submit, false).replace(/\s+/g, " ");

/** The text from `start` up to (not including) `end`; both must be present. */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `${start} must be present`).not.toBe(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to, `${end} must follow ${start}`).not.toBe(-1);
  return text.slice(from, to);
}

describe("survey page wiring: failed survey save", () => {
  it("W1 a failed response goes through surveyFailureAction with isAuthed", () => {
    const failure = between(code, "if (!result.success) {", "resumeAfterSurveySaveFailure");
    expect(failure).toMatch(
      /const action = surveyFailureAction\( ?isAuthed, ?result ?\);/
    );
    expect(failure).toMatch(
      /if \(action\.kind === " ?"\) \{ setSubmitError\(action\.message\); return; \}/
    );
  });

  it("W2 the recovery records the user and remembers the same choice", () => {
    const deps = between(
      code,
      "resumeAfterSurveySaveFailure<Session>(",
      "setSubmitError(resumed.message)"
    );
    expect(deps).toMatch(
      /recordSignedInUser: \( ?userId, ?staySignedIn ?\) => \{ recordSignedInUser\( ?userId, ?staySignedIn ?\); setRecoveredStaySignedIn\( ?staySignedIn ?\); \}/
    );
  });

  it("W3 clearPassword empties both password fields", () => {
    const deps = between(
      codeWithStrings,
      "resumeAfterSurveySaveFailure<Session>(",
      "setSubmitError(resumed.message)"
    );
    expect(deps).toMatch(
      /clearPassword: \(\) => setData\(\( ?prev ?\) => \(\{ \.\.\.prev, password: "", confirmPassword: "" ?\}\)\)/
    );
  });

  it("W4 the success path records the choice decided by staySignedInAfterSubmit", () => {
    const success = code.slice(code.indexOf("setSubmitError(resumed.message)"));
    expect(success).toMatch(
      /recordSignedInUser\( ?result\.userId, staySignedInAfterSubmit\(\{ isAuthed, recoveredChoice: recoveredStaySignedIn, formChoice: data\.staySignedIn,? \}\) ?\);/
    );
  });
});
