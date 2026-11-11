import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe: what the dashboard shows when a bank read fails.
 *
 * Two rules, both about the money figures and the banner above them:
 *
 *  - Text the server did not send never reaches the screen. A fetch that
 *    rejects and a 2xx body that does not parse end as a fixed sentence, not
 *    the browser's or the parser's wording. A server's `error` text is still
 *    shown as it was, and the 404 "no active bank connection" reading still
 *    sees it.
 *  - A 2xx body of the wrong shape is a failed read ("unavailable", a dash),
 *    never an empty one (a real-looking $0.00). The connection list's elements
 *    are always objects; the summary body is checked by
 *    parseFinanceSummaryResponse, whose rules bankSummaryView.test.ts executes.
 *
 * And what the money figures are made of: every amount comes from the finance
 * summary route, and the screen keeps no arithmetic of its own over bank data.
 *
 * WHY A SOURCE PROBE
 * dashboard/page.tsx is a client page with no DOM environment here, and a
 * page file may not export its helpers, so nothing in it can be executed by
 * this suite. What is checked is its text, sliced by the same anchors
 * bankDataBrowserStorage.test.ts uses. What the screen shows is a live check.
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** Comments removed, so assertions are about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const RAW = read("../../app/dashboard/page.tsx");
const PAGE = code(RAW);

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw new Error(
      `dashboard/page.tsx: could not bound the region between \`${from}\` and ` +
        `\`${to}\`; re-point these anchors.`
    );
  }
  return source.slice(start, end);
}

const FETCH_OR_FAIL = slice(PAGE, "async function fetchOrFail(", "async function readJsonOrFail(");
const READ_JSON_OR_FAIL = slice(PAGE, "async function readJsonOrFail(", "function isPlainRecord(");
const IS_PLAIN_RECORD = slice(PAGE, "function isPlainRecord(", "export default function");
const MOUNT_EFFECT = slice(PAGE, "useEffect(() => {", "const fetchLiveMoneyData =");
const FETCH_LIVE = slice(PAGE, "const fetchLiveMoneyData =", "useEffect(() => {");

function constantValue(name: string): string {
  const match = new RegExp(`const ${name} =\\s*"([^"]*)"`).exec(RAW);
  if (!match) {
    throw new Error(`dashboard/page.tsx: could not read the ${name} literal.`);
  }
  return match[1];
}

describe("dashboard bank reads: no browser or parser wording on screen", () => {
  it("every fetch goes through fetchOrFail", () => {
    // Red if: any request calls fetch( directly again.
    const calls = PAGE.match(/\bfetch\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(FETCH_OR_FAIL).toMatch(/\bfetch\(/);
  });

  it("every body read outside an error path goes through readJsonOrFail", () => {
    // Red if: a 2xx body is parsed with a bare `.json()` again. The non-2xx
    // reads keep `.json().catch(...)` and their own fallback text.
    const bare = PAGE.match(/\.json\(\)(?!\.catch\()/g) ?? [];
    expect(bare).toHaveLength(1);
    expect(READ_JSON_OR_FAIL).toMatch(/\.json\(\)/);
    expect(FETCH_LIVE).toContain("readJsonOrFail(summaryRes, BANK_DATA_LOAD_FAILED)");
    expect(MOUNT_EFFECT).toContain("readJsonOrFail(res, CONNECTIONS_LOAD_FAILED)");
  });

  it("the helpers throw only the message they were given", () => {
    // Red if: a helper rethrows the caught error or builds its text from it.
    for (const helper of [FETCH_OR_FAIL, READ_JSON_OR_FAIL]) {
      expect(helper).toMatch(/catch\s*\{\s*throw new Error\(message\);\s*\}/);
      expect(helper).not.toMatch(/catch\s*\(/);
      expect(helper).not.toContain(".message");
    }
  });

  it("each request names its fixed sentence", () => {
    // Red if: a request is moved to the other block's sentence or to none.
    expect(MOUNT_EFFECT).toMatch(
      /fetchOrFail\(\s*"\/api\/plaid\/connections"[\s\S]*?CONNECTIONS_LOAD_FAILED\s*\)/
    );
    expect(FETCH_LIVE).toMatch(
      /fetchOrFail\(\s*"\/api\/finance\/summary"[\s\S]*?BANK_DATA_LOAD_FAILED\s*\)/
    );
  });

  it("the no-active reading is untouched and the fixed sentences do not trip it", () => {
    // Red if: the regex is removed, or a fixed sentence is worded so that a
    // failed read would be shown as "no connection".
    expect(FETCH_LIVE).toContain("/no active bank connection/i.test(message)");
    const noActive = /no active bank connection/i;
    expect(noActive.test(constantValue("BANK_DATA_LOAD_FAILED"))).toBe(false);
    expect(noActive.test(constantValue("CONNECTIONS_LOAD_FAILED"))).toBe(false);
  });
});

describe("dashboard bank reads: a wrong-shaped 2xx is a failed read", () => {
  it("a non-array connection list is a failed read, not an empty one", () => {
    // Red if: the `: []` fallback comes back.
    expect(MOUNT_EFFECT).toMatch(
      /if \(!Array\.isArray\(payload\.connections\)\) \{\s*throw new Error\(CONNECTIONS_LOAD_FAILED\);/
    );
    expect(MOUNT_EFFECT).not.toMatch(/:\s*\[\]/);
  });

  it("a connection element that is not a plain object is a failed read", () => {
    // Red if: the element check is removed or moved after the status read.
    // The predicate cannot be executed here, so each of its three conditions
    // is checked for by text; red if any one is dropped.
    const check =
      /if \(!payload\.connections\.every\(isPlainRecord\)\) \{\s*throw new Error\(CONNECTIONS_LOAD_FAILED\);/;
    expect(MOUNT_EFFECT).toMatch(check);
    const checkAt = MOUNT_EFFECT.search(check);
    const statusAt = MOUNT_EFFECT.indexOf("list.some(");
    expect(statusAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(statusAt);

    expect(IS_PLAIN_RECORD).toContain("value !== null");
    expect(IS_PLAIN_RECORD).toContain('typeof value === "object"');
    expect(IS_PLAIN_RECORD).toContain("!Array.isArray(value)");
  });

  it("a summary body of the wrong shape is a failed read", () => {
    // Red if: the shape check is dropped, its null is read as empty, or the
    // check moves after the state is set.
    const setAt = FETCH_LIVE.indexOf("setBank(parsed)");
    expect(setAt).toBeGreaterThan(-1);
    expect(FETCH_LIVE).toMatch(
      /const parsed = parseFinanceSummaryResponse\(\s*await readJsonOrFail\(summaryRes, BANK_DATA_LOAD_FAILED\)\s*\);/
    );
    const check = /if \(parsed === null\) \{\s*throw new Error\(BANK_DATA_LOAD_FAILED\);/;
    expect(FETCH_LIVE).toMatch(check);
    expect(FETCH_LIVE.search(check)).toBeLessThan(setAt);
    expect(FETCH_LIVE).not.toMatch(/:\s*\[\]/);
  });
});

describe("dashboard money figures come only from the summary route", () => {
  it("drops the previous answer before the request, so it is never drawn after a failure", () => {
    // Red if: the reset is removed or moved after the first await.
    const resetAt = FETCH_LIVE.search(
      /setHasMoneyData\(false\);\s*setMoneyError\(null\);\s*setBank\(null\);/
    );
    const firstAwait = FETCH_LIVE.indexOf("await ");
    expect(resetAt).toBeGreaterThan(-1);
    expect(resetAt).toBeLessThan(firstAwait);
  });

  it("reads no other bank route", () => {
    // Red if: the accounts or transactions route is fetched again.
    expect(PAGE).not.toContain("/api/plaid/accounts");
    expect(PAGE).not.toContain("/api/plaid/transactions");
    const fetched = PAGE.match(/fetchOrFail\(\s*"([^"]+)"/g) ?? [];
    expect(fetched.map((m) => m.replace(/fetchOrFail\(\s*"/, "").replace(/"$/, ""))).toEqual([
      "/api/plaid/connections",
      "/api/finance/summary",
    ]);
  });

  it("keeps no arithmetic of its own over bank data", () => {
    // Red if: a client-side total, net worth or budget comes back.
    expect(PAGE).not.toMatch(/\.reduce\(/);
    expect(PAGE).not.toContain("Net Worth");
    expect(PAGE).not.toContain("netWorth");
    expect(PAGE).not.toContain("noor_budget");
    expect(PAGE).not.toContain("STORAGE_KEY_BUDGET");
    expect(PAGE).not.toContain("inferredSubscriptions");
  });

  it("decides what to show through bankSummaryView", () => {
    // Red if: the display state, safe-to-spend gate or missing-bank line is
    // decided in the page instead of by the tested helper.
    expect(PAGE).toContain("decideBankView({");
    expect(PAGE).toContain("const moneyDisplay: MoneyDisplayState = view.figures;");
    expect(PAGE).toContain("missingBanksNote(view.missingFrom)");
    expect(PAGE).toContain("if (!view.showSafeToSpend) {");
    // The spending sign is decided by the helper, never typed in front of it.
    expect(PAGE).toContain("{formatSpending(figures.spending)}");
    expect(PAGE).not.toMatch(/-\{formatCents\(figures\.spending\)\}/);
    // The safe-to-spend amount is read only after that gate. (The spendable
    // cash figure, a balance total, may be read before it.)
    const gateAt = PAGE.indexOf("if (!view.showSafeToSpend) {");
    expect(PAGE.indexOf("amountCents")).toBeGreaterThan(gateAt);
    expect(PAGE.indexOf("uncoveredObligationsCents")).toBeGreaterThan(gateAt);
  });
});
