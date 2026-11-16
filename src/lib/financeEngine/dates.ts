import type { EngineAccount, Freshness, IsoDate } from "./types";

// Calendar dates and zoned timestamps, checked without the platform's date
// parser. Date arithmetic is on calendar days, carried as day numbers on the
// UTC axis.

const MS_PER_DAY = 86400000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Dates before this year are rejected. Date.UTC reads years 0-99 as
// 1900-1999, and nothing the engine is given legitimately predates it.
const MIN_YEAR = 2000;
const MIN_TIMESTAMP_MS = Date.UTC(MIN_YEAR, 0, 1);
// Dates after this year are rejected too. A four-digit year must survive one
// annual cadence step and still format as four digits.
const MAX_YEAR = 9998;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

function pad(n: number, width: number): string {
  let s = String(n);
  while (s.length < width) s = "0" + s;
  return s;
}

function formatYmd(year: number, month: number, day: number): IsoDate {
  return pad(year, 4) + "-" + pad(month, 2) + "-" + pad(day, 2);
}

function parseYmd(
  d: string
): { year: number; month: number; day: number } | null {
  const m = DATE_PATTERN.exec(d);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isIsoDate(s: string): boolean {
  return typeof s === "string" && parseYmd(s) !== null;
}

/** Days since 1970-01-01 (UTC), or null for anything that is not a real date. */
export function dayNumber(d: IsoDate): number | null {
  const p = typeof d === "string" ? parseYmd(d) : null;
  if (!p) return null;
  return Date.UTC(p.year, p.month - 1, p.day) / MS_PER_DAY;
}

export function fromDayNumber(n: number): IsoDate {
  const date = new Date(n * MS_PER_DAY);
  return formatYmd(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  );
}

// A date-time with an explicit zone: "Z" or a ±hh:mm offset. The zone is
// mandatory. A zone-less date-time is read by the platform parser as host
// local time, which would make the result depend on where the code runs, so
// such strings are rejected here and the platform parser is never used.
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

/** Milliseconds since the epoch for a zoned ISO 8601 date-time, else null. */
export function parseTimestampMs(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = TIMESTAMP_PATTERN.exec(t);
  if (!m) return null;
  const date = parseYmd(m[1]);
  if (!date) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  const seconds = m[4] ? Number(m[4]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const millis = m[5] ? Math.floor(Number("0." + m[5]) * 1000) : 0;

  let offsetMinutes = 0;
  if (m[6] !== "Z") {
    const sign = m[6].charAt(0) === "-" ? -1 : 1;
    const offsetHours = Number(m[6].slice(1, 3));
    const offsetMins = Number(m[6].slice(4, 6));
    if (offsetHours > 23 || offsetMins > 59) return null;
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  const ms =
    Date.UTC(date.year, date.month - 1, date.day, hours, minutes, seconds) +
    millis -
    offsetMinutes * 60000;
  // An offset can move a valid local date to a UTC instant before the bound.
  return ms < MIN_TIMESTAMP_MS ? null : ms;
}

/**
 * How fresh an account's balance is. `asOf` is only ever the institution's own
 * timestamp; the time our server received the balance stays in `fetchedAt` and
 * is never promoted to `asOf`. Either one that is not a zoned date-time is
 * treated as null (and reported as a data issue by the entry point).
 */
export function freshnessOf(a: EngineAccount): Freshness {
  const asOf = parseTimestampMs(a.balanceAsOf) !== null ? a.balanceAsOf : null;
  const fetchedAt = parseTimestampMs(a.fetchedAt) !== null ? a.fetchedAt : null;
  return {
    asOf,
    fetchedAt,
    asOfSource: asOf === null ? "unknown" : "institution",
  };
}
