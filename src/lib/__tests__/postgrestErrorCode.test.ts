import { describe, it, expect } from "vitest";
import { postgrestErrorCode, storeResultFromInsert } from "../plaidApiUtils";
import { isDefiniteDbRejection } from "../plaidExchange";

/**
 * postgrestErrorCode, executed: a code reaches a log line only when it has the
 * shape of a symbolic code, and is otherwise replaced whole.
 *
 * The value is interpolated into single-line `key=value` log records, so a
 * string carrying a line break, a space or an `=` could forge a second record
 * or a second field. Trimming and cutting such a string still echoes part of
 * it; the function echoes none of it.
 *
 * Mutations that turn this file red:
 *   - the shape check replaced by trim-and-cut again        -> "replaces"
 *   - the anchors dropped from the pattern                  -> "replaces"
 *   - a well-formed code rewritten or replaced              -> "returns"
 *   - a non-string code reported as "invalid" (or echoed)   -> "null"
 *   - 23505 no longer read as a duplicate                   -> "decisions"
 */

const SENTINEL = "SENTINEL_never_in_a_log_91c7ab";

describe("postgrestErrorCode — only a symbolic code is echoed", () => {
  it("returns a SQLSTATE, a PostgREST code and a node code unchanged", () => {
    const codes = ["23505", "42501", "40001", "57P01", "PGRST301", "PGRST116", "ENOENT"];
    for (let i = 0; i < codes.length; i++) {
      expect(postgrestErrorCode({ code: codes[i], message: SENTINEL })).toBe(
        codes[i]
      );
    }
  });

  it("returns a code at the length bound unchanged", () => {
    const code = "C".repeat(32);
    expect(postgrestErrorCode({ code })).toBe(code);
  });

  it("replaces a string of any other shape with \"invalid\", echoing none of it", () => {
    const codes = [
      `42501\nlevel=info forged=${SENTINEL}`,
      `42501\r\n${SENTINEL}`,
      `42501 ${SENTINEL}`,
      `code=${SENTINEL}`,
      "42501=1",
      " 42501",
      "42501 ",
      "42501\n",
      "\t42501",
      "42-501",
      "",
      "   ",
      "C".repeat(33),
      `${"C".repeat(32)}${SENTINEL}`,
    ];
    for (let i = 0; i < codes.length; i++) {
      const result = postgrestErrorCode({ code: codes[i] });
      expect(result).toBe("invalid");
    }
  });

  it("returns null when there is no string code to judge", () => {
    expect(postgrestErrorCode(null)).toBeNull();
    expect(postgrestErrorCode(undefined)).toBeNull();
    expect(postgrestErrorCode("42501")).toBeNull();
    expect(postgrestErrorCode({})).toBeNull();
    expect(postgrestErrorCode({ message: SENTINEL })).toBeNull();
    expect(postgrestErrorCode({ code: 42501 })).toBeNull();
    expect(postgrestErrorCode({ code: null })).toBeNull();
    expect(postgrestErrorCode({ code: { toString: () => SENTINEL } })).toBeNull();
    expect(postgrestErrorCode(new Error(SENTINEL))).toBeNull();
  });

  it("reads the code of a thrown Error the same way", () => {
    const thrown = new Error(SENTINEL) as Error & { code?: string };
    thrown.code = "ECONNRESET";
    expect(postgrestErrorCode(thrown)).toBe("ECONNRESET");

    thrown.code = `ECONNRESET\n${SENTINEL}`;
    expect(postgrestErrorCode(thrown)).toBe("invalid");
  });
});

describe("postgrestErrorCode — the decisions made on its result", () => {
  it("still reads a well-formed 23505 as a duplicate, and other SQLSTATEs as before", () => {
    expect(storeResultFromInsert({ code: "23505" })).toEqual({
      ok: false,
      kind: "duplicate_item",
      dbErrorCode: "23505",
    });
    expect(storeResultFromInsert({ code: "23514" })).toEqual({
      ok: false,
      kind: "db",
      dbErrorCode: "23514",
    });
    expect(isDefiniteDbRejection(postgrestErrorCode({ code: "23514" }))).toBe(true);
    expect(isDefiniteDbRejection(postgrestErrorCode({ code: "08006" }))).toBe(false);
  });

  it("treats a rejected code as a failure with no usable code", () => {
    // Not a duplicate, and not a definite rejection: the exchange re-reads the
    // row before deciding, which is the direction that revokes nothing on a
    // guess.
    expect(storeResultFromInsert({ code: " 23505 " })).toEqual({
      ok: false,
      kind: "db",
      dbErrorCode: "invalid",
    });
    expect(isDefiniteDbRejection("invalid")).toBe(false);
  });
});
