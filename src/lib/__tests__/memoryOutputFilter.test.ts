import { describe, expect, it } from "vitest";
import {
  SENSITIVE_MASK,
  SSN_KEYWORD_WINDOW,
  findSensitiveMatches,
  luhnValid,
  maskSensitive,
} from "../memoryOutputFilter";

describe("luhnValid", () => {
  it("accepts known test card numbers", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("378282246310005")).toBe(true);
  });

  it("rejects a changed last digit and non-digits", () => {
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(luhnValid("4111-1111")).toBe(false);
  });
});

describe("findSensitiveMatches — matches", () => {
  it.each([
    ["dashed SSN", "my SSN is 123-45-6789", { ssn: 1, card: 0 }],
    ["spaced SSN", "it is 123 45 6789 ok", { ssn: 1, card: 0 }],
    ["SSN without any keyword", "number 123-45-6789", { ssn: 1, card: 0 }],
    ["spaced card", "card 4111 1111 1111 1111", { ssn: 0, card: 1 }],
    ["dashed card", "card 4111-1111-1111-1111", { ssn: 0, card: 1 }],
    ["unbroken card", "card 4111111111111111.", { ssn: 0, card: 1 }],
    ["15-digit Amex test number", "amex 378282246310005", { ssn: 0, card: 1 }],
    [
      "both inside a sentence",
      "The user said their SSN is 123-45-6789 and card 4111 1111 1111 1111 expires soon.",
      { ssn: 1, card: 1 },
    ],
    ["two SSNs", "123-45-6789 and 987-65-4321", { ssn: 2, card: 0 }],
    [
      "card right after an amount",
      "paid $1,200 4111 1111 1111 1111",
      { ssn: 0, card: 1 },
    ],
    [
      "SSN right after a decimal amount",
      "owes 12.50 123-45-6789",
      { ssn: 1, card: 0 },
    ],
  ])("%s", (_label, text, expected) => {
    expect(findSensitiveMatches(text)).toEqual(expected);
  });
});

describe("findSensitiveMatches — bare 9 digits next to an SSN keyword", () => {
  it.each([
    ["SSN: 123456789"],
    ["my social security number is 123456789"],
    ["my social-security number is 123456789"],
    ["123456789 (my SSN)"],
    ["ssn 123456789"],
  ])("matches %s", (text) => {
    expect(findSensitiveMatches(text)).toEqual({ ssn: 1, card: 0 });
  });

  it(`matches with the keyword exactly ${SSN_KEYWORD_WINDOW} characters away, before or after`, () => {
    const gap = " ".repeat(SSN_KEYWORD_WINDOW);
    expect(findSensitiveMatches(`SSN${gap}123456789`).ssn).toBe(1);
    expect(findSensitiveMatches(`123456789${gap}SSN`).ssn).toBe(1);
  });

  it(`does not match with the keyword ${SSN_KEYWORD_WINDOW + 1} characters away`, () => {
    const gap = " ".repeat(SSN_KEYWORD_WINDOW + 1);
    expect(findSensitiveMatches(`SSN${gap}021000021`).ssn).toBe(0);
    expect(findSensitiveMatches(`021000021${gap}SSN`).ssn).toBe(0);
  });

  it.each([
    ["no keyword", "routing 123456789"],
    ["10 digits", "SSN 1234567890"],
    ["an amount with commas", "SSN $123,456,789"],
    ["an amount with cents", "SSN 123456789.00"],
    ["keyword inside another word", "lessn 123456789"],
    ["plural is not the keyword", "ssns 123456789"],
  ])("does not match %s", (_label, text) => {
    expect(findSensitiveMatches(text)).toEqual({ ssn: 0, card: 0 });
  });
});

describe("findSensitiveMatches — leaves ordinary numbers alone", () => {
  // A 13-digit epoch-milliseconds value; the test proves it is Luhn-invalid
  // rather than assuming it.
  const EPOCH_MS = "1760140800000";

  it("uses an epoch value that is Luhn-invalid", () => {
    expect(luhnValid(EPOCH_MS)).toBe(false);
  });

  it.each([
    ["phone with parentheses", "(415) 555-0123"],
    ["dashed phone", "415-555-0123"],
    ["international phone", "+1 415 555 0123"],
    ["ZIP", "94110"],
    ["ZIP+4", "94110-1234"],
    ["ISO date", "2026-10-11"],
    ["US date", "10/11/2026"],
    ["amount", "$1,234.56"],
    ["large amount", "$12,345,678.00"],
    ["plain decimal", "1234.56"],
    ["Luhn-invalid 16 digits", "4111 1111 1111 1112"],
    ["epoch milliseconds", `at ${EPOCH_MS}`],
    ["mixed SSN separators", "123-45 6789"],
    ["rent", "rent is $1,700 a month, due on the 1st"],
  ])("%s", (_label, text) => {
    expect(findSensitiveMatches(text)).toEqual({ ssn: 0, card: 0 });
  });
});

describe("maskSensitive", () => {
  it("replaces each match with the mask and keeps the rest of the text", () => {
    const result = maskSensitive(
      "SSN 123-45-6789, card 4111 1111 1111 1111, rent $1,200 cash."
    );
    expect(result.text).toBe(
      `SSN ${SENSITIVE_MASK}, card ${SENSITIVE_MASK}, rent $1,200 cash.`
    );
    expect(result.masked).toBe(2);
    expect(result.ssn).toBe(1);
    expect(result.card).toBe(1);
  });

  it("masks only the digits of a bare SSN, keeping the keyword", () => {
    expect(maskSensitive("SSN: 123456789").text).toBe(`SSN: ${SENSITIVE_MASK}`);
  });

  it("returns text without matches unchanged", () => {
    const text = "Rent is $1,700; phone 415-555-0123; ZIP 94110.";
    expect(maskSensitive(text)).toEqual({
      text,
      masked: 0,
      ssn: 0,
      card: 0,
    });
  });
});
