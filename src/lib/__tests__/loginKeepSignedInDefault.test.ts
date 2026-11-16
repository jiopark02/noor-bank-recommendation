import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source probe of /login: "Keep me signed in" starts checked, so a user who
 * does not touch it keeps the persistent cookies; unchecking it is the choice
 * that makes the session end with the browser.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/login/page.tsx", import.meta.url)),
  "utf8"
);
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")
  .replace(/\s+/g, " ");

describe("login: Keep me signed in default", () => {
  it("starts checked", () => {
    expect(CODE).toContain("const [keepSignedIn, setKeepSignedIn] = useState(true);");
    expect(CODE).not.toContain("const [keepSignedIn, setKeepSignedIn] = useState(false);");
  });
});
