import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe: the money screen's figures, accounts and re-link targets come
 * from the finance summary route, and the screen keeps no arithmetic of its own
 * over bank data.
 *
 * WHY A SOURCE PROBE
 * money/page.tsx is a client page with no DOM environment here, and a page
 * file may not export helpers. What it shows is decided by bankSummaryView,
 * whose rules bankSummaryView.test.ts executes; this file checks that the page
 * goes through those helpers and has not grown its own path around them.
 *
 * Mutations that turn this file red:
 *   - the re-link target taken from a position in the connection list
 *   - the accounts route fetched again, or a total computed in the page
 *   - the summary reset moved after the first await
 *   - the figures decided without summaryLoadInputs / decideBankView
 *   - a re-link failure written into the hook's shared `error`, or fed into
 *     the figures' inputs by the page
 */

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PAGE = code(
  readFileSync(fileURLToPath(new URL("../../app/money/page.tsx", import.meta.url)), "utf8")
);

function slice(from: string, to: string): string {
  const start = PAGE.indexOf(from);
  const end = PAGE.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw new Error(
      `money/page.tsx: could not bound the region between \`${from}\` and \`${to}\`; re-point these anchors.`
    );
  }
  return PAGE.slice(start, end);
}

describe("money screen reads the finance summary", () => {
  it("re-links the connection the summary named, never a list position", () => {
    expect(PAGE).not.toMatch(/connections\[\s*0\s*\]/);
    expect(PAGE).toContain("handleRelink(action.itemId)");
    expect(PAGE).toContain('action.kind === "relink"');
  });

  it("fetches the summary for figures and no other bank-data route but the list", () => {
    expect(PAGE).not.toContain("/api/plaid/accounts");
    const fetched = (PAGE.match(/fetch\(\s*"([^"]+)"/g) ?? []).map((m) =>
      m.replace(/fetch\(\s*"/, "").replace(/"$/, "")
    );
    expect(fetched.sort()).toEqual(
      ["/api/finance/summary", "/api/plaid/exchange-token", "/api/plaid/transactions"].sort()
    );
  });

  it("keeps no arithmetic of its own over bank data", () => {
    expect(PAGE).not.toMatch(/\.reduce\(/);
    expect(PAGE).not.toContain("Net Worth");
    expect(PAGE).not.toContain("netWorth");
    expect(PAGE).not.toContain("Spending by Category");
    expect(PAGE).not.toContain("CATEGORY_COLORS");
    expect(PAGE).not.toContain("current_balance");
    expect(PAGE).not.toContain("credit_limit");
    // Subscriptions come from the engine, not from the transactions route.
    expect(PAGE).not.toContain(".subscriptions");
  });

  it("drops the previous answer before the request", () => {
    const fetchData = slice("const fetchData = useCallback(", "useEffect(() => {");
    const resetAt = fetchData.search(
      /setHasMoneyData\(false\);\s*setError\(null\);\s*setBank\(null\);/
    );
    expect(resetAt).toBeGreaterThan(-1);
    expect(resetAt).toBeLessThan(fetchData.indexOf("await "));
  });

  it("decides what to show through bankSummaryView", () => {
    expect(PAGE).toMatch(/decideBankView\(\{\s*\.\.\.summaryLoadInputs\(\{/);
    expect(PAGE).toContain("const moneyDisplay: MoneyDisplayState = view.figures;");
    expect(PAGE).toContain("missingBanksNote(view.missingFrom)");
    expect(PAGE).toContain("parseFinanceSummaryResponse(");
    expect(PAGE).toContain("{formatSpending(figures.spending)}");
    expect(PAGE).toContain("formatMonthlyOrUnknown(figures.recurringMonthly)");
  });

  // Red if: the hook writes a re-link failure into its shared `error` again,
  // or the page feeds its own re-link failure into the figures' inputs.
  it("a failed re-link request stays on its bank's line", () => {
    const hook = code(
      readFileSync(
        fileURLToPath(new URL("../../hooks/usePlaidConnections.ts", import.meta.url)),
        "utf8"
      )
    );
    const fetchStart = hook.indexOf("const fetchConnections =");
    const fetchEnd = hook.indexOf("const disconnect =", fetchStart);
    expect(fetchStart).toBeGreaterThan(-1);
    expect(fetchEnd).toBeGreaterThan(fetchStart);
    const outsideListRead = hook.slice(0, fetchStart) + hook.slice(fetchEnd);
    expect(hook.slice(fetchStart, fetchEnd)).toContain("setError(");
    expect(outsideListRead).not.toContain("setError(");

    const inputs = slice("...summaryLoadInputs({", "}),");
    expect(inputs).toContain("connectionsFailed: !!plaidConnections.error,");
    expect(inputs).not.toContain("relink");

    const handleRelink = slice("const handleRelink = useCallback(", "const handleRelinkSuccess");
    expect(handleRelink).toMatch(/catch \(err\) \{[^}]*setRelinkFailedItemId\(itemId\);/);
    expect(PAGE).toContain("bankActionLines(view.actions, relinkFailedItemId)");
  });

  it("every figure in the balance and 90-day cards is guarded", () => {
    const cards = slice("Spendable cash</p>", "Monthly Subscriptions");
    const figureUses = cards.match(/figures\.\w+/g) ?? [];
    const guarded = cards.match(/<MoneyFigure state=\{moneyDisplay\}>\s*[^<]*figures\.\w+/g) ?? [];
    expect(figureUses.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(figureUses.length);
  });
});
