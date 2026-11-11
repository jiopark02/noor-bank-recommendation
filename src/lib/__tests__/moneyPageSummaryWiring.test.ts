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

  // Red if: the summary request stops naming the browser's time zone, so the
  // server counts dates in UTC for every user.
  it("sends the browser's time zone with the summary request", () => {
    const loadSummary = slice("const loadSummary = useCallback(", "const loadTransactions =");
    expect(loadSummary).toContain("body: JSON.stringify({ timeZone: browserTimeZone() }),");
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

/*
 * Dollar amounts on the screen.
 *
 * Every amount drawn in the page's markup is either inside MoneyFigure (which
 * draws no amount while loading or after a failed load) or a row value
 * (`item.`, `account.`, `txn.`) from a list that is emptied when a load starts
 * and filled only by a successful answer. Transaction rows are not wrapped in
 * MoneyFigure on purpose: they come from their own route, and a failed summary
 * must not hide a list that did load.
 *
 * Mutations that turn this block red:
 *   - a recurring total (or any figure) moved out of MoneyFigure
 *   - a list no longer emptied when a load starts, or filled from an answer
 *     without the ready gate
 */
const FORMAT_CALL = /\bformat(?:Cents|CentsOrDash|MonthlyOrUnknown|Spending)\(([^)]*)\)/g;
const ROW_VALUE = /^\s*(?:item|account|txn)\./;

function amountsOutsideMoneyFigure(jsx: string): { guarded: number; rows: number; bare: string[] } {
  const ranges: Array<[number, number]> = [];
  const open = /<MoneyFigure state=\{moneyDisplay\}>/g;
  for (let m = open.exec(jsx); m; m = open.exec(jsx)) {
    const close = jsx.indexOf("</MoneyFigure>", m.index);
    ranges.push([m.index, close < 0 ? jsx.length : close]);
  }
  let guarded = 0;
  let rows = 0;
  const bare: string[] = [];
  FORMAT_CALL.lastIndex = 0;
  for (let m = FORMAT_CALL.exec(jsx); m; m = FORMAT_CALL.exec(jsx)) {
    const at = m.index;
    if (ranges.some(([s, e]) => at > s && at < e)) guarded++;
    else if (ROW_VALUE.test(m[1])) rows++;
    else bare.push(m[0]);
  }
  return { guarded, rows, bare };
}

describe("money screen: no amount drawn while loading or after a failure", () => {
  const JSX = slice("<PageLayout>", "</PageLayout>");

  it("every amount is inside MoneyFigure or is a row value", () => {
    const found = amountsOutsideMoneyFigure(JSX);
    expect(found.bare).toEqual([]);
    expect(found.guarded).toBeGreaterThanOrEqual(6);
    expect(found.rows).toBeGreaterThan(0);
    expect(JSX).not.toMatch(/toFixed\(/);
  });

  it("row values come only from the lists below", () => {
    const bindings = JSX.match(/\.map\(\(\s*(?:item|account|txn)\b/g) ?? [];
    const fromLists =
      JSX.match(
        /(?:figures\.recurringItems|accounts|transactions)\.map\(\(\s*(?:item|account|txn)\b/g
      ) ?? [];
    expect(bindings.length).toBeGreaterThan(0);
    expect(fromLists.length).toBe(bindings.length);
  });

  it("the lists are filled only from a ready answer and emptied when a load starts", () => {
    expect(PAGE).toContain('const summary = view.figures === "ready" && bank ? bank.summary : null;');
    expect(PAGE).toContain("const accounts = summary && bank ? bank.accounts : [];");
    expect(PAGE).toContain("recurringItems: summary ? summary.recurring.items : [],");

    const fetchData = slice("const fetchData = useCallback(", "useEffect(() => {");
    const firstAwait = fetchData.indexOf("await ");
    const reset = fetchData.slice(fetchData.indexOf("setHasMoneyData(false);"), firstAwait);
    expect(reset).toContain("setBank(null);");
    expect(reset).toContain("setTransactions([]);");

    const loadSummary = slice("const loadSummary = useCallback(", "const loadTransactions =");
    const loadTransactions = slice("const loadTransactions = useCallback(", "const fetchData =");
    const elsewhere = PAGE.replace(loadSummary, "").replace(loadTransactions, "");
    expect(loadSummary).toContain("setBank(parsed);");
    expect(loadTransactions).toContain("setTransactions(parsed.transactions);");
    expect(elsewhere.match(/setBank\((?!null\))/g) ?? []).toEqual([]);
    expect(elsewhere.match(/setTransactions\((?!\[\]\))/g) ?? []).toEqual([]);
    // Each loader runs only from fetchData, after its reset.
    expect(elsewhere.match(/loadSummary\(/g) ?? []).toHaveLength(1);
    expect(elsewhere.match(/loadTransactions\(/g) ?? []).toHaveLength(1);
    expect(fetchData).toContain("loadSummary(plaidHeaders)");
    expect(fetchData).toContain("loadTransactions(plaidHeaders)");
  });
});

/*
 * The screen sees only the fields bankSummaryView checks, and shows the
 * incomplete-period line from both responses.
 *
 * Mutations that turn this block red:
 *   - the summary state typed with the route's full body type again
 *   - the period line dropped, or moved away from the 90-day figures
 *   - the list's period not reset when a load starts
 */
describe("money screen: checked fields and the incomplete-period line", () => {
  it("holds the responses in the checked types only", () => {
    expect(PAGE).toContain("useState<ScreenSummaryResponse | null>(null)");
    expect(PAGE).toContain("useState<ScreenTransaction[]>([])");
    expect(PAGE).not.toMatch(/\bFinanceSummaryResponse\b/);
    expect(PAGE).not.toMatch(/\bTransactionsListResponse\b/);
    expect(PAGE).not.toMatch(/\bDisplayTransaction\b/);
    expect(PAGE).not.toMatch(/\bFinancialSummary\b/);
    expect(PAGE).not.toMatch(/\bas any\b|as unknown as/);
  });

  it("puts the period line next to the 90-day figures and on the list", () => {
    expect(PAGE).toContain("const periodNote = summaryPeriodNote(view, bank);");
    const ninety = slice("Last 90 days</p>", "Income</p>");
    expect(ninety).toContain("{periodNote}");

    expect(PAGE).toContain(
      "const transactionsPeriodNote = incompletePeriodNote(transactionsCompleteness);"
    );
    expect(PAGE).toContain("setTransactionsCompleteness(parsed.period.completeness);");
    const list = slice('key="transactions"', "transactions.map(");
    expect(list).toContain("{transactionsPeriodNote}");

    // In the reset that runs when a load starts, not only in the
    // no-connection branch.
    const fetchData = slice("const fetchData = useCallback(", "useEffect(() => {");
    const reset = fetchData.slice(
      fetchData.indexOf("setHasMoneyData(false);"),
      fetchData.indexOf("await ")
    );
    expect(reset).toContain("setTransactionsCompleteness(null);");
  });
});

/*
 * Every field the check lists is read by a screen or by bankSummaryView, so
 * the check does not refuse bodies over a field nothing reads. Name-level
 * only: it sees `.field` anywhere in those sources. The other direction (a
 * field read but not listed) is a type error, because the screens hold the
 * checked types.
 *
 * Mutation that turns this red: a field added to a list that no screen reads.
 */
describe("the field lists name only fields that are read", () => {
  const read = (rel: string) =>
    code(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

  it("each listed field name is read somewhere", async () => {
    const { SUMMARY_RESPONSE_FIELDS, TRANSACTIONS_RESPONSE_FIELDS } = await import(
      "../bankSummaryView"
    );
    const view = read("../bankSummaryView.ts");
    const listStart = view.indexOf("const CONNECTION_FIELDS =");
    const listEnd = view.indexOf("export type ScreenSummaryResponse");
    expect(listStart).toBeGreaterThan(-1);
    expect(listEnd).toBeGreaterThan(listStart);
    const readers =
      view.slice(0, listStart) +
      view.slice(listEnd) +
      PAGE +
      read("../../app/dashboard/page.tsx");

    const names = new Set<string>();
    const walk = (node: unknown) => {
      if (node === null || typeof node !== "object") return;
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (key === "oneOf") continue;
        if (key !== "listOf" && key !== "orNull") names.add(key);
        walk(child);
      }
    };
    walk(SUMMARY_RESPONSE_FIELDS);
    walk(TRANSACTIONS_RESPONSE_FIELDS);
    expect(names.size).toBeGreaterThan(20);

    const unread = Array.from(names).filter((n) => !new RegExp(`\\.${n}\\b`).test(readers));
    expect(unread).toEqual([]);
  });
});
