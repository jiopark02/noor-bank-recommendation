import { describe, it, expect } from "vitest";
import {
  toCents,
  isCents,
  sumCents,
  monthlyCentsFromCadence,
} from "../financeEngine/money";
import {
  addCadence,
  dayNumber,
  endOfMonthUtc,
  fromDayNumber,
  isIsoDate,
  parseTimestampMs,
  utcDateOf,
} from "../financeEngine/dates";

/**
 * Finance engine — money and date primitives.
 *
 * Mutations that turn this file red:
 *   - BIWEEKLY ratio 26/12 changed to 52/12      -> "BIWEEKLY uses 26/12"
 *   - leap-year branch removed from daysInMonth  -> "February in a leap year"
 *   - month-end clamp removed from addMonths     -> "Jan 31 + 1 month"
 *   - zone made optional in TIMESTAMP_PATTERN    -> "zone-less timestamps are invalid"
 */

describe("toCents / isCents / sumCents", () => {
  it("rounds float dollars to integer cents", () => {
    expect(toCents(15.49)).toBe(1549);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-15.49)).toBe(-1549);
    expect(toCents(-0.005)).toBe(-1);
  });

  it("lets NaN and Infinity through so isCents can reject them", () => {
    expect(isCents(toCents(NaN))).toBe(false);
    expect(isCents(toCents(Infinity))).toBe(false);
  });

  it("accepts only finite integers", () => {
    expect(isCents(1549)).toBe(true);
    expect(isCents(-1)).toBe(true);
    expect(isCents(1.5)).toBe(false);
    expect(isCents("100")).toBe(false);
    expect(isCents(null)).toBe(false);
  });

  it("sums", () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([1, 2, -3])).toBe(0);
  });
});

describe("monthlyCentsFromCadence", () => {
  it("BIWEEKLY uses 26/12", () => {
    expect(monthlyCentsFromCadence(1549, "BIWEEKLY")).toBe(3356);
  });
  it("WEEKLY uses 52/12", () => {
    expect(monthlyCentsFromCadence(1000, "WEEKLY")).toBe(4333);
  });
  it("SEMI_MONTHLY doubles", () => {
    expect(monthlyCentsFromCadence(1000, "SEMI_MONTHLY")).toBe(2000);
  });
  it("MONTHLY is unchanged", () => {
    expect(monthlyCentsFromCadence(1549, "MONTHLY")).toBe(1549);
  });
  it("ANNUALLY divides by 12", () => {
    expect(monthlyCentsFromCadence(60000, "ANNUALLY")).toBe(5000);
  });
  it("UNKNOWN has no ratio", () => {
    expect(monthlyCentsFromCadence(1000, "UNKNOWN")).toBeNull();
  });
});

describe("dates", () => {
  it("February in a common year", () => {
    expect(endOfMonthUtc("2026-02-10")).toBe("2026-02-28");
  });
  it("February in a leap year", () => {
    expect(endOfMonthUtc("2028-02-10")).toBe("2028-02-29");
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
  });
  it("Jan 31 + 1 month clamps to the end of February", () => {
    expect(addCadence("2026-01-31", "MONTHLY")).toBe("2026-02-28");
    expect(addCadence("2026-01-31", "MONTHLY", 2)).toBe("2026-03-31");
  });
  it("day-based cadences", () => {
    expect(addCadence("2026-10-12", "WEEKLY", 2)).toBe("2026-10-26");
    expect(addCadence("2026-10-12", "BIWEEKLY")).toBe("2026-10-26");
    expect(addCadence("2026-12-25", "ANNUALLY")).toBe("2027-12-25");
    expect(addCadence("2026-10-12", "UNKNOWN")).toBeNull();
    expect(addCadence("not-a-date", "WEEKLY")).toBeNull();
  });
  it("rejects malformed dates", () => {
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-01")).toBe(false);
    expect(dayNumber("2026-00-10")).toBeNull();
  });
  it("round-trips day numbers", () => {
    const n = dayNumber("2026-10-10") as number;
    expect(fromDayNumber(n)).toBe("2026-10-10");
    expect(fromDayNumber(n + 22)).toBe("2026-11-01");
  });
  it("takes the UTC date of a date-time", () => {
    expect(utcDateOf("2026-10-10T23:30:00-05:00")).toBe("2026-10-11");
    expect(utcDateOf("2026-10-10T23:30:00Z")).toBe("2026-10-10");
    expect(utcDateOf("garbage")).toBeNull();
  });

  it("zone-less timestamps are invalid", () => {
    // These would be read as host local time by the platform parser.
    expect(utcDateOf("2026-10-10T23:30:00")).toBeNull();
    expect(utcDateOf("2026-10-10")).toBeNull();
    expect(parseTimestampMs("2026-10-10T23:30:00")).toBeNull();
    expect(parseTimestampMs("2026-10-10T23:30:00+0900")).toBeNull();
  });

  it("parses zoned timestamps without the platform parser", () => {
    expect(parseTimestampMs("1970-01-01T00:00:00Z")).toBe(0);
    expect(parseTimestampMs("1970-01-01T09:00:00+09:00")).toBe(0);
    expect(parseTimestampMs("1970-01-01T00:00:00.250Z")).toBe(250);
    expect(parseTimestampMs("1970-01-01T00:00Z")).toBe(0);
    expect(parseTimestampMs("2026-10-10T24:00:00Z")).toBeNull();
    expect(parseTimestampMs("2026-02-30T00:00:00Z")).toBeNull();
    expect(parseTimestampMs(null)).toBeNull();
  });
});
