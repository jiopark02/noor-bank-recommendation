import { describe, it, expect } from "vitest";
import { AuthApiError } from "@supabase/supabase-js";
import { toLogSafeError } from "../logSafeError";

/**
 * toLogSafeError — the allow-list a log line applies when it routes an external
 * error object through the helper. Which lines do so is serverLogEmailProbe's
 * concern, not this file's.
 *
 * WHAT IT EXISTS TO PREVENT
 * Logging a Supabase, Auth or Resend error object whole writes every field it
 * carries into the Vercel logs. PostgREST puts the offending row in `details`,
 * so a unique violation on users.email logs "Key (email)=(...) already
 * exists." with the address in it. The helper copies four named fields and
 * nothing else, and masks anything address-shaped inside them.
 *
 * WHY THE FIXTURES ARE SHAPED THE WAY THEY ARE
 * They follow what the SDKs actually hand the routes, not what their typings
 * suggest. postgrest-js returns `error` as a PLAIN OBJECT, not a
 * PostgrestError instance, and has no `name` or `status` on it; on a failed
 * fetch it sets `code: ""` and puts a stack in `details`; on a non-JSON body
 * the whole body becomes `message`. Resend carries the HTTP status as
 * `statusCode`, not `status`. Testing against class instances alone would pass
 * while the real shapes went through untested.
 *
 * EVERY FIXTURE CARRIES THE PROBE ADDRESS somewhere it can reach a log — in
 * `message` where the shape has one — and every fixture is asserted not to
 * leak it. There is no fixture the absence check is excused from.
 *
 * WHAT THIS DOES NOT PROVE
 * That a given route calls the helper. That is serverLogEmailProbe.test.ts.
 */

const PROBE = "probe@example.com";
const ALLOWED_KEYS = ["code", "message", "status", "name", "value_type"];
const LIMIT = 500;

function circularObject(): Record<string, unknown> {
  const o: Record<string, unknown> = { code: "C1", message: `cycle for ${PROBE}` };
  o.self = o;
  return o;
}

function throwingGetter(): Record<string, unknown> {
  return Object.defineProperty({ code: "G1" }, "message", {
    enumerable: true,
    get() {
      throw new Error(`getter for ${PROBE}`);
    },
  });
}

function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({ message: PROBE }, {});
  revoke();
  return proxy;
}

function errorWithCauseAndStack(): Error {
  const error = new Error(`boom for ${PROBE}`) as Error & { cause?: unknown };
  error.cause = new Error(`cause for ${PROBE}`);
  error.stack = `Error: boom\n    at handler (${PROBE})`;
  return error;
}

const FIXTURES: Array<[string, () => unknown]> = [
  [
    "PostgrestError as returned (plain object)",
    () => ({
      code: "23505",
      message: `duplicate key value for ${PROBE}`,
      details: `Key (email)=(${PROBE}) already exists.`,
      hint: `retry with ${PROBE}`,
    }),
  ],
  [
    "PostgrestError on a failed fetch",
    () => ({
      message: `TypeError: fetch failed for ${PROBE}`,
      details: `TypeError: fetch failed\n    at ${PROBE}`,
      hint: "",
      code: "",
    }),
  ],
  [
    "PostgrestError with a non-JSON body",
    () => ({ message: `<html><body>gateway error ${PROBE}</body></html>` }),
  ],
  [
    "AuthApiError",
    () => new AuthApiError(`signup failed for ${PROBE}`, 422, "email_exists"),
  ],
  [
    "Resend ErrorResponse",
    () => ({ name: "validation_error", message: `Invalid to: ${PROBE}`, statusCode: 422 }),
  ],
  [
    "Resend ErrorResponse with statusCode null",
    () => ({ name: "application_error", message: `unreachable ${PROBE}`, statusCode: null }),
  ],
  ["Error with cause and stack", errorWithCauseAndStack],
  ["string", () => `failure for ${PROBE}`],
  ["null", () => null],
  ["undefined", () => undefined],
  ["circular object", circularObject],
  ["object with a throwing getter", throwingGetter],
  ["revoked Proxy", revokedProxy],
];

describe.each(FIXTURES)("%s", (_label, make) => {
  it("does not throw", () => {
    expect(() => toLogSafeError(make())).not.toThrow();
  });

  it("returns only allow-listed keys", () => {
    const keys = Object.keys(toLogSafeError(make()));
    for (const key of keys) {
      expect(ALLOWED_KEYS).toContain(key);
    }
  });

  it("never contains the probe address", () => {
    expect(JSON.stringify(toLogSafeError(make()))).not.toContain(PROBE);
  });

  it("returns a new object, not the input", () => {
    // Compared with === rather than .not.toBe(input): the matcher inspects its
    // expected value, and a throwing getter or a revoked Proxy throws there.
    const input = make();
    expect(toLogSafeError(input) === input).toBe(false);
  });

  it("keeps every string field within the cap", () => {
    const result = toLogSafeError(make()) as Record<string, unknown>;
    for (const key of Object.keys(result)) {
      const value = result[key];
      if (typeof value === "string") {
        expect(value.length).toBeLessThanOrEqual(LIMIT);
      }
    }
  });
});

describe("shape per input", () => {
  it("PostgrestError keeps code and message, drops details and hint", () => {
    expect(toLogSafeError(FIXTURES[0][1]())).toEqual({
      code: "23505",
      message: "duplicate key value for [email]",
    });
  });

  it("an empty code is omitted", () => {
    expect(toLogSafeError(FIXTURES[1][1]())).toEqual({
      message: "TypeError: fetch failed for [email]",
    });
  });

  it("AuthApiError keeps name, message, status and code", () => {
    expect(toLogSafeError(FIXTURES[3][1]())).toEqual({
      name: "AuthApiError",
      message: "signup failed for [email]",
      status: 422,
      code: "email_exists",
    });
  });

  it("Resend statusCode is reported as status", () => {
    expect(toLogSafeError(FIXTURES[4][1]())).toEqual({
      name: "validation_error",
      message: "Invalid to: [email]",
      status: 422,
    });
  });

  it("a null statusCode is omitted", () => {
    expect(toLogSafeError(FIXTURES[5][1]())).toEqual({
      name: "application_error",
      message: "unreachable [email]",
    });
  });

  it("status wins over statusCode when both are numbers", () => {
    expect(toLogSafeError({ status: 503, statusCode: 400 })).toEqual({ status: 503 });
  });

  it("statusCode is used when status is not a number", () => {
    expect(toLogSafeError({ status: "503", statusCode: 400 })).toEqual({ status: 400 });
  });

  it("an Error keeps name and message; stack and cause are not read", () => {
    expect(toLogSafeError(errorWithCauseAndStack())).toEqual({
      name: "Error",
      message: "boom for [email]",
    });
  });

  it("a Node system error keeps its string code", () => {
    const error = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(toLogSafeError(error)).toEqual({
      name: "Error",
      message: "socket hang up",
      code: "ECONNRESET",
    });
  });

  it("a string is described by type only", () => {
    expect(toLogSafeError(`failure for ${PROBE}`)).toEqual({ value_type: "string" });
  });

  it("null and undefined are described by type", () => {
    expect(toLogSafeError(null)).toEqual({ value_type: "null" });
    expect(toLogSafeError(undefined)).toEqual({ value_type: "undefined" });
  });

  it("other non-objects are described by type", () => {
    expect(toLogSafeError(42)).toEqual({ value_type: "number" });
    expect(toLogSafeError(true)).toEqual({ value_type: "boolean" });
    expect(toLogSafeError([PROBE])).toEqual({ value_type: "array" });
  });

  it("a circular object yields its top-level fields only", () => {
    expect(toLogSafeError(circularObject())).toEqual({
      code: "C1",
      message: "cycle for [email]",
    });
  });

  it("a throwing getter drops only that field", () => {
    expect(toLogSafeError(throwingGetter())).toEqual({ code: "G1" });
  });

  it("a revoked Proxy is unreadable", () => {
    expect(toLogSafeError(revokedProxy())).toEqual({ value_type: "unreadable" });
  });

  it("a non-string message is omitted", () => {
    expect(toLogSafeError({ message: { nested: PROBE } })).toEqual({});
  });
});

/** Normalization is exercised through `message`; the rules are field-agnostic. */
function normalized(input: string): string {
  const message = toLogSafeError({ message: input }).message;
  if (message === undefined) throw new Error("message was dropped");
  return message;
}

describe("normalization", () => {
  it("replaces an address inside message with [email]", () => {
    expect(normalized(`dup for ${PROBE} done`)).toBe("dup for [email] done");
  });

  // The padding ends in a space: the pattern treats any non-delimiter run as
  // part of the address, so padding glued to it would be masked along with it.
  it("masks before it truncates (an address straddling the cap)", () => {
    // "probe" occupies indexes 495-499 and its "@" sits at 500. Truncating
    // first would leave "probe" with no "@" for the pattern to find, so it
    // would survive. Masking first replaces the whole address and the cut
    // lands inside "[email]".
    const result = normalized("x".repeat(494) + " " + PROBE);
    expect(result).toBe(("x".repeat(494) + " [email]").slice(0, LIMIT));
    expect(result).not.toContain("probe");
  });

  it("masks an address that ends past the cap", () => {
    const result = normalized("x".repeat(489) + " ab@cd.example.org");
    expect(result).toBe("x".repeat(489) + " [email]");
  });

  it("turns CR, LF, TAB, NUL and LINE SEPARATOR into one space each", () => {
    expect(normalized("a\r\nb\tc\u0000d\u2028e")).toBe("a  b c d e");
  });

  it("caps at 500 UTF-16 units", () => {
    expect(normalized("y".repeat(600))).toHaveLength(LIMIT);
  });

  it("never splits a surrogate pair at the cap", () => {
    // The high surrogate sits at index 499, so a plain slice would end on it.
    const result = normalized("y".repeat(499) + "\uD83D\uDE00" + "z".repeat(10));
    expect(result).toHaveLength(LIMIT - 1);
    const last = result.charCodeAt(result.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it("keeps a surrogate pair that fits inside the cap", () => {
    const result = normalized("y".repeat(498) + "\uD83D\uDE00" + "z");
    expect(result).toHaveLength(LIMIT);
    expect(result.slice(-2)).toBe("\uD83D\uDE00");
  });

  it("normalizes code and name too, not only message", () => {
    expect(toLogSafeError({ name: "Type\nError", code: "A\tB" })).toEqual({
      name: "Type Error",
      code: "A B",
    });
  });

  it("finishes a 100,000-character run with no delimiter inside 1000ms (no '@')", () => {
    // EXPECTED MUTATION: without the pre-cut the address pattern backtracks
    // quadratically over the whole run; on 100,000 characters that measured
    // about 4.5 seconds, so this fails on its assertion rather than hanging CI.
    const input = "x".repeat(100_000);
    const started = Date.now();
    const result = normalized(input);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.length).toBeLessThanOrEqual(LIMIT);
  });

  it("finishes a 100,000-character run ending in '@' inside 1000ms", () => {
    // EXPECTED MUTATION: without the pre-cut this also fails on its assertion.
    // A trailing "@" with nothing after it means every start position fails to
    // match, so the backtracking is quadratic: about 4.5 seconds measured. (A
    // run ending in "@x" would not guard anything — it matches in one pass.)
    const input = "x".repeat(100_000) + "@";
    const started = Date.now();
    const result = normalized(input);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.length).toBeLessThanOrEqual(LIMIT);
  });

  // The pre-cut at 2000 ends on a token boundary. The fixture makes masking
  // SHRINK the text in front of the cut: a 1990-character address collapses to
  // "[email]", so anything left of a second address past position 2000 would
  // slide inside the final 500. Each offset puts that second address across or
  // just past the cut; none of it may survive.
  it.each([1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005])(
    "leaves no fragment of an address that starts at offset %i",
    (offset) => {
      const longAddress = "x".repeat(1985) + "@y.co";
      const input =
        longAddress + " ".repeat(offset - longAddress.length) + "sungwon.chang@example.com";
      const result = normalized(input);
      const keptSpaces = Math.min(offset, 2000) - longAddress.length;
      expect(result).toBe("[email]" + " ".repeat(keptSpaces));
    }
  );

  it("never leaves half a surrogate pair at the pre-cut", () => {
    // The pair occupies 1999-2000, so a plain cut at 2000 would keep its high
    // half; the shrinking address in front brings that into the final 500.
    const longAddress = "x".repeat(1985) + "@y.co";
    const input = longAddress + " " + "y".repeat(8) + "\uD83D\uDE00" + " tail";
    const result = normalized(input);
    expect(result).toBe("[email] ");
  });

  it("reports a value whose only token exceeded the pre-cut as [omitted]", () => {
    // EXPECTED MUTATION: without the "[omitted]" substitution this is "".
    expect(normalized("z".repeat(3000))).toBe("[omitted]");
  });

  it("keeps a value that was empty to begin with as the empty string", () => {
    expect(normalized("")).toBe("");
  });

  it("over-matches by design", () => {
    expect(normalized("u@localhost")).toBe("[email]");
    expect(normalized("pkg x@1.2.3")).toBe("pkg [email]");
  });

  // One representative character from each range of the control pattern.
  // Written as escapes on purpose: none of these may appear literally in source.
  it.each([
    ["BEL", "\u0007"],
    ["NEL", "\u0085"],
    ["ARABIC LETTER MARK", "\u061C"],
    ["ZERO WIDTH JOINER", "\u200D"],
    ["RIGHT-TO-LEFT OVERRIDE", "\u202E"],
    ["WORD JOINER", "\u2060"],
    ["RIGHT-TO-LEFT ISOLATE", "\u2067"],
    ["BYTE ORDER MARK", "\uFEFF"],
  ])("replaces %s with a space", (_name, ch) => {
    expect(normalized("a" + ch + "b")).toBe("a b");
  });

  // Neighbours of the ranges and ordinary non-ASCII text, which must survive.
  it.each([
    ["NO-BREAK SPACE", "\u00A0"],
    ["HAIR SPACE (just below the zero-width range)", "\u200A"],
    ["U+2065 (the gap between two ranges)", "\u2065"],
    ["LATIN SMALL LETTER E WITH ACUTE", "\u00E9"],
    ["HANGUL SYLLABLE HAN", "\uD55C"],
    ["an emoji surrogate pair", "\uD83D\uDE00"],
  ])("leaves %s untouched", (_name, ch) => {
    expect(normalized("a" + ch + "b")).toBe("a" + ch + "b");
  });
});
