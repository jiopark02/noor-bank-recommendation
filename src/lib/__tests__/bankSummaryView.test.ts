import { describe, it, expect } from "vitest";
import {
  decideBankView,
  formatCents,
  formatCentsOrDash,
  formatMonthlyOrUnknown,
} from "../bankSummaryView";
import { computeFinancialSummary } from "../financeEngine";
import type { EngineInput, FinancialSummary } from "../financeEngine";
import type {
  BankConnectionStatus,
  FinanceSummaryResponse,
} from "../plaidEngineAdapter";

/**
 * What the money screens may show, decided from a summary response.
 *
 * Mutations that turn this file red:
 *   - safe-to-spend shown whenever a summary exists               -> incomplete banks
 *   - the re-link target taken from the first connection          -> action per bank
 *   - an earlier response drawn after a failed load               -> failed load
 *   - an unknown recurring total formatted as 0 (`?? 0`)          -> formatting
 *   - data issues treated as a connection problem (an action, or
 *     safe-to-spend hidden because dataIssues is non-empty)       -> data issues
 */

function summary(over: Partial<EngineInput> = {}): FinancialSummary {
  return computeFinancialSummary({
    now: "2026-11-11T12:00:00Z",
    currency: "USD",
    accounts: [
      {
        accountId: "chk",
        type: "depository",
        subtype: "checking",
        currentCents: 100000,
        availableCents: 100000,
        limitCents: null,
        currency: "USD",
        balanceAsOf: null,
        fetchedAt: "2026-11-11T11:59:00Z",
      },
    ],
    transactions: [],
    period: { start: "2026-08-14", end: "2026-11-11", completeness: "complete" },
    recurring: { source: "unavailable" },
    ...over,
  });
}

const ok = (n: number): BankConnectionStatus => ({
  itemId: `item-${n}`,
  institutionName: `Bank ${n}`,
  status: "ok",
});

function response(
  connections: BankConnectionStatus[],
  s: FinancialSummary | null = summary()
): FinanceSummaryResponse {
  return { success: true, connections, accounts: [], summary: s };
}

describe("decideBankView — figures", () => {
  it("draws nothing while loading", () => {
    expect(
      decideBankView({ hasActiveConnection: true, fetchState: "loading", response: null })
    ).toEqual({ figures: "loading", showSafeToSpend: false, actions: [] });
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
    ).toEqual({ figures: "ready", showSafeToSpend: true, actions: [] });
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

  it("safe-to-spend the engine could not compute is not shown", () => {
    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([ok(1)], summary({ accounts: [] })),
    });
    expect(view.showSafeToSpend).toBe(false);
  });
});

describe("decideBankView — data issues are information, not a task", () => {
  it("catch-all transactions neither hide safe-to-spend nor create an action", () => {
    const s = summary({
      transactions: [
        {
          transactionId: "o1",
          accountId: "chk",
          amountCents: 1200,
          currency: "USD",
          date: "2026-11-01",
          pending: false,
          pfcPrimary: "OTHER",
          pfcDetailed: "OTHER_OTHER",
          legacyCategory: [],
        },
      ],
    });
    expect(s.dataIssues.some((d) => d.reason === "unclassified_category")).toBe(true);

    const view = decideBankView({
      hasActiveConnection: true,
      fetchState: "loaded",
      response: response([ok(1)], s),
    });
    expect(view.showSafeToSpend).toBe(true);
    expect(view.actions).toEqual([]);
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

  it("a missing balance is a dash, never $0.00", () => {
    expect(formatCentsOrDash(null)).toBe("—");
    expect(formatCentsOrDash(0)).toBe("$0.00");
  });
});
