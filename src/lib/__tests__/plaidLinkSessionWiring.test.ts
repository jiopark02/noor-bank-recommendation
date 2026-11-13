import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe: how PlaidLinkButton and the money screen are wired to the link
 * session. There is no DOM environment here to run the components; the session
 * logic itself is executed in plaidLinkSession.test.ts. What the screen does in
 * a browser is a live check.
 *
 * Mutations that turn this file red:
 *   - an effect in PlaidLink.tsx asks for a token, or presses the session
 *     (a token fetched on mount again)                        -> "no effect asks"
 *   - the request moved out of the press handler              -> "the press"
 *   - the Link runner not keyed on the token                  -> "keyed"
 *   - the error sentence shown in place of the button again   -> "stays pressable"
 *   - the re-link button's exit no longer drops the token     -> "re-link exit"
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n"
  );
}

/** Comments removed, so assertions are about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PLAID_LINK = code(read("../../components/plaid/PlaidLink.tsx"));
const MONEY = code(read("../../app/money/page.tsx"));

/** Every useEffect call in `source`, from its opening to its dependency list. */
function effects(source: string): string[] {
  const found: string[] = [];
  let at = source.indexOf("useEffect(");
  while (at >= 0) {
    const end = source.indexOf("]);", at);
    expect(end, "an effect without a dependency list").toBeGreaterThan(at);
    found.push(source.slice(at, end + 3));
    at = source.indexOf("useEffect(", end);
  }
  return found;
}

/** The PlaidLinkButton component alone. */
function buttonSource(): string {
  const start = PLAID_LINK.indexOf("export function PlaidLinkButton(");
  const end = PLAID_LINK.indexOf("interface ConnectBankCardProps", start);
  if (start < 0 || end < 0) {
    throw new Error("PlaidLink.tsx: could not bound PlaidLinkButton; re-point these anchors.");
  }
  return PLAID_LINK.slice(start, end);
}

describe("PlaidLinkButton wiring", () => {
  it("no effect asks for a token or presses the session", () => {
    const all = effects(PLAID_LINK);
    expect(all.length).toBeGreaterThan(0);
    for (const effect of all) {
      expect(effect).not.toContain("create-link-token");
      expect(effect).not.toContain("requestNewLinkToken");
      expect(effect).not.toContain("requestToken");
      expect(effect).not.toContain(".click(");
      expect(effect).not.toContain("fetch(");
    }
  });

  it("the press is the only place the session is asked to start", () => {
    const button = buttonSource();
    expect(button.split("session.click()").length - 1).toBe(1);
    expect(button).toContain("onClick={() => session.click()}");
    expect(PLAID_LINK.split("requestNewLinkToken").length - 1).toBe(2);
    expect(button).toContain("requestToken: requestNewLinkToken,");
  });

  it("the Link runner is keyed on the token, so each token gets a fresh Link instance", () => {
    const button = buttonSource();
    expect(button).toMatch(/<LinkSessionRunner\s+key=\{token\}/);
    expect(PLAID_LINK.split("usePlaidLink(").length - 1).toBe(1);
    const runner = PLAID_LINK.slice(
      PLAID_LINK.indexOf("function LinkSessionRunner("),
      PLAID_LINK.indexOf("interface PlaidLinkButtonProps")
    );
    expect(runner).toContain("usePlaidLink(config)");
  });

  it("exit and success drop the token before the caller hears of it", () => {
    const button = buttonSource();
    expect(button).toMatch(/const handleSuccess = [\s\S]*?session\.finished\(\);\s*onSuccess\(/);
    expect(button).toMatch(/const handleExit = useCallback\(\(\) => \{\s*session\.finished\(\);\s*onExit\?\.\(\);/);
  });

  it("an error sentence leaves the button on screen, so it stays pressable", () => {
    const button = buttonSource();
    expect(button).not.toMatch(/if \(error\) \{\s*return/);
    expect(button).toContain("{error && (");
  });
});

describe("money screen re-link", () => {
  it("re-link exit drops the re-link token", () => {
    const start = MONEY.indexOf("const handleRelinkExit = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = MONEY.slice(start, MONEY.indexOf("}, []);", start));
    expect(body).toContain("setRelinkToken(null);");
    expect(MONEY).toMatch(
      /linkTokenOverride=\{relinkToken\}\s+onSuccess=\{handleRelinkSuccess\}\s+onExit=\{handleRelinkExit\}/
    );
  });
});
