import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DISPLAY_WINDOW_DAYS,
  DISPLAY_WINDOW_LABEL,
  bankActionLines,
  banksNotRead,
  browserTimeZone,
  createRequestGate,
  formatCalendarDay,
  creditUsedCents,
  decideBankView,
  describeBankAction,
  formatCents,
  formatCentsOrDash,
  formatMonthlyOrUnknown,
  formatSpending,
  incompletePeriodNote,
  isNoActiveConnectionMessage,
  missingBanksNote,
  parseFinanceSummaryResponse,
  parseSummaryTransactions,
  summaryLoadInputs,
  summaryPeriodNote,
  SUMMARY_RESPONSE_FIELDS,
  SUMMARY_TRANSACTIONS_FIELDS,
  transactionListView,
  utilizationPercent,
  type BankView,
  type FieldSpec,
  type ScreenSummary,
} from "../bankSummaryView";
import { creditUtilizationOf } from "../financeEngine";
import type { EngineAccount } from "../financeEngine";
import type {
  BankConnectionStatus,
  FinanceSummaryResponse,
} from "../plaidEngineAdapter";

/**
 * What the money screens may show, decided from a summary response.
 *
 * Mutations that turn this file red:
 *   - safe-to-spend shown whenever a summary exists               -> incomplete banks
 *   - safe-to-spend decided from the response's connections
 *     instead of the engine's coverage                            -> incomplete banks
 *   - the re-link target taken from the first connection          -> action per bank
 *   - an earlier response drawn after a failed load               -> failed load
 *   - an unknown recurring total formatted as 0 (`?? 0`)          -> formatting
 *   - data issues treated as a connection problem (an action, or
 *     safe-to-spend hidden because dataIssues is non-empty)       -> data issues
 */

/**
 * A summary as the route sends it, written out by hand: these tests are about
 * what the screens do with a summary, whatever engine computed it. Each knob
 * sets what an engine would have decided.
 */
function summary(
  over: {
    showable?: boolean;
    completeness?: "complete" | "possibly_truncated" | "unknown";
    computed?: boolean;
    accounts?: EngineAccount[];
  } = {}
): ScreenSummary {
  const computed = over.computed ?? true;
  return {
    coverage: { safeToSpendShowable: over.showable ?? computed },
    cashFlow: {
      incomeCents: 250000,
      spendingNetCents: 4000,
      period: { completeness: over.completeness ?? "complete" },
    },
    safeToSpend: computed
      ? {
          status: "computed",
          reason: null,
          amountCents: 75000,
          horizon: { to: "2026-11-30", rule: "end_of_calendar_month" },
          totals: { spendableCashCents: 100000 },
        }
      : {
          status: "unavailable",
          reason: "no_cash_account",
          amountCents: null,
          horizon: null,
          totals: null,
        },
    recurring: { totalMonthlyCents: null, items: [] },
    creditUtilization: creditUtilizationOf(over.accounts ?? [], "USD"),
  };
}

const ok = (n: number): BankConnectionStatus => ({
  itemId: `item-${n}`,
  institutionName: `Bank ${n}`,
  status: "ok",
});

/**
 * A summary response. Unless a summary is given, it is the one an engine
 * gives for these connections: shown only when every one was read, and a
 * period that is complete only then.
 */
function response(
  connections: BankConnectionStatus[],
  s?: ScreenSummary | null
): FinanceSummaryResponse {
  const allRead = connections.every((c) => c.status === "ok");
  const computed =
    s !== undefined
      ? s
      : summary({ showable: allRead, completeness: allRead ? "complete" : "unknown" });
  return { success: true, connections, accounts: [], transactions: [], summary: computed };
}

/** A summary that also carries data issues, as an engine reports them. The screens read none. */
function withDataIssues(s: ScreenSummary): ScreenSummary {
  return Object.assign({}, s, { dataIssues: [{ reason: "unclassified_category" }] });
}

describe("decideBankView — figures", () => {
  it("draws nothing while loading", () => {
    expect(
      decideBankView({ hasActiveConnection: true, fetchState: "loading", response: null })
    ).toEqual({ figures: "loading", showSafeToSpend: false, actions: [], missingFrom: [] });
  });

  it("a failed load is unavailable even when an earlier response is held", () => {
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "failed",
      response: response([ok(1)]),
    });
    expect(view.figures).toBe("unavailable");
    expect(view.showSafeToSpend).toBe(false);
  });

  it("no active connection shows the true zeros", () => {
    expect(
      decideBankView({ hasActiveConnection: false, fetchState: "idle", response: null }).figures
    ).toBe("none");
  });

  it("every bank read: figures ready and safe-to-spend shown", () => {
    expect(
      decideBankView({ hasActiveConnection: true, fetchState: "loaded", response: response([ok(1), ok(2)]) })
    ).toEqual({ figures: "ready", showSafeToSpend: true, actions: [], missingFrom: [] });
  });
});

describe("decideBankView — banks that could not be read", () => {
  it("hides safe-to-spend and names each bank with its own action", () => {
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([
        ok(1),
        { itemId: "item-2", institutionName: "Bank 2", status: "login_required" },
        { itemId: "item-3", institutionName: null, status: "syncing" },
        { itemId: "item-4", institutionName: "Bank 4", status: "failed" },
      ]),
    });
    expect(view.figures).toBe("ready");
    expect(view.showSafeToSpend).toBe(false);
    expect(view.actions).toEqual([
      { kind: "relink", itemId: "item-2", institutionName: "Bank 2" },
      { kind: "wait", itemId: "item-3", institutionName: "Your bank" },
      { kind: "retry", itemId: "item-4", institutionName: "Bank 4" },
    ]);
  });

  it("no bank read: figures unavailable, actions still listed", () => {
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response(
        [{ itemId: "item-1", institutionName: "Bank 1", status: "login_required" }],
        null
      ),
    });
    expect(view.figures).toBe("unavailable");
    expect(view.showSafeToSpend).toBe(false);
    expect(view.actions).toEqual([
      { kind: "relink", itemId: "item-1", institutionName: "Bank 1" },
    ]);
  });

  // Red if: the screen decides from the response's connection list again
  // instead of following the engine's decision.
  it("follows the engine's decision, not its own reading of the connections", () => {
    const engineSaysNo = summary({ showable: false, completeness: "unknown" });
    expect(engineSaysNo.coverage.safeToSpendShowable).toBe(false);
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([ok(1), ok(2)], engineSaysNo),
    });
    expect(view.showSafeToSpend).toBe(false);
  });

  it("safe-to-spend the engine could not compute is not shown", () => {
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([ok(1)], summary({ computed: false })),
    });
    expect(view.showSafeToSpend).toBe(false);
  });
});

describe("decideBankView — data issues are information, not a task", () => {
  it("catch-all transactions neither hide safe-to-spend nor create an action", () => {
    const s = withDataIssues(summary());

    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([ok(1)], s),
    });
    expect(view.showSafeToSpend).toBe(true);
    expect(view.actions).toEqual([]);
  });
});

describe("browserTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the platform's zone", () => {
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  // Red if: a platform that throws or names no zone breaks the request
  // instead of leaving the server to fall back to UTC.
  it("is null when the platform throws or names no zone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no Intl");
    });
    expect(browserTimeZone()).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: "" }) }) as unknown as Intl.DateTimeFormat
    );
    expect(browserTimeZone()).toBeNull();
  });
});

/*
 * Mutations that turn this block red:
 *   - timeZone "UTC" dropped from formatCalendarDay (west of UTC the day
 *     before shows)                                      -> "shows the calendar date as given"
 *   - the gate's token not advanced, or every token current -> "only the latest load is current"
 *   - the label built apart from DISPLAY_WINDOW_DAYS        -> "the window label"
 */
describe("calendar dates, request order and the window label", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("shows the calendar date as given, whatever the viewer's zone", () => {
    for (const tz of ["America/Los_Angeles", "Pacific/Honolulu", "Asia/Tokyo", "UTC"]) {
      process.env.TZ = tz;
      expect(formatCalendarDay("2026-11-01"), tz).toBe("Nov 1");
      expect(formatCalendarDay("2026-12-31"), tz).toBe("Dec 31");
    }
    expect(formatCalendarDay("not a date")).toBe("not a date");
    expect(formatCalendarDay("2026-13-45")).toBe("2026-13-45");
  });

  it("only the latest load is current", () => {
    const gate = createRequestGate();
    const first = gate.begin();
    expect(gate.isCurrent(first)).toBe(true);
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    // Separate screens do not share a gate.
    expect(createRequestGate().isCurrent(second)).toBe(false);
  });

  it("the window label comes from the window length", () => {
    expect(DISPLAY_WINDOW_DAYS).toBe(90);
    expect(DISPLAY_WINDOW_LABEL).toBe(`Last ${DISPLAY_WINDOW_DAYS} days`);
  });
});

describe("formatting", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-50)).toBe("-$0.50");
  });

  it("an unknown monthly total is Unknown, never $0.00", () => {
    expect(formatMonthlyOrUnknown(null)).toBe("Unknown");
    expect(formatMonthlyOrUnknown(0)).toBe("$0.00");
  });

  // Red if: a sign is added in front of formatCents again ("--$5.00"), or
  // net refunds lose their "+".
  it("net spending carries exactly one sign, decided by the value", () => {
    expect(formatSpending(4000)).toBe("-$40.00");
    expect(formatSpending(0)).toBe("-$0.00");
    expect(formatSpending(-500)).toBe("+$5.00");
  });

  it("a missing balance is a dash, never $0.00", () => {
    expect(formatCentsOrDash(null)).toBe("—");
    expect(formatCentsOrDash(0)).toBe("$0.00");
  });
});

/*
 * Figures shown while a bank was not read name the banks they leave out.
 *
 * Mutations that turn this block red:
 *   - the list built from `actions` (one entry per connection, no dedupe)
 *     -> "two unnamed banks are named once"
 *   - names pushed without the duplicate check -> the same test
 *   - the list filled from data issues        -> "data issues alone leave the list empty"
 */
describe("decideBankView — banks the figures leave out", () => {
  const notRead = (
    n: number,
    status: BankConnectionStatus["status"],
    name: string | null = `Bank ${n}`
  ): BankConnectionStatus => ({ itemId: `item-${n}`, institutionName: name, status });

  it("one bank not read: figures stay, and the line names it", () => {
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([ok(1), notRead(2, "login_required")]),
    });
    expect(view.figures).toBe("ready");
    expect(view.missingFrom).toEqual(["Bank 2"]);
    expect(missingBanksNote(view.missingFrom)).toBe("Doesn't include Bank 2");
  });

  it("two and three banks read as a list", () => {
    expect(missingBanksNote(["Bank 2", "Bank 3"])).toBe("Doesn't include Bank 2 or Bank 3");
    expect(missingBanksNote(["Bank 2", "Bank 3", "Bank 4"])).toBe(
      "Doesn't include Bank 2, Bank 3 or Bank 4"
    );
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([
        notRead(2, "failed"),
        ok(1),
        notRead(3, "syncing"),
        notRead(4, "login_required"),
      ]),
    });
    expect(view.missingFrom).toEqual(["Bank 2", "Bank 3", "Bank 4"]);
  });

  it("two unnamed banks are named once", () => {
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([ok(1), notRead(2, "failed", null), notRead(3, "login_required", null)]),
    });
    expect(view.missingFrom).toEqual(["Your bank"]);
    expect(view.actions).toHaveLength(2);
    expect(missingBanksNote(view.missingFrom)).toBe("Doesn't include Your bank");
  });

  it("data issues alone leave the list empty and the line absent", () => {
    const s = withDataIssues(summary());
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([ok(1)], s),
    });
    expect(view.missingFrom).toEqual([]);
    expect(missingBanksNote(view.missingFrom)).toBeNull();
  });

  it("no line when the figures are not shown", () => {
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([notRead(1, "login_required")], null),
    });
    expect(view.missingFrom).toEqual([]);
  });
});

/*
 * Credit used comes from the per-account credit entries the app computes.
 *
 * Mutations that turn this block red:
 *   - the utilization aggregate used instead (it leaves out cards with no
 *     limit) -> "includes a card with no limit"
 *   - safe-to-spend's reserved card total used instead (absent when the
 *     figure was not computed) -> "is the same whether or not safe-to-spend"
 *   - a missing balance counted as 0 -> "an unknown card balance"
 */
describe("creditUsedCents", () => {
  const card = (id: string, currentCents: number | null, limitCents: number | null, currency = "USD") => ({
    accountId: id,
    type: "credit" as const,
    subtype: "credit card",
    currentCents,
    availableCents: null,
    limitCents,
    currency,
    balanceAsOf: null,
    fetchedAt: "2026-11-11T11:59:00Z",
    duplicateKey: null,
    connectionKey: "c0",
  });
  const checking: EngineAccount = {
    accountId: "chk",
    type: "depository",
    subtype: "checking",
    currentCents: 100000,
    availableCents: 100000,
    limitCents: null,
    currency: "USD",
    balanceAsOf: null,
    fetchedAt: "2026-11-11T11:59:00Z",
    duplicateKey: null,
    connectionKey: "c0",
  };
  // The app computes credit utilization itself (creditUtilizationOf), so the
  // summary carries its per-card entries whatever the engine decided.
  const withCards = (cards: Array<ReturnType<typeof card>>, computed = true) =>
    summary({ accounts: [checking, ...cards], computed });

  it("includes a card with no limit", () => {
    const cards = [card("a", 30000, 100000), card("b", 12000, null)];
    // The utilization aggregate leaves out the card with no limit; the
    // amount owed does not.
    expect(creditUtilizationOf([checking, ...cards], "USD").aggregate.balanceCents).toBe(30000);
    expect(creditUsedCents(withCards(cards))).toBe(42000);
  });

  it("is the same whether or not safe-to-spend was computed", () => {
    const cards = [card("a", 30000, 100000), card("b", 12000, null)];
    const computed = withCards(cards, true);
    const notComputed = withCards(cards, false);
    expect(notComputed.safeToSpend.totals).toBeNull();
    expect(creditUsedCents(computed)).toBe(42000);
    expect(creditUsedCents(notComputed)).toBe(42000);
  });

  it("a credit balance counts as 0, and another currency is left out", () => {
    expect(
      creditUsedCents(withCards([card("a", -5000, 100000), card("c", 7000, 100000, "CAD")]))
    ).toBe(0);
  });

  it("an unknown card balance makes the figure unknown, not 0", () => {
    expect(
      creditUsedCents(withCards([card("a", 30000, 100000), card("b", null, 100000)]))
    ).toBeNull();
  });

  it("no credit accounts is a true 0", () => {
    expect(creditUsedCents(withCards([]))).toBe(0);
  });
});

/*
 * Mutations that turn this block red:
 *   - a missing or non-array field accepted as empty -> "a wrong-shaped body"
 *   - an unknown connection status accepted          -> "an unknown status"
 */
describe("parseFinanceSummaryResponse", () => {
  const good = () => JSON.parse(JSON.stringify(response([ok(1)])));

  it("accepts what the route sends, with and without a summary", () => {
    expect(parseFinanceSummaryResponse(good())).not.toBeNull();
    expect(parseFinanceSummaryResponse({ ...good(), summary: null })).not.toBeNull();
  });

  it("a wrong-shaped body is a failed read", () => {
    const bodies: unknown[] = [
      null,
      [],
      { ...good(), connections: undefined },
      { ...good(), connections: {} },
      { ...good(), accounts: null },
      { ...good(), accounts: [1] },
      { ...good(), summary: undefined },
      { ...good(), summary: { cashFlow: {} } },
    ];
    for (const bad of bodies) {
      expect(parseFinanceSummaryResponse(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("an unknown status is a failed read", () => {
    const body = good();
    body.connections[0].status = "broken";
    expect(parseFinanceSummaryResponse(body)).toBeNull();
  });
});

/*
 * A screen with its own connection list (the money screen) must not draw
 * "no connection" zeros while that list is loading, and must not draw an
 * earlier answer after a failed load.
 *
 * Mutations that turn this block red:
 *   - the loading-connections branch removed     -> "$0.00 while the list loads"
 *   - a failed list read treated as no connection -> "a failed connection list"
 *   - the no-active answer treated as a failure   -> "no active connection"
 *   - a load error ignored when data is held      -> "a failed load after a good one"
 */
describe("summaryLoadInputs", () => {
  const base = {
    connectionsLoading: false,
    connectionsFailed: false,
    hasActiveConnection: true,
    loadError: null as string | null,
    hasData: false,
  };
  const figuresFor = (over: Partial<typeof base>, resp: FinanceSummaryResponse | null = null) =>
    decideBankView({ ...summaryLoadInputs({ ...base, ...over }), response: resp }).figures;

  it("draws no $0.00 while the connection list loads", () => {
    expect(figuresFor({ connectionsLoading: true, hasActiveConnection: false })).toBe("loading");
  });

  it("a failed connection list is a failed load, not no connection", () => {
    expect(figuresFor({ connectionsFailed: true, hasActiveConnection: false })).toBe("unavailable");
  });

  it("no active connection, known, shows the true zeros", () => {
    expect(figuresFor({ hasActiveConnection: false })).toBe("none");
    expect(
      figuresFor({
        loadError: "No active bank connections found. Please connect a bank first.",
      })
    ).toBe("none");
  });

  it("connected and waiting is loading; answered is ready", () => {
    expect(figuresFor({})).toBe("loading");
    expect(figuresFor({ hasData: true }, response([ok(1)]))).toBe("ready");
  });

  it("a failed load after a good one draws nothing from the good one", () => {
    expect(figuresFor({ hasData: true, loadError: "boom" }, response([ok(1)]))).toBe(
      "unavailable"
    );
  });

  it("recognizes the routes' no-active wording only", () => {
    expect(isNoActiveConnectionMessage("No active bank connections found. Please connect a bank first.")).toBe(true);
    expect(isNoActiveConnectionMessage("We couldn't load your bank data right now.")).toBe(false);
    expect(isNoActiveConnectionMessage(null)).toBe(false);
  });
});

/*
 * Mutations that turn this block red:
 *   - the ratio computed from balance and limit on the screen side instead
 *     of read from the engine  -> "an unmeasured card has no percent"
 */
describe("utilizationPercent", () => {
  const withCard = (current: number | null, limit: number | null) =>
    summary({
      accounts: [
        {
          accountId: "card",
          type: "credit",
          subtype: "credit card",
          currentCents: current,
          availableCents: null,
          limitCents: limit,
          currency: "USD",
          balanceAsOf: null,
          fetchedAt: "2026-11-11T11:59:00Z",
          duplicateKey: null,
          connectionKey: "c0",
        },
      ],
    });

  it("reads the engine's ratio as a whole percent", () => {
    expect(utilizationPercent(withCard(25000, 100000), "card")).toBe(25);
  });

  it("an unmeasured card has no percent", () => {
    expect(utilizationPercent(withCard(25000, null), "card")).toBeNull();
    expect(utilizationPercent(withCard(null, 100000), "card")).toBeNull();
    expect(utilizationPercent(withCard(25000, 100000), "other")).toBeNull();
  });
});

/*
 * The transaction list names the banks it could not read, by the same rule
 * as the figures.
 *
 * Mutations that turn this block red:
 *   - an ok connection named                      -> "only banks not read"
 *   - the duplicate check removed                 -> "each name once"
 *   - a wrong-shaped list read as empty           -> "a wrong-shaped list …"
 *   - the list checked with the figures again     -> "a wrong-shaped list …"
 *   - a list that could not be read drawn as rows,
 *     or announced while the figures are not shown -> "the list area …"
 */
describe("banksNotRead and the list body", () => {
  it("only banks not read, each name once, in order", () => {
    expect(
      banksNotRead([
        ok(1),
        { itemId: "a", institutionName: "Bank 2", status: "syncing" },
        { itemId: "b", institutionName: null, status: "failed" },
        { itemId: "c", institutionName: null, status: "login_required" },
      ])
    ).toEqual(["Bank 2", "Your bank"]);
    expect(banksNotRead([ok(1), ok(2)])).toEqual([]);
  });

  // The list arrives in the summary body, next to the figures.
  const withList = () => ({
    ...JSON.parse(JSON.stringify(response([ok(1)]))),
    transactions: [
      {
        transactionId: "t1",
        accountId: "a1",
        amountCents: 1250,
        currency: "USD",
        date: "2026-11-01",
        pending: false,
        name: "Grocer",
        merchantName: null,
        logoUrl: null,
        category: [],
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: null,
      },
    ],
  });

  it("accepts what the route sends", () => {
    expect(parseFinanceSummaryResponse(withList())).not.toBeNull();
    expect(parseSummaryTransactions(withList())).toHaveLength(1);
    expect(parseSummaryTransactions({ ...withList(), transactions: [] })).toEqual([]);
  });

  it("a wrong-shaped list fails the list only, never the figures, and is never read as empty", () => {
    const badLists: unknown[] = [
      { ...withList(), transactions: undefined },
      { ...withList(), transactions: null },
      { ...withList(), transactions: [{ transactionId: "t1", amount: 12.5 }] },
    ];
    for (const bad of badLists) {
      expect(parseFinanceSummaryResponse(bad), JSON.stringify(bad)).not.toBeNull();
      expect(parseSummaryTransactions(bad), JSON.stringify(bad)).toBeNull();
    }
    const withoutList = withList();
    delete withoutList.transactions;
    expect(parseFinanceSummaryResponse(withoutList)).not.toBeNull();
    expect(parseSummaryTransactions(withoutList)).toBeNull();
    expect(parseSummaryTransactions(null)).toBeNull();
    expect(parseSummaryTransactions([])).toBeNull();

    // A wrong-shaped figure part is still a failed read of the whole body.
    const badConnections = {
      ...withList(),
      connections: [{ itemId: "x", institutionName: null, status: "nope" }],
    };
    expect(parseFinanceSummaryResponse(badConnections)).toBeNull();
  });

  it("the list area follows the figures and says when the list could not be read", () => {
    const ready: BankView = { figures: "ready", showSafeToSpend: true, actions: [], missingFrom: [] };
    const rows = parseSummaryTransactions(withList());
    expect(transactionListView(ready, rows)).toEqual({ kind: "rows", rows });
    expect(transactionListView(ready, [])).toEqual({ kind: "rows", rows: [] });
    expect(transactionListView(ready, null)).toEqual({ kind: "unavailable" });
    for (const figures of ["loading", "unavailable", "none"] as const) {
      const view: BankView = { ...ready, figures, showSafeToSpend: false };
      expect(transactionListView(view, null), figures).toEqual({ kind: "hidden" });
      expect(transactionListView(view, rows), figures).toEqual({ kind: "hidden" });
    }
  });
});

/*
 * A failed re-link request is about one bank. The figures, every other bank's
 * line and that bank's own re-link line all stay.
 *
 * Mutations that turn this block red:
 *   - the error attached to every line, or to a line of another kind
 *     -> "only that bank's re-link line carries it"
 *   - the failed bank's line dropped -> "every line stays"
 */
describe("bankActionLines — a failed re-link request", () => {
  const view = decideBankView({
    ...summaryLoadInputs({
      connectionsLoading: false,
      connectionsFailed: false,
      hasActiveConnection: true,
      loadError: null,
      hasData: true,
    }),
    response: response([
      ok(1),
      { itemId: "item-2", institutionName: "Bank 2", status: "login_required" },
      { itemId: "item-3", institutionName: "Bank 3", status: "login_required" },
      { itemId: "item-4", institutionName: "Bank 4", status: "failed" },
    ]),
  });

  it("every line stays, and the figures are still ready", () => {
    expect(view.figures).toBe("ready");
    const lines = bankActionLines(view.actions, "item-2");
    expect(lines.map((l) => l.action)).toEqual(view.actions);
  });

  it("only that bank's re-link line carries it", () => {
    const lines = bankActionLines(view.actions, "item-2");
    expect(lines.map((l) => [l.action.itemId, l.action.kind, l.relinkError])).toEqual([
      [
        "item-2",
        "relink",
        "We couldn't start re-linking Bank 2. Please try again in a moment.",
      ],
      ["item-3", "relink", null],
      ["item-4", "retry", null],
    ]);
  });

  it("an id with no re-link line, or none, attaches nothing", () => {
    for (const id of ["item-4", "item-1", null]) {
      expect(bankActionLines(view.actions, id).every((l) => l.relinkError === null)).toBe(true);
    }
  });
});

/*
 * Every field the screens read is checked: a body missing one, or carrying it
 * with the wrong type, is a failed read. The cases are generated by walking
 * the field lists themselves, so a field added to a list is tested with it.
 *
 * Mutations that turn this block red:
 *   - a kind of field accepted without its check (e.g. "number|null" passing
 *     any value, a list's elements not checked) -> "each listed field, missing
 *     or mistyped"
 *   - unknown fields refused -> "fields that are not listed are ignored"
 *   - a field that may not be null accepting null (e.g. "string" checked as
 *     `value === null || typeof value === "string"`) -> "each listed field,
 *     missing or mistyped"
 */
type Path = Array<string | number>;

function nodesOf(spec: FieldSpec, value: unknown, path: Path, out: Array<{ path: Path; spec: FieldSpec }>) {
  if (path.length > 0) out.push({ path, spec });
  if (typeof spec === "string") return;
  const node = spec as { oneOf?: unknown; listOf?: FieldSpec; orNull?: FieldSpec };
  if (node.oneOf !== undefined) return;
  if (node.listOf !== undefined) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`the good body has no element under ${path.join(".")}; add one`);
    }
    nodesOf(node.listOf, value[0], [...path, 0], out);
    return;
  }
  if (node.orNull !== undefined) {
    if (value === null) throw new Error(`the good body is null at ${path.join(".")}; fill it`);
    const inner = node.orNull as { [field: string]: FieldSpec };
    for (const key of Object.keys(inner)) {
      nodesOf(inner[key], (value as Record<string, unknown>)[key], [...path, key], out);
    }
    return;
  }
  const fields = spec as { [field: string]: FieldSpec };
  for (const key of Object.keys(fields)) {
    nodesOf(fields[key], (value as Record<string, unknown>)[key], [...path, key], out);
  }
}

function wrongValueFor(spec: FieldSpec): unknown {
  switch (spec) {
    case "string":
    case "string|null":
      return 1;
    case "number":
    case "number|null":
      return "1";
    case "boolean":
      return "true";
  }
  const node = spec as { oneOf?: unknown; listOf?: unknown };
  if (node.oneOf !== undefined) return "not-a-listed-value";
  if (node.listOf !== undefined) return {};
  return "not-an-object";
}

function edited(body: unknown, path: Path, edit: (parent: Record<string | number, unknown>, key: string | number) => void) {
  const copy = JSON.parse(JSON.stringify(body));
  let parent = copy;
  for (let i = 0; i < path.length - 1; i++) parent = parent[path[i]];
  edit(parent, path[path.length - 1]);
  return copy;
}

function checksEveryField(spec: FieldSpec, good: unknown, parse: (v: unknown) => unknown) {
  expect(parse(good)).not.toBeNull();
  const nodes: Array<{ path: Path; spec: FieldSpec }> = [];
  nodesOf(spec, good, [], nodes);
  expect(nodes.length).toBeGreaterThan(10);
  for (const { path, spec: fieldSpec } of nodes) {
    const label = path.join(".");
    if (typeof path[path.length - 1] === "string") {
      const missing = edited(good, path, (p, k) => {
        delete p[k];
      });
      expect(parse(missing), `missing ${label}`).toBeNull();
    }
    const wrong = edited(good, path, (p, k) => {
      p[k] = wrongValueFor(fieldSpec);
    });
    expect(parse(wrong), `wrong type at ${label}`).toBeNull();
    if (fieldSpec === "string|null" || fieldSpec === "number|null") {
      const asNull = edited(good, path, (p, k) => {
        p[k] = null;
      });
      expect(parse(asNull), `null at ${label}`).not.toBeNull();
    } else if ((fieldSpec as { orNull?: unknown }).orNull === undefined) {
      // A field the list does not allow to be null: an explicit null is a
      // failed read, the same as a missing field.
      const asNull = edited(good, path, (p, k) => {
        p[k] = null;
      });
      expect(parse(asNull), `null at non-null ${label}`).toBeNull();
    }
  }
}

describe("response bodies — every field the screens read is checked", () => {
  // Written out field by field, so every listed field is present with a
  // non-null value wherever the list allows one: a summary as the route sends
  // it, whatever engine computed the figures.
  const richSummary = () => ({
    coverage: { safeToSpendShowable: true },
    cashFlow: { incomeCents: 250000, spendingNetCents: 4000, period: { completeness: "complete" } },
    safeToSpend: {
      status: "computed",
      reason: null,
      amountCents: 73500,
      horizon: { to: "2026-11-30", rule: "end_of_calendar_month" },
      totals: { spendableCashCents: 100000 },
    },
    recurring: {
      totalMonthlyCents: 1500,
      items: [
        {
          streamId: "s1",
          label: "Streaming",
          monthlyCents: 1500,
          nextDate: "2026-11-20",
          nextDateAssumedToday: false,
          pastDue: false,
          paidSincePredicted: false,
        },
      ],
    },
    creditUtilization: {
      accounts: [{ accountId: "card", balanceCents: 25000, ratioBasisPoints: 2500 }],
    },
  });

  const goodSummaryBody = () =>
    JSON.parse(
      JSON.stringify({
        success: true,
        connections: [ok(1)],
        accounts: [
          {
            accountId: "chk",
            itemId: "item-1",
            institutionName: "Bank 1",
            name: "Checking",
            officialName: null,
            mask: "1234",
            type: "depository",
            subtype: "checking",
            currentCents: 100000,
            availableCents: 100000,
            limitCents: null,
            currency: "USD",
          },
        ],
        transactions: [
          {
            transactionId: "t1",
            accountId: "chk",
            amountCents: 1250,
            currency: "USD",
            date: "2026-11-01",
            pending: false,
            name: "Grocer",
            merchantName: null,
            logoUrl: null,
            category: ["Shops"],
            pfcPrimary: "FOOD_AND_DRINK",
            pfcDetailed: null,
          },
        ],
        summary: richSummary(),
      })
    );

  it("summary body: each listed field, missing or mistyped, is a failed read", () => {
    checksEveryField(SUMMARY_RESPONSE_FIELDS, goodSummaryBody(), parseFinanceSummaryResponse);
  });

  // The list is checked apart from the figures, field by field.
  it("transaction list: each listed field, missing or mistyped, fails the list", () => {
    checksEveryField(
      { transactions: SUMMARY_TRANSACTIONS_FIELDS },
      goodSummaryBody(),
      parseSummaryTransactions
    );
  });

  it("fields that are not listed are ignored", () => {
    const body = goodSummaryBody();
    body.extra = 1;
    body.accounts[0].extra = { nested: true };
    body.transactions[0].extra = { nested: true };
    body.summary.cashFlow.extra = "x";
    body.summary.recurring.items[0].extra = null;
    body.summary.dataIssues = "not read by any screen";
    expect(parseFinanceSummaryResponse(body)).not.toBeNull();
  });

  it("a summary of null is still a valid body (no bank read)", () => {
    expect(parseFinanceSummaryResponse({ ...goodSummaryBody(), summary: null })).not.toBeNull();
  });
});

/*
 * A period that may be incomplete carries one line, next to the figures over
 * it and over the transaction list.
 *
 * Mutations that turn this block red:
 *   - only "possibly_truncated" treated as incomplete      -> "unknown"
 *   - the line shown whatever the figures' state            -> "not ready"
 */
describe("incomplete period line", () => {
  const LINE = "May not include every transaction from this period.";
  // The engine decides completeness; the screens only follow it.
  const withPeriod = (completeness: "complete" | "possibly_truncated" | "unknown") => {
    const s = summary({ completeness });
    expect(s.cashFlow.period.completeness).toBe(completeness);
    return response([ok(1)], s);
  };
  const readyView = (resp: FinanceSummaryResponse) =>
    decideBankView({ hasActiveConnection: true, fetchState: "loaded", response: resp });

  it("ready figures over a cut-off or partly read period carry the line", () => {
    for (const c of ["possibly_truncated", "unknown"] as const) {
      const resp = withPeriod(c);
      expect(summaryPeriodNote(readyView(resp), resp), c).toBe(LINE);
    }
  });

  it("a complete period carries none", () => {
    const resp = withPeriod("complete");
    expect(summaryPeriodNote(readyView(resp), resp)).toBeNull();
  });

  it("no line when the figures are not ready", () => {
    const resp = withPeriod("possibly_truncated");
    for (const fetchState of ["loading", "failed"] as const) {
      const view = decideBankView({ hasActiveConnection: true, fetchState, response: resp });
      expect(summaryPeriodNote(view, resp), fetchState).toBeNull();
    }
    const none = decideBankView({ hasActiveConnection: false, fetchState: "idle", response: null });
    expect(summaryPeriodNote(none, null)).toBeNull();
  });

  it("the transaction list gets the same line from its own period", () => {
    expect(incompletePeriodNote("possibly_truncated")).toBe(LINE);
    expect(incompletePeriodNote("unknown")).toBe(LINE);
    expect(incompletePeriodNote("complete")).toBeNull();
    expect(incompletePeriodNote(null)).toBeNull();
  });
});

describe("describeBankAction", () => {
  it("says what each kind of problem asks of the user", () => {
    expect(describeBankAction({ kind: "relink", itemId: "i", institutionName: "Bank 2" })).toBe(
      "Bank 2 needs you to sign in again."
    );
    expect(describeBankAction({ kind: "wait", itemId: "i", institutionName: "Bank 3" })).toBe(
      "Bank 3 is still importing your transactions. Check back shortly."
    );
    expect(describeBankAction({ kind: "retry", itemId: "i", institutionName: "Bank 4" })).toBe(
      "We couldn't reach Bank 4 just now. Try again in a moment."
    );
  });
});
