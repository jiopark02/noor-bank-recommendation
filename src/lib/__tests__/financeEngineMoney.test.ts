import { describe, it, expect } from "vitest";
import { toCents, isCents } from "../financeEngine/money";
import { dayNumber, fromDayNumber, isIsoDate, parseTimestampMs } from "../financeEngine/dates";

/**
 * Finance engine — money and date primitives.
 *
 * Mutations that turn this file red:
 *   - leap-year branch removed from daysInMonth  -> "February in a leap year"
 *   - zone made optional in TIMESTAMP_PATTERN    -> "zone-less timestamps are invalid"
 *   - year bound removed from parseYmd           -> "years before 2000 are not dates"
 *   - instant bound removed from parseTimestampMs -> "years before 2000 are not dates"
 *   - upper year bound removed from parseYmd     -> "years after 9998 are not dates"
 *   - isCents back to a finite-integer check     -> "rejects integers beyond the safe range"
 */

describe("toCents / isCents", () => {
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

  // Above 2^53 neighbouring integers collapse, so such a value is not an amount.
  it("rejects integers beyond the safe range", () => {
    expect(isCents(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isCents(-Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isCents(2 ** 53)).toBe(false);
    expect(isCents(-(2 ** 53))).toBe(false);
    expect(isCents(1e21)).toBe(false);
  });
});

describe("dates", () => {
  it("February in a leap year", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
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
  it("zone-less timestamps are invalid", () => {
    // These would be read as host local time by the platform parser.
    expect(parseTimestampMs("2026-10-10T23:30:00")).toBeNull();
    expect(parseTimestampMs("2026-10-10T23:30:00+0900")).toBeNull();
  });

  it("parses zoned timestamps without the platform parser", () => {
    expect(parseTimestampMs("2000-01-01T00:00:00Z")).toBe(946684800000);
    expect(parseTimestampMs("2000-01-01T09:00:00+09:00")).toBe(946684800000);
    expect(parseTimestampMs("2000-01-01T00:00:00.250Z")).toBe(946684800250);
    expect(parseTimestampMs("2000-01-01T00:00Z")).toBe(946684800000);
    expect(parseTimestampMs("2026-10-10T24:00:00Z")).toBeNull();
    expect(parseTimestampMs("2026-02-30T00:00:00Z")).toBeNull();
    expect(parseTimestampMs(null)).toBeNull();
  });

  // Date.UTC reads years 0-99 as 1900-1999, so without a lower bound a year
  // like 0050 would silently become 1950.
  it("years before 2000 are not dates", () => {
    expect(isIsoDate("0050-01-01")).toBe(false);
    expect(isIsoDate("1999-12-31")).toBe(false);
    expect(isIsoDate("2000-01-01")).toBe(true);
    expect(dayNumber("0099-12-31")).toBeNull();
    expect(parseTimestampMs("0050-01-01T00:00:00Z")).toBeNull();
    // Valid calendar date, but the instant falls on 1999-12-31 in UTC.
    expect(parseTimestampMs("2000-01-01T00:30:00+01:00")).toBeNull();
    expect(parseTimestampMs("2000-01-01T00:00:00Z")).toBe(946684800000);
  });

  it("years after 9998 are not dates", () => {
    expect(isIsoDate("9998-12-31")).toBe(true);
    expect(isIsoDate("9999-01-01")).toBe(false);
    expect(dayNumber("9999-12-31")).toBeNull();
    expect(parseTimestampMs("9998-12-31T23:59:59Z")).not.toBeNull();
    expect(parseTimestampMs("9999-01-01T00:00:00Z")).toBeNull();
  });
});
