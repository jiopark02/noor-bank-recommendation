import { describe, it, expect } from "vitest";
import {
  computeRecurring,
  upcomingOccurrences,
} from "../financeEngine/recurring";
import { dayNumber } from "../financeEngine/dates";
import type {
  EngineInput,
  EngineRecurringStream,
} from "../financeEngine/types";

/**
 * Finance engine — recurring charges normalized to a monthly amount.
 *
 * Mutations that turn this file red:
 *   - TOMBSTONED / inactive filters removed     -> "excludes with a reason per stream"
 *   - upcomingOccurrences stops after one date  -> "a weekly stream recurs inside the horizon"
 *   - SEMI_MONTHLY spacing 15 -> 17 days         -> "SEMI_MONTHLY 1st/15th … 2 dates"
 *   - SEMI_MONTHLY spacing 15 -> 13 days         -> "SEMI_MONTHLY 15th/month-end … 1 date"
 */

function stream(over: Partial<EngineRecurringStream>): EngineRecurringStream {
  return {
    streamId: "s",
    label: "Stream",
    frequency: "MONTHLY",
    averageAmountCents: 1000,
    lastAmountCents: 1000,
    currency: "USD",
    lastDate: "2026-09-20",
    predictedNextDate: "2026-10-20",
    isActive: true,
    status: "MATURE",
    ...over,
  };
}

function input(streams: EngineRecurringStream[] | null): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    currency: "USD",
    accounts: [],
    transactions: [],
    period: { start: "2026-09-11", end: "2026-10-10", completeness: "complete" },
    recurring: streams === null ? { source: "unavailable" } : { source: "plaid_streams", streams },
  };
}

const netflix = stream({ streamId: "netflix", label: "Netflix", averageAmountCents: 1549, lastAmountCents: 1549 });
const insurance = stream({
  streamId: "ins",
  label: "Insurance",
  frequency: "ANNUALLY",
  averageAmountCents: 60000,
  lastAmountCents: 60000,
  lastDate: "2026-03-01",
  predictedNextDate: "2027-03-01",
});

describe("computeRecurring", () => {
  it("sums monthly equivalents (§6)", () => {
    const r = computeRecurring(input([netflix, insurance]));
    expect(r.source).toBe("plaid_streams");
    expect(r.totalMonthlyCents).toBe(6549);
    expect(r.items.map((i) => [i.streamId, i.monthlyCents, i.basis, i.nextDate])).toEqual([
      ["netflix", 1549, "average", "2026-10-20"],
      ["ins", 5000, "average", "2027-03-01"],
    ]);
  });

  it("falls back to the last amount when the average is missing", () => {
    const r = computeRecurring(input([stream({ averageAmountCents: null, lastAmountCents: 700 })]));
    expect(r.items[0].basis).toBe("last");
    expect(r.items[0].basisCents).toBe(700);
  });

  it("excludes with a reason per stream", () => {
    const r = computeRecurring(
      input([
        netflix,
        stream({ streamId: "dead", status: "TOMBSTONED", averageAmountCents: 99999 }),
        stream({ streamId: "off", isActive: false, averageAmountCents: 99999 }),
        stream({ streamId: "unk", frequency: "UNKNOWN" }),
        stream({ streamId: "zero", averageAmountCents: 0, lastAmountCents: null }),
        stream({ streamId: "cad", currency: "CAD" }),
      ])
    );
    expect(r.totalMonthlyCents).toBe(1549);
    expect(r.excluded).toEqual([
      { streamId: "dead", reason: "tombstoned" },
      { streamId: "off", reason: "inactive" },
      { streamId: "unk", reason: "unknown_frequency" },
      { streamId: "zero", reason: "no_amount" },
      { streamId: "cad", reason: "other_currency" },
    ]);
  });

  it("keeps an early-detection stream and says so", () => {
    const r = computeRecurring(input([stream({ status: "EARLY_DETECTION" })]));
    expect(r.items[0].status).toBe("EARLY_DETECTION");
  });

  it("unavailable data gives a null total, not zero", () => {
    expect(computeRecurring(input(null))).toEqual({
      source: "unavailable",
      items: [],
      totalMonthlyCents: null,
      excluded: [],
    });
  });

  it("an empty stream list is a real zero", () => {
    expect(computeRecurring(input([])).totalMonthlyCents).toBe(0);
  });
});

describe("upcomingOccurrences", () => {
  const from = dayNumber("2026-10-10") as number;
  const to = dayNumber("2026-10-31") as number;

  it("a weekly stream recurs inside the horizon", () => {
    expect(
      upcomingOccurrences(stream({ frequency: "WEEKLY", predictedNextDate: "2026-10-12" }), from, to)
    ).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("derives the next date from the last date when none is predicted", () => {
    expect(
      upcomingOccurrences(stream({ predictedNextDate: null, lastDate: "2026-09-25" }), from, to)
    ).toEqual(["2026-10-25"]);
  });

  it("no date at all, or an unknown cadence, yields nothing", () => {
    expect(upcomingOccurrences(stream({ predictedNextDate: null, lastDate: null }), from, to)).toEqual([]);
    expect(upcomingOccurrences(stream({ frequency: "UNKNOWN" }), from, to)).toEqual([]);
  });

  it("a date beyond the horizon yields nothing", () => {
    expect(upcomingOccurrences(insurance, from, to)).toEqual([]);
  });

  // SEMI_MONTHLY is spaced 15 days apart, not on the stream's real calendar
  // days. These two cases pin today's counts, which differ from the real ones;
  // safe-to-spend states the approximation with an assumption code.
  it("SEMI_MONTHLY 1st/15th stream before the 15th: 2 dates (real: 1)", () => {
    expect(
      upcomingOccurrences(stream({ frequency: "SEMI_MONTHLY", predictedNextDate: "2026-10-15" }), from, to)
    ).toEqual(["2026-10-15", "2026-10-30"]);
  });

  it("SEMI_MONTHLY 15th/month-end stream in February: 1 date (real: 2)", () => {
    const febFrom = dayNumber("2027-02-10") as number;
    const febTo = dayNumber("2027-02-28") as number;
    expect(
      upcomingOccurrences(stream({ frequency: "SEMI_MONTHLY", predictedNextDate: "2027-02-15" }), febFrom, febTo)
    ).toEqual(["2027-02-15"]);
  });

  it("a stale anchor is bounded and still finds dates in range", () => {
    const out = upcomingOccurrences(stream({ frequency: "WEEKLY", predictedNextDate: "2026-01-05" }), from, to);
    expect(out).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
  });
});
