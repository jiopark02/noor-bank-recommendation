import { describe, it, expect } from "vitest";
import { computeFinancialSummary } from "../financeEngine/index";
import { computeCoverage } from "../financeEngine/coverage";
import type {
  EngineConnection,
  EngineInput,
  EngineRecurringStream,
} from "../financeEngine/types";

/**
 * Finance engine — what the connections let the figures claim, and the
 * dates the caller must build consistently.
 *
 * Mutations that turn this file red:
 *   - a connection that was not read ignored              -> "a connection not read …"
 *   - the page-limit flag ignored                          -> "a connection cut off at the page limit …"
 *   - a failed recurring read treated like an empty one    -> "a failed recurring read on any connection …"
 *   - an empty answer from every bank read as "no charges" -> "empty answers from every bank …"
 *   - safeToSpendShowable without the all-read check       -> "safe-to-spend may be shown only …"
 *   - safeToSpendShowable without the computed check       -> "safe-to-spend may be shown only …"
 *   - a readWindow / period / today check removed          -> the caller-input case named for it
 */

function conn(over: Partial<EngineConnection> = {}): EngineConnection {
  return {
    connectionKey: "c0",
    state: "ok",
    lastSuccessfulUpdate: null,
    recurringRead: "ok",
    transactionsTruncated: false,
    earliestTransactionDate: null,
    ...over,
  };
}

function stream(id: string): EngineRecurringStream {
  return {
    streamId: id,
    label: id,
    frequency: "MONTHLY",
    averageAmountCents: 1000,
    lastAmountCents: 1000,
    currency: "USD",
    lastDate: "2026-09-20",
    predictedNextDate: "2026-10-20",
    isActive: true,
    status: "MATURE",
    accountId: "chk",
    pfcPrimary: null,
    pfcDetailed: null,
    legacyCategory: [],
    transactionIds: [],
  };
}

function input(connections: EngineConnection[], streams: EngineRecurringStream[]): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    today: "2026-10-10",
    dateBasis: "utc",
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
        fetchedAt: "2026-10-10T11:59:00Z",
        duplicateKey: null,
        connectionKey: "c0",
      },
    ],
    transactions: [],
    readWindow: { start: "2025-09-08", end: "2026-10-10" },
    period: { start: "2026-07-13", end: "2026-10-10" },
    connections,
    recurring: { streams, incomeStreams: [] },
  };
}

describe("coverage from the connections", () => {
  it("every connection read in full: complete, and recurring charges are known", () => {
    const s = computeFinancialSummary(input([conn(), conn({ connectionKey: "c1" })], [stream("a")]));
    expect(s.coverage).toEqual({
      completeness: "complete",
      allConnectionsRead: true,
      safeToSpendShowable: true,
    });
    expect(s.cashFlow.period.completeness).toBe("complete");
    expect(s.recurring.source).toBe("plaid_streams");
  });

  it("a connection not read makes the figures unknown and hides safe-to-spend", () => {
    for (const state of ["login_required", "syncing", "failed"] as const) {
      const s = computeFinancialSummary(
        input([conn(), conn({ connectionKey: "c1", state, recurringRead: null })], [stream("a")])
      );
      expect(s.coverage, state).toEqual({
        completeness: "unknown",
        allConnectionsRead: false,
        safeToSpendShowable: false,
      });
      expect(s.cashFlow.period.completeness, state).toBe("unknown");
      expect(s.recurring.source, state).toBe("unavailable");
      // The figure is still computed; whether to show it is a separate call.
      expect(s.safeToSpend.status, state).toBe("computed");
    }
  });

  it("a connection cut off at the page limit makes the period possibly truncated", () => {
    const s = computeFinancialSummary(
      input([conn(), conn({ connectionKey: "c1", transactionsTruncated: true })], [stream("a")])
    );
    expect(s.coverage.completeness).toBe("possibly_truncated");
    expect(s.cashFlow.period.completeness).toBe("possibly_truncated");
    expect(s.coverage.safeToSpendShowable).toBe(true);
  });

  it("a failed recurring read on any connection makes recurring charges unknown", () => {
    const s = computeFinancialSummary(
      input([conn(), conn({ connectionKey: "c1", recurringRead: "failed" })], [stream("a")])
    );
    expect(s.recurring.source).toBe("unavailable");
    expect(s.recurring.totalMonthlyCents).toBeNull();
    expect(s.safeToSpend.assumptions).toContain("recurring_unavailable");
    // A recurring failure is not a connection failure.
    expect(s.coverage.completeness).toBe("complete");
    expect(s.coverage.safeToSpendShowable).toBe(true);
  });

  it("an empty answer next to streams from another bank still counts those streams", () => {
    const s = computeFinancialSummary(
      input([conn(), conn({ connectionKey: "c1", recurringRead: "empty" })], [stream("a")])
    );
    expect(s.recurring.source).toBe("plaid_streams");
    expect(s.recurring.totalMonthlyCents).toBe(1000);
  });

  it("empty answers from every bank are unknown, not zero", () => {
    const s = computeFinancialSummary(
      input([conn({ recurringRead: "empty" }), conn({ connectionKey: "c1", recurringRead: "empty" })], [])
    );
    expect(s.recurring.source).toBe("unavailable");
    expect(s.recurring.totalMonthlyCents).toBeNull();
  });

  it("safe-to-spend may be shown only when every connection was read and it was computed", () => {
    const none = input([], [stream("a")]);
    expect(computeFinancialSummary(none).coverage).toEqual({
      completeness: "unknown",
      allConnectionsRead: false,
      safeToSpendShowable: false,
    });

    const noCash = input([conn()], [stream("a")]);
    noCash.accounts = [];
    const s = computeFinancialSummary(noCash);
    expect(s.safeToSpend.status).toBe("unavailable");
    expect(s.coverage.allConnectionsRead).toBe(true);
    expect(s.coverage.safeToSpendShowable).toBe(false);
  });

  it("a malformed connection entry counts as not read", () => {
    const bad = [null as unknown as EngineConnection, conn()];
    expect(computeCoverage(bad, 1)).toEqual({
      completeness: "unknown",
      allConnectionsRead: false,
      recurringAvailable: false,
    });
  });
});

describe("caller input: dates and lists built by the caller", () => {
  const run = (edit: (i: EngineInput) => void) => () => {
    const i = input([conn()], [stream("a")]);
    edit(i);
    return computeFinancialSummary(i);
  };

  it("accepts a period inside a longer read window ending on today", () => {
    expect(run(() => {})).not.toThrow();
    expect(run((i) => (i.period = { ...i.readWindow }))).not.toThrow();
  });

  it("refuses a read window that is not a valid range", () => {
    expect(run((i) => (i.readWindow = { start: "2026-10-11", end: "2026-10-10" }))).toThrow(
      /invalid readWindow/
    );
    expect(run((i) => (i.readWindow = { start: "2026-02-30", end: "2026-10-10" }))).toThrow(
      /invalid readWindow/
    );
    expect(
      run((i) => (i.readWindow = undefined as unknown as EngineInput["readWindow"]))
    ).toThrow(/invalid readWindow/);
  });

  it("refuses a read window that does not end on today", () => {
    expect(run((i) => (i.readWindow = { start: "2025-09-08", end: "2026-10-09" }))).toThrow(
      /must end on today/
    );
    expect(run((i) => (i.today = "2026-10-09"))).toThrow(/must end on today/);
  });

  it("refuses a valid period outside the read window", () => {
    expect(run((i) => (i.period = { start: "2025-09-07", end: "2026-10-10" }))).toThrow(
      /must lie inside readWindow/
    );
    expect(run((i) => (i.period = { start: "2026-07-13", end: "2026-10-11" }))).toThrow(
      /must lie inside readWindow/
    );
  });

  // An invalid period is data, reported in dataIssues as before.
  it("keeps reporting a period that is not a valid range, without throwing", () => {
    const s = run((i) => (i.period = { start: "2026-10-10", end: "2026-07-13" }))();
    expect(s.dataIssues).toContainEqual({ kind: "period", id: "period", reason: "invalid_period" });
  });

  it("refuses an unknown date basis and a connection list that is not a list", () => {
    expect(run((i) => (i.dateBasis = "local" as unknown as EngineInput["dateBasis"]))).toThrow(
      /invalid dateBasis/
    );
    expect(
      run((i) => (i.connections = null as unknown as EngineConnection[]))
    ).toThrow(/invalid connections/);
  });
});
