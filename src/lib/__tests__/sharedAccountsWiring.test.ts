import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the shared-accounts list's wiring on the dashboard. It
 * executes nothing; the decisions are executed in sharedAccountsClient.test.ts.
 *
 * Mutations and the test each one turns red:
 *   an amount formatted, or a figure named, in the household card file  -> W1
 *   the list mounted twice, given props, or outside the two-person view  -> W1
 *   browser storage, a direct fetch, getSessionSafe or a sign-out in the
 *     list or its decisions                                              -> W1
 *   a total computed in the list or its decisions                       -> W1
 */

const SRC = path.resolve(__dirname, "../..");

function read(file: string): string {
  return readFileSync(path.join(SRC, file), "utf8").replace(/\r\n/g, "\n");
}

/** Comments removed, so a sentence saying what the code does not do is not code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const CARD = read("app/dashboard/HouseholdCard.tsx");
const LIST = code(read("app/dashboard/SharedAccounts.tsx"));
const CLIENT = code(read("lib/sharedAccountsClient.ts"));

describe("shared accounts wiring", () => {
  it("W1 the card mounts the list once, with no props, only for a two-person household, and formats no amount itself", () => {
    expect(CARD.split("<SharedAccounts").length - 1).toBe(1);
    expect(CARD).toContain("{!view.showInviteLink && (\n            <div className=\"mt-4\">\n              <SharedAccounts />\n            </div>\n          )}");
    expect(CARD).not.toMatch(/formatCents|Cents|\$\{?amount/i);
  });

  it("W1 the list and its decisions use no browser storage, no direct fetch, no unsafe session read, no sign-out and no total", () => {
    for (const [name, source] of [
      ["SharedAccounts.tsx", LIST],
      ["sharedAccountsClient.ts", CLIENT],
    ] as const) {
      expect(source, name).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(source, name).not.toMatch(/\bfetch\(/);
      expect(source, name).not.toMatch(/getSessionSafe|getSupabaseBearerHeaders|signOut|runSignOut/);
      expect(source, name).not.toMatch(/\.reduce\(|\btotal\b|\bsum\b/i);
    }
    expect(LIST).toContain('readSession(undefined, "dashboard-mount")');
    expect(LIST).toContain("export default function SharedAccounts() {");
    // Amounts are formatted in the decisions, not in the component.
    expect(LIST).not.toMatch(/formatCents/);
  });

  it("F5 the list renders the sentence for a bank that was read and has no account", () => {
    expect(LIST).toContain(
      "{bank.empty !== null && (\n                <p className=\"text-sm text-gray-500\">{bank.empty}</p>\n              )}"
    );
  });
});
