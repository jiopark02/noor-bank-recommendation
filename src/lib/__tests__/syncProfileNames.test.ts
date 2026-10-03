import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { namesFromSyncResponse } from "../syncProfileNames";
import { DEFAULT_FIRST_NAME } from "../profileSync";

/**
 * namesFromSyncResponse, executed, and a source probe of where the OAuth
 * callback applies it.
 *
 * Mutations and the tests each one turns red:
 *   SM1 a null last name returned as null, not ""            -> S2
 *   SM2 the first_name type and empty checks removed         -> S3
 *   SM3 the success check removed                            -> S3
 *   CM1 the callback stops applying the returned names       -> S4
 *   CM2 the callback applies them before building the body   -> S4
 *   SM4 the placeholder first name returned as is            -> S5
 *   CM3 the names applied from something other than the response -> S6
 *   CM4 the local profile stored before the names are applied -> S7
 *
 * S4 and S6 read the callback's source with comments and string-literal
 * contents blanked; S7 blanks only comments, since its subject is a storage
 * key. None of them renders the page.
 */

const CALLBACK = fileURLToPath(
  new URL("../../app/auth/callback/page.tsx", import.meta.url)
);

/** Comments become spaces; with blankStrings, so do literal contents. */
function mask(src: string, blankStrings = true): string {
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

describe("namesFromSyncResponse", () => {
  it("S1 returns the reported pair", () => {
    expect(
      namesFromSyncResponse({ success: true, first_name: "Ana", last_name: "Kim" })
    ).toEqual({ firstName: "Ana", lastName: "Kim" });
  });

  it("S2 maps a null last name to an empty string", () => {
    expect(
      namesFromSyncResponse({ success: true, first_name: "Ana", last_name: null })
    ).toEqual({ firstName: "Ana", lastName: "" });
  });

  it.each([
    ["null", null],
    ["a failure", { success: false, first_name: "x", last_name: null }],
    ["no names", { success: true }],
    ["a non-string first name", { success: true, first_name: 42, last_name: null }],
    ["an empty first name", { success: true, first_name: "", last_name: null }],
    ["a non-string last name", { success: true, first_name: "Ana", last_name: 7 }],
  ])("S3 returns null for %s", (_label, json) => {
    expect(namesFromSyncResponse(json)).toBeNull();
  });

  it.each([
    ["Lee", "Lee"],
    [null, ""],
  ])(
    "S5 returns the placeholder first name as empty and keeps the last name (%j)",
    (lastName, expectedLast) => {
      expect(
        namesFromSyncResponse({
          success: true,
          first_name: DEFAULT_FIRST_NAME,
          last_name: lastName,
        })
      ).toEqual({ firstName: "", lastName: expectedLast });
    }
  );
});

describe("OAuth callback wiring", () => {
  it("S4 applies the returned names to the profile after the request body is built", () => {
    const code = mask(readFileSync(CALLBACK, "utf8")).replace(/\s+/g, " ");
    const bodyAt = code.indexOf("body: JSON.stringify(");
    const applyAt = code.indexOf("namesFromSyncResponse(");
    expect(bodyAt).not.toBe(-1);
    expect(applyAt).toBeGreaterThan(bodyAt);
    expect(code.slice(applyAt)).toMatch(
      /^namesFromSyncResponse\([^;]*\); if \( ?syncedNames ?\) \{ profile = \{ \.\.\.profile, \.\.\.syncedNames \};/
    );
  });

  it("S6 applies names read from the sync response", () => {
    const code = mask(readFileSync(CALLBACK, "utf8")).replace(/\s+/g, " ");
    expect(code).toMatch(/namesFromSyncResponse\( ?await syncRes\.json\(\)/);
  });

  it("S7 stores the local profile only after the names are applied", () => {
    const codeWithStrings = mask(readFileSync(CALLBACK, "utf8"), false).replace(
      /\s+/g,
      " "
    );
    const applyAt = codeWithStrings.indexOf("namesFromSyncResponse(");
    const storeAt = codeWithStrings.indexOf(
      'localStorage.setItem("noor_user_profile"'
    );
    expect(applyAt).not.toBe(-1);
    expect(storeAt).not.toBe(-1);
    expect(storeAt).toBeGreaterThan(applyAt);
  });
});
