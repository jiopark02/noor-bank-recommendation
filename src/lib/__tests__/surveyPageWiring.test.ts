import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe of the survey page's submit wiring. The decisions themselves
 * are executed in surveySubmitOutcome.test.ts; this file checks that the page
 * hands them the right values and passes their results on. It does not
 * render the page.
 *
 * Mutations of page.tsx and the tests each one turns red:
 *   P1  a failure not shown through surveyFailureMessage            -> W1
 *   M18 the unconfirmed signup recorded or signed in locally        -> W7
 *   M25 the stay-signed-in checkbox rendered again                  -> W8
 *   P5  the signed-in path recording something other than true      -> W4
 *   P6  the submit gate testing the unsanitized first name          -> W5
 *   P7  the submit gate dropping the email format check, or applying
 *       it to a signed-in submit                                    -> W5
 *   P8  the first-name field no longer marking itself touched       -> W6
 *   P9  the first-name error testing the unsanitized name           -> W6
 *   P10 the money input's length limit written as a literal, or its
 *       text parsed inline instead of through moneyInputDigits      -> PW1
 *   P11 the zero-income notice's condition or key removed           -> PW2
 *   P12 an en.json key the pages read removed or changed            -> PW3
 *   P13 the zero-spending notice's blur, condition or key removed   -> PW4
 *   P14 the full-field key check no longer called on key down       -> PW5
 *   P15 a key added to or dropped from the /api/survey request body  -> PW6
 *
 * The masking matches surveyRouteWiring.test.ts: comments are blanked and,
 * in `code`, so are string contents; whitespace is collapsed. Besides
 * handleSubmit, only short regions are searched (the derived input checks,
 * the first-name field, the submit button's disabled condition, MoneyInput
 * and the income and spending fields),
 * so JSX text elsewhere in the file cannot confuse the quote tracking.
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

describe("survey page wiring: submit result", () => {
  it("W1 a failed response shows surveyFailureMessage and stops", () => {
    expect(code).toContain(
      "if (!result.success) { setSubmitError(surveyFailureMessage(result)); return; }"
    );
  });

  it("W7 a new signup is not signed in or recorded: only consent, the password reset and the panel", () => {
    const signup = between(codeWithStrings, "if (!isAuthed) { if (data.agreeToTerms)", "recordSignedInUser(result.userId, true);");
    expect(signup).toContain("if (data.agreeToTerms) acceptTerms();");
    expect(signup).toContain(
      'setData((prev) => ({ ...prev, password: "", confirmPassword: "" }));'
    );
    expect(signup).toContain("setSignupNotice(signupOutcome(result));");
    expect(signup.trimEnd().endsWith("return; }")).toBe(true);
    for (const forbidden of [
      "signInWithPassword",
      "recordSignedInUser",
      "noor_user_profile",
      "noor_user_id",
      "localStorage",
      "createSession",
      "router.",
    ]) {
      expect(signup).not.toContain(forbidden);
    }
    // Nowhere in the page does a password sign-in remain.
    expect(readFileSync(PAGE, "utf8")).not.toContain("signInWithPassword");
  });

  it("W4 the signed-in path records the user with true", () => {
    expect(code).toContain("recordSignedInUser(result.userId, true);");
    expect(code.split("recordSignedInUser(").length - 1).toBe(1);
  });

  it("W8 no stay-signed-in identifier or message key is left on the page", () => {
    const page = readFileSync(PAGE, "utf8");
    expect(page).not.toMatch(/staySignedIn/i);
    expect(page).not.toContain("survey.step1.staySignedIn");
    expect(page).not.toContain("recoveredStaySignedIn");
  });

  it("W9 the panel's resend posts the signup email only and shows fixed text", () => {
    expect(codeWithStrings).toContain('fetch("/api/auth/resend-confirmation", {');
    expect(codeWithStrings).toContain("body: JSON.stringify({ email: signupEmail }),");
    expect(codeWithStrings).toContain(
      "setResendNotice(res.ok ? AUTH_COPY.RESEND_SENT : AUTH_COPY.RESEND_FAILED);"
    );
  });
});

/** The page's text from `start` up to `end`, comments blanked, whitespace collapsed. */
function pageRegion(start: string, end: string): string {
  const source = readFileSync(PAGE, "utf8");
  const from = source.indexOf(start);
  expect(from, `${start} must be present`).not.toBe(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to, `${end} must follow ${start}`).not.toBe(-1);
  return mask(source.slice(from, to), false).replace(/\s+/g, " ");
}

describe("survey page wiring: sanitized name and email checks", () => {
  it("W5 the submit gate uses the sanitized name, and the email format only before sign-in", () => {
    const derived = pageRegion("const passwordsMatch", "const handleSubmit = async");
    expect(derived).toContain(
      "const firstNameMissing = !sanitizeNameField(data.firstName);"
    );
    expect(derived).toMatch(
      /const emailValid = useMemo\( ?\(\) => validateEmail\(data\.email\)\.isValid, ?\[data\.email\] ?\);/
    );

    const gate = pageRegion("onClick={handleSubmit}", "className=");
    expect(gate).toContain("firstNameMissing ||");
    expect(gate).not.toContain("!data.firstName");
    expect(gate).not.toContain("!data.email");
    expect(gate).toMatch(/\(!isAuthed && \(!emailValid \|\|/);
    expect(gate.split("!emailValid").length - 1).toBe(1);
  });

  it("W6 the first-name field marks itself touched and shows its error on the sanitized name", () => {
    const field = pageRegion(
      'placeholder={t("survey.step1.firstName")}',
      't("errors.required")'
    );
    expect(field).toMatch(
      /onChange=\{\(v\) => \{ updateField\("firstName", v\); markTouched\("firstName"\); \}\}/
    );
    expect(field).toContain('touchedFields.has("firstName") && firstNameMissing');
  });
});

describe("survey page wiring: monthly money inputs", () => {
  it("PW1 the money input parses through moneyInputDigits and its maxLength is the shared constant", () => {
    const input = pageRegion("const MoneyInput = (", "const ViewedMark");
    expect(input).toContain("maxLength={MONEY_INPUT_MAX_LENGTH}");
    expect(input).toContain("const digits = moneyInputDigits(e.target.value);");
    expect(input).not.toMatch(/maxLength=\{\d/);
    expect(input).not.toContain(".replace(");
    expect(readFileSync(PAGE, "utf8")).toContain(
      'import { MONEY_INPUT_MAX_LENGTH, moneyInputDigits } from "@/lib/moneyInputText";'
    );
  });

  it("PW2 a zero income shows the income notice once the field was left", () => {
    const income = pageRegion(
      "value={data.monthlyIncome}",
      't("survey.step4.expenses")'
    );
    expect(income).toContain('onBlur={() => markTouched("monthlyIncome")}');
    expect(income).toMatch(
      /\{data\.monthlyIncome === 0 && touchedFields\.has\("monthlyIncome"\) && \( <p [^>]*> \{t\("survey\.step4\.incomeRequired"\)\} <\/p> \)\}/
    );
  });

  it("PW4 a zero spending amount shows the spending notice once the field was left", () => {
    const expenses = pageRegion(
      "value={data.monthlyExpenses}",
      "Do you have a credit history in the US?"
    );
    expect(expenses).toContain('onBlur={() => markTouched("monthlyExpenses")}');
    expect(expenses).toMatch(
      /\{data\.monthlyExpenses === 0 && touchedFields\.has\("monthlyExpenses"\) && \( <p [^>]*> \{t\("survey\.step4\.expensesRequired"\)\} <\/p> \)\}/
    );
    const messages = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../messages/en.json", import.meta.url)),
        "utf8"
      )
    ) as { survey: { step4: Record<string, unknown> } };
    expect(messages.survey.step4.expensesRequired).toBe(
      "Enter your monthly spending to continue."
    );
  });

  it("PW5 the key handler blocks a digit in a full field through moneyInputKeyBlocked", () => {
    const input = pageRegion("const MoneyInput = (", "const ViewedMark");
    expect(input).toMatch(
      /if \( moneyInputKeyBlocked\( e\.key, e\.currentTarget\.value, e\.currentTarget\.selectionStart, e\.currentTarget\.selectionEnd \) \) \{ e\.preventDefault\(\); return; \}/
    );
    expect(readFileSync(PAGE, "utf8")).toContain(
      'import { moneyInputKeyBlocked } from "@/lib/moneyInputText";'
    );
  });

  it("PW3 the two message keys the pages read exist with their text", () => {
    const messages = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../messages/en.json", import.meta.url)),
        "utf8"
      )
    ) as { survey: { step4: Record<string, unknown>; password: Record<string, unknown> } };
    expect(messages.survey.step4.incomeRequired).toBe(
      "Noor is built for people with a monthly income. Enter your income to continue."
    );
    expect(typeof messages.survey.password.special).toBe("string");
    expect(messages.survey.password.special).not.toBe("");
  });
});

describe("survey page wiring: the /api/survey request body", () => {
  it("PW6 the body names exactly these keys", () => {
    const request = between(codeWithStrings, 'fetch("/api/survey", {', "const result =");
    const body = between(request, "body: JSON.stringify({", "}),");
    const keys = (body.slice("body: JSON.stringify({".length).match(/[A-Za-z_$][\w$]*(?=\s*:)/g) ?? []);
    expect(keys).toEqual([
      "first_name",
      "email",
      "password",
      "monthly_income",
      "monthly_budget",
      "has_us_credit_history",
    ]);
  });
});
