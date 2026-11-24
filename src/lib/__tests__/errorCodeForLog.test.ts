import { describe, expect, it } from "vitest";
import { errorCodeForLog } from "../errorCodeForLog";
import { codeBySourceFile } from "./sourceProbe";

/**
 * errorCodeForLog, executed, and the one place it is defined.
 *
 * Mutations and the test each one turns red:
 *   the code passed through without logSafeCode, or the message, details or
 *   the error itself returned                                         -> E1
 *   the cause's code not read, or read before the error's own         -> E1
 *   a throwing property escaping instead of "none"                     -> E1
 *   a copy defined in another file (the chat route kept its own)       -> E2
 */

const SENTINEL = "sentinel-row-content-4417 balance $1,234.56";

describe("errorCodeForLog", () => {
  it("E1 returns a short code, from the error or its cause, and never its text", () => {
    expect(errorCodeForLog({ code: "23505", message: SENTINEL })).toBe("23505");
    expect(errorCodeForLog(new Error(SENTINEL, { cause: { code: "PGRST116", details: SENTINEL } }))).toBe(
      "PGRST116"
    );
    // The error's own code comes first.
    expect(errorCodeForLog({ code: "NR001", cause: { code: "23505" } })).toBe("NR001");
    // A code that could carry text is replaced.
    expect(errorCodeForLog({ code: "bad code; " + SENTINEL })).toBe("invalid");
    expect(errorCodeForLog({ code: "x".repeat(33) })).toBe("invalid");
    expect(errorCodeForLog({ code: 42, cause: { code: 7 } })).toBe("none");
    // No code anywhere.
    expect(errorCodeForLog(new Error(SENTINEL))).toBe("none");
    expect(errorCodeForLog(SENTINEL)).toBe("none");
    expect(errorCodeForLog(null)).toBe("none");
    expect(errorCodeForLog(undefined)).toBe("none");
    // A property that throws when read.
    const hostile = Object.defineProperty({}, "code", {
      get() {
        throw new Error(SENTINEL);
      },
    });
    expect(errorCodeForLog(hostile)).toBe("none");
  });

  it("E2 it is defined once, in its own module, and the chat route imports it", () => {
    const code = codeBySourceFile();
    const defining: string[] = [];
    code.forEach((source, file) => {
      if (/\bfunction\s+errorCodeForLog\b|\berrorCodeForLog\s*=\s*(?:\(|function)/.test(source)) {
        defining.push(file);
      }
    });
    expect(defining).toEqual(["lib/errorCodeForLog.ts"]);
    expect(code.get("app/api/chat/route.ts")).toContain(
      'import { errorCodeForLog } from "@/lib/errorCodeForLog";'
    );
  });
});
