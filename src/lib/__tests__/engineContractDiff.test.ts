import { describe, it, expect } from "vitest";
import { analyzeCashFlow, EngineInputError } from "@sungwon0162/cf-engine";
import { isEngineDate, isEngineInstant } from "../plaidEngineAdapter";
import { isCents } from "../financeEngine";

/**
 * The adapter's contract checks against the engine package itself: for every
 * value below, the adapter accepts it exactly when the engine does. The
 * engine is called with a minimal input carrying the value, and refusal is an
 * EngineInputError; any other error fails the test.
 *
 * Mutations that turn this file red:
 *   - the adapter's instant check loosened (seconds optional, a zone made
 *     optional, offset bounds removed) or tightened (fraction length capped,
 *     a 2000-01-01 lower bound on the instant itself)
 *   - the adapter's date check loosened (year range, month length, leap day)
 *   - the cents check made looser than a safe integer
 */

function minimalInput(over: {
  balanceAsOf?: unknown;
  lastDate?: unknown;
  currentCents?: unknown;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    now: "2026-11-11T12:00:00Z",
    today: "2026-11-11",
    dateBasis: "utc",
    currency: "USD",
    readWindow: { start: "2026-08-14", end: "2026-11-11" },
    period: { start: "2026-08-14", end: "2026-11-11" },
    accounts: [
      {
        accountId: "a",
        type: "depository",
        subtype: "checking",
        currentCents: "currentCents" in over ? over.currentCents : 100,
        availableCents: null,
        limitCents: null,
        currency: "USD",
        balanceAsOf: "balanceAsOf" in over ? over.balanceAsOf : null,
        duplicateKey: null,
        connectionKey: "c0",
      },
    ],
    connections: [
      {
        connectionKey: "c0",
        state: "ok",
        lastSuccessfulUpdate: null,
        recurringRead: "ok",
        transactionsTruncated: false,
        earliestTransactionDate: null,
      },
    ],
    transactions: [],
    recurring: {
      streams: [
        {
          streamId: "s",
          label: "x",
          frequency: "MONTHLY",
          averageAmountCents: 100,
          lastAmountCents: 100,
          currency: "USD",
          lastDate: "lastDate" in over ? over.lastDate : null,
          predictedNextDate: null,
          isActive: true,
          status: "MATURE",
          accountId: "a",
          pfcPrimary: null,
          pfcDetailed: null,
          transactionIds: [],
        },
      ],
      incomeStreams: [],
    },
  };
}

function engineAccepts(input: Record<string, unknown>): boolean {
  try {
    analyzeCashFlow(input as never, {});
    return true;
  } catch (error) {
    if (error instanceof EngineInputError) return false;
    throw error;
  }
}

const INSTANTS = [
  "2026-11-11T09:00:00Z",
  "2026-11-11T09:00:00.1Z",
  "2026-11-11T09:00:00.123456789123Z",
  "2026-11-11T09:00:00+05:30",
  "2026-11-11T09:00:00-23:59",
  "2026-11-11T09:00:00+24:00",
  "2026-11-11T09:00:00+05:60",
  "2026-11-11T09:00Z",
  "2026-11-11T09:00:00",
  "2026-11-11 09:00:00Z",
  "2026-11-11t09:00:00z",
  "2026-11-11T24:00:00Z",
  "2026-11-11T23:60:00Z",
  "2026-11-11T23:59:60Z",
  "2026-02-29T00:00:00Z",
  "2028-02-29T00:00:00Z",
  "2000-01-01T00:30:00+01:00",
  "1999-12-31T23:59:59Z",
  "9998-12-31T23:59:59Z",
  "9999-01-01T00:00:00Z",
  "2026-11-11T09:00:00.Z",
  " 2026-11-11T09:00:00Z",
  "",
];

const DATES = [
  "2026-11-11",
  "2000-01-01",
  "1999-12-31",
  "9998-12-31",
  "9999-01-01",
  "2026-02-29",
  "2028-02-29",
  "2100-02-29",
  "2000-02-29",
  "2026-13-01",
  "2026-00-10",
  "2026-11-31",
  "2026-1-01",
  "26-11-11",
  "2026-11-11T00:00:00Z",
  "",
];

const CENTS: unknown[] = [0, -0, 1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, Infinity];

describe("the adapter's checks match the engine's", () => {
  it("instants", () => {
    const mismatches = INSTANTS.filter(
      (v) => isEngineInstant(v) !== engineAccepts(minimalInput({ balanceAsOf: v }))
    );
    expect(mismatches).toEqual([]);
  });

  it("dates", () => {
    const mismatches = DATES.filter(
      (v) => isEngineDate(v) !== engineAccepts(minimalInput({ lastDate: v }))
    );
    expect(mismatches).toEqual([]);
  });

  it("cents", () => {
    const mismatches = CENTS.filter(
      (v) => isCents(v) !== engineAccepts(minimalInput({ currentCents: v }))
    );
    expect(mismatches).toEqual([]);
  });

  it("the table holds values on both sides of each check (it is not vacuous)", () => {
    expect(INSTANTS.some((v) => isEngineInstant(v))).toBe(true);
    expect(INSTANTS.some((v) => !isEngineInstant(v))).toBe(true);
    expect(DATES.some((v) => isEngineDate(v))).toBe(true);
    expect(DATES.some((v) => !isEngineDate(v))).toBe(true);
    expect(CENTS.some((v) => isCents(v))).toBe(true);
    expect(CENTS.some((v) => !isCents(v))).toBe(true);
  });
});
