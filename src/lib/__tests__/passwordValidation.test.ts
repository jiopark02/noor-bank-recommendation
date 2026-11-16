import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PASSWORD_SYMBOLS, validatePassword } from "../validation";
import en from "../../../messages/en.json";

/**
 * The client password check's symbol rule, executed, plus source probes of
 * the two pages that show its checklist label.
 *
 * The expected symbol set is Supabase Auth's: the list documented at
 * https://supabase.com/docs/guides/auth/password-security, which is what
 * supabase/auth's PasswordRequiredCharacters.Decode (internal/conf/
 * configuration.go) makes of the Management API's symbols preset — its "\\:"
 * keeps one backslash and the colon. The server checks membership with
 * strings.ContainsAny, so one symbol is enough.
 *
 * Mutations of validation.ts / the pages / en.json and the tests each one
 * turns red:
 *   A1  hasSpecial back to /[!@#$%^&*(),.?":{}|<>]/          -> P2
 *   A2  a backslash dropped from or doubled in the constant  -> P1, P2
 *   A3  hasSpecial loosened to any non-alphanumeric          -> P4
 *   A4  hasSpecial made constant true                        -> P3
 *   A5  the error text back to a hand-written list           -> P5
 *   A6  a label example outside the symbol set               -> P6
 *   A7  a page label back to a literal                       -> P7
 */

const SUPABASE_SYMBOL_CODES = [
  33, 64, 35, 36, 37, 94, 38, 42, 40, 41, 95, 43, 45, 61, 91, 93, 123, 125, 59,
  39, 92, 58, 34, 124, 60, 62, 63, 44, 46, 47, 96, 126,
];

// Every other requirement is met, so only the symbol decides.
const BASE = "Abcdefg1";

describe("the symbol set", () => {
  it("P1 is exactly Supabase's 32 symbols, in order, with no duplicates", () => {
    const codes = PASSWORD_SYMBOLS.split("").map((c) => c.charCodeAt(0));
    expect(codes).toEqual(SUPABASE_SYMBOL_CODES);
    expect(PASSWORD_SYMBOLS.length).toBe(32);
    expect(new Set(codes).size).toBe(32);
  });
});

describe("validatePassword symbol rule", () => {
  it.each(SUPABASE_SYMBOL_CODES.map((code) => String.fromCharCode(code)))(
    "P2 a password whose only symbol is %s passes",
    (symbol) => {
      const result = validatePassword(BASE + symbol);
      expect(result.checks.hasSpecial).toBe(true);
      expect(result.isValid).toBe(true);
    }
  );

  it("P3 a password with no symbol is refused", () => {
    const result = validatePassword(BASE + "2");
    expect(result.checks.hasSpecial).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it.each([
    ["a space", " "],
    ["a tab", "\t"],
    ["é", "é"],
    ["€", "€"],
    ["a fullwidth exclamation mark", "！"],
  ])("P4 a password whose only non-alphanumeric is %s is refused", (_, ch) => {
    const result = validatePassword(BASE + ch);
    expect(result.checks.hasSpecial).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it("P5 the error for a missing symbol lists the whole set", () => {
    const { errors } = validatePassword(BASE + "2");
    expect(errors).toContain("Password must contain a symbol: " + PASSWORD_SYMBOLS);
  });
});

describe("the checklist label", () => {
  const label = (en as { survey: { password: { special: string } } }).survey
    .password.special;

  it("P6 every example in the label is one character of the symbol set", () => {
    const match = /\(e\.g\. ([^)]*)\)/.exec(label);
    expect(match, "the label carries an (e.g. ...) list").not.toBeNull();
    const examples = (match as RegExpExecArray)[1].split(" ");
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example.length, `"${example}" is one character`).toBe(1);
      expect(PASSWORD_SYMBOLS.indexOf(example), `"${example}"`).not.toBe(-1);
    }
  });

  it.each([
    ["survey", "../../app/survey/page.tsx", "Special (!@#$%)"],
    ["password reset", "../../app/forgot-password/page.tsx", "Special char"],
  ])("P7 the %s checklist reads the label from en.json", (_, path, old) => {
    const source = readFileSync(
      fileURLToPath(new URL(path, import.meta.url)),
      "utf8"
    );
    expect(source).toContain(
      '{ key: "hasSpecial", label: t("survey.password.special") }'
    );
    expect(source).not.toContain(old);
  });
});
