import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe: the link-token error block in PlaidLinkButton shows the error
 * line and nothing else.
 *
 * It used to add a setup hint telling the user to put Plaid API keys in
 * environment variables — an operator instruction, shown to end users on every
 * refusal except the connection limit. The component cannot be rendered here
 * (no DOM environment), so this reads its text. What the screen actually shows
 * is a live check.
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** Comments removed, so assertions are about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PLAID_LINK = code(read("../../components/plaid/PlaidLink.tsx"));

describe("PlaidLinkButton link-token error block", () => {
  it("shows no setup hint", () => {
    // Red if: the hint paragraph is restored, with or without its condition.
    expect(PLAID_LINK).not.toContain("Plaid needs to be configured");
    expect(PLAID_LINK).not.toContain("Add your API keys");
  });

  it("keeps no error-code state that only the hint read", () => {
    // Red if: the code state and its comparison are restored.
    expect(PLAID_LINK).not.toContain("errorCode");
  });
});
