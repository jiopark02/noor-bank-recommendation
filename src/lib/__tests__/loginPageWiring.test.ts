import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe of the login page's local-profile write: both ways the first
 * name is filled (the public.users row, or Auth metadata when there is no
 * row) go through firstNameForClient before the profile is stored, and the
 * row's metadata is still spread last. firstNameForClient itself is executed
 * in defaultFirstName.test.ts; this file does not render the page.
 *
 * Mutations of page.tsx and the tests each one turns red:
 *   G1  the firstNameForClient import removed                     -> L1
 *   G2  the row path storing first_name as read                   -> L2, L3
 *   G3  the metadata path storing the name as read                -> L2
 *   G4  the metadata spread moved ahead of the names              -> L3
 *   G5  the profile stored before the names are filled            -> L4
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

describe("login page wiring: first name in the local profile", () => {
  it("L1 imports firstNameForClient from the shared module", () => {
    expect(mask(source, false)).toMatch(
      /import \{ firstNameForClient \} from "@\/lib\/defaultFirstName";/
    );
  });

  it("L2 both first-name sources go through firstNameForClient", () => {
    expect(submit.split("firstName: firstNameForClient(").length - 1).toBe(2);
    expect(submit).toMatch(
      /firstName: firstNameForClient\( ?user\.user_metadata\?\.first_name \|\|/
    );
  });

  it("L3 the row path converts first_name and still spreads its metadata last", () => {
    expect(submit).toContain(
      'firstName: firstNameForClient(profileRow.first_name), lastName: profileRow.last_name || "", ...(profileRow.raw_user_meta_data || {}),'
    );
  });

  it("L4 the profile is stored after both names are filled", () => {
    const metadataPath = submit.indexOf("firstName: firstNameForClient( user.user_metadata");
    const rowPath = submit.indexOf("firstName: firstNameForClient(profileRow.first_name)");
    const store = submit.indexOf('localStorage.setItem( "noor_user_profile"');
    expect(metadataPath).toBeGreaterThan(-1);
    expect(rowPath).toBeGreaterThan(metadataPath);
    expect(store).toBeGreaterThan(rowPath);
  });
});
