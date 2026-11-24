import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_MAX_LENGTH, EMAIL_PATTERN, validateEmail } from "../validation";

/**
 * validateEmail runs on input from unauthenticated routes (signup, the
 * waitlist, confirmation resend), so its pattern must not take more than
 * linear time on any input, and the pattern must never see an input longer
 * than EMAIL_MAX_LENGTH.
 *
 * Three guards, only the last of which reads a clock:
 *   E5  the pattern is never called on an input over the limit (a spy);
 *   E3  the pattern is exactly the form whose domain parts cannot overlap;
 *   E6  the pattern alone finishes a long attack input well inside a second.
 * E2 holds that the pattern accepts the same inputs as the form it replaced.
 */

// The pattern validateEmail used before. Its two domain runs both match ".",
// so "a@" followed by many dots and a closing "@" backtracks quadratically.
// It is kept here only as the reference for E2, which never gives it an input
// longer than ACCEPTANCE_SAMPLES' longest entry.
const PREVIOUS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function attackInput(dots: number): string {
  return "a@" + ".".repeat(dots) + "@";
}

const ACCEPTED = [
  "user@example.com",
  "USER@Example.COM",
  "first.last+tag@example.com",
  "a@mail.sub.example.co.uk",
  "a@my-host.example.com",
  "a@example.photography",
  "a@xn--bcher-kva.example",
  "a@xn--80akhbyknj4f.xn--p1ai",
  "o.brien_1@ex.io",
  "a@b.co",
  "  padded@example.com  ",
  // Accepted before as well; the pattern does not judge empty labels.
  "a@b..c",
  "a@.b.c",
  "a@b.c.",
  "a@..co",
];

const REJECTED = [
  "",
  "   ",
  "not-an-address",
  "a@b",
  "a@.",
  "x@.co",
  "x@co.",
  "@x.co",
  "a b@c.co",
  "a@b .co",
  "a@b.c d",
  "a@@b.co",
  "a@b@c.co",
];

const ACCEPTANCE_SAMPLES = ACCEPTED.concat(REJECTED);

function allStrings(alphabet: string[], maxLength: number): string[] {
  const out: string[] = [""];
  let frontier: string[] = [""];
  for (let length = 1; length <= maxLength; length += 1) {
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const ch of alphabet) next.push(prefix + ch);
    }
    out.push(...next);
    frontier = next;
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("E1 samples and the shape of the answer", () => {
  it.each(ACCEPTED)("accepts %j", (email) => {
    expect(validateEmail(email).isValid).toBe(true);
  });

  it.each(REJECTED)("rejects %j with the fixed answer", (email) => {
    expect(validateEmail(email)).toEqual({
      isValid: false,
      error: "Please enter a valid email address",
      suggestion: null,
      isEdu: false,
    });
  });

  it("keeps the typo suggestion and the .edu flag", () => {
    expect(validateEmail("Ann@Gmial.com")).toEqual({
      isValid: true,
      error: null,
      suggestion: "Did you mean ann@gmail.com?",
      isEdu: false,
    });
    expect(validateEmail("ann@school.edu")).toEqual({
      isValid: true,
      error: null,
      suggestion: null,
      isEdu: true,
    });
  });
});

describe("E2 the pattern accepts what the previous pattern accepted", () => {
  it("agrees on every sample", () => {
    for (const s of ACCEPTANCE_SAMPLES) {
      const lowered = s.trim().toLowerCase();
      expect(EMAIL_PATTERN.test(lowered), s).toBe(PREVIOUS_PATTERN.test(lowered));
    }
  });

  it("agrees on every string of up to 8 characters drawn from letter, dot, @ and space", () => {
    const differing: string[] = [];
    for (const s of allStrings(["a", ".", "@", " "], 8)) {
      if (EMAIL_PATTERN.test(s) !== PREVIOUS_PATTERN.test(s)) differing.push(s);
    }
    expect(differing).toEqual([]);
  });
});

describe("E3 the pattern's form", () => {
  it("is the form whose domain runs cannot overlap", () => {
    expect(EMAIL_PATTERN.source).toBe("^[^\\s@]+@[^\\s@][^\\s@.]*\\.[^\\s@]+$");
    expect(EMAIL_PATTERN.flags).toBe("");
  });
});

describe("E4 the length limit", () => {
  const local = "a".repeat(64);
  const atLimit = local + "@" + "b".repeat(EMAIL_MAX_LENGTH - 64 - 1 - 4) + ".com";
  const overLimit = local + "@" + "b".repeat(EMAIL_MAX_LENGTH - 64 - 1 - 4 + 1) + ".com";

  it("is 320, the same as the household invite path", () => {
    expect(EMAIL_MAX_LENGTH).toBe(320);
  });

  it("accepts an address of exactly the limit, and surrounding spaces do not count", () => {
    expect(atLimit.length).toBe(EMAIL_MAX_LENGTH);
    expect(validateEmail(atLimit).isValid).toBe(true);
    expect(validateEmail("  " + atLimit + "  ").isValid).toBe(true);
  });

  it("rejects an address one character over the limit", () => {
    expect(overLimit.length).toBe(EMAIL_MAX_LENGTH + 1);
    expect(validateEmail(overLimit)).toEqual({
      isValid: false,
      error: "Please enter a valid email address",
      suggestion: null,
      isEdu: false,
    });
  });
});

describe("E5 the pattern never sees an input over the limit", () => {
  function patternInputLengths(spy: ReturnType<typeof vi.spyOn>): number[] {
    const lengths: number[] = [];
    spy.mock.calls.forEach((args, i) => {
      if (spy.mock.contexts[i] === EMAIL_PATTERN) lengths.push(String(args[0]).length);
    });
    return lengths;
  }

  it("an address at the limit reaches the pattern", () => {
    const spy = vi.spyOn(RegExp.prototype, "test");
    validateEmail("a".repeat(64) + "@" + "b".repeat(251) + ".com");
    expect(patternInputLengths(spy)).toEqual([EMAIL_MAX_LENGTH]);
  });

  it("a million-dot attack input is refused without calling the pattern", () => {
    const spy = vi.spyOn(RegExp.prototype, "test");
    const result = validateEmail(attackInput(1_000_000));
    expect(result.isValid).toBe(false);
    expect(patternInputLengths(spy)).toEqual([]);
  });

  it("an input that lowercasing lengthens past the limit is refused without calling the pattern", () => {
    const input = "İ".repeat(200) + "@b.co";
    expect(input.length).toBeLessThanOrEqual(EMAIL_MAX_LENGTH);
    expect(input.toLowerCase().length).toBeGreaterThan(EMAIL_MAX_LENGTH);
    const spy = vi.spyOn(RegExp.prototype, "test");
    expect(validateEmail(input).isValid).toBe(false);
    expect(patternInputLengths(spy)).toEqual([]);
  });
});

describe("E6 the pattern alone is linear on the attack input", () => {
  it(
    "finishes 100,000 dots in under a second",
    () => {
      // Measured: the pattern takes about a millisecond here; the previous
      // pattern takes seconds, growing fourfold each time the dots double.
      const input = attackInput(100_000);
      const startedAt = Date.now();
      const matched = EMAIL_PATTERN.test(input);
      const elapsedMs = Date.now() - startedAt;
      expect(matched).toBe(false);
      expect(elapsedMs).toBeLessThan(1000);
    },
    30_000
  );
});
