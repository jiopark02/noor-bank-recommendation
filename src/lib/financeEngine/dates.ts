import type {
  EngineAccount,
  Freshness,
  IsoDate,
  IsoDateTime,
  RecurringFrequency,
} from "./types";

// All date arithmetic is on UTC calendar days. The engine has no user time
// zone, and says so through the "dates_utc" assumption code.

const MS_PER_DAY = 86400000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Dates before this year are rejected. Date.UTC reads years 0-99 as
// 1900-1999, and nothing the engine is given legitimately predates it.
const MIN_YEAR = 2000;
const MIN_TIMESTAMP_MS = Date.UTC(MIN_YEAR, 0, 1);
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
  if (year < MIN_YEAR) return null;
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

/** The UTC calendar date of a zoned date-time, or null when it is not one. */
export function utcDateOf(t: IsoDateTime): IsoDate | null {
  const ms = parseTimestampMs(t);
  if (ms === null) return null;
  return fromDayNumber(Math.floor(ms / MS_PER_DAY));
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

/** Last day of the month containing `d`. Throws on an invalid date (caller bug). */
export function endOfMonthUtc(d: IsoDate): IsoDate {
  const p = parseYmd(d);
  if (!p) throw new Error("endOfMonthUtc: invalid date");
  return formatYmd(p.year, p.month, daysInMonth(p.year, p.month));
}

function addMonthsClamped(d: IsoDate, months: number): IsoDate | null {
  const p = parseYmd(d);
  if (!p) return null;
  const zeroBased = p.month - 1 + months;
  const year = p.year + Math.floor(zeroBased / 12);
  const month = (((zeroBased % 12) + 12) % 12) + 1;
  // Clamp to month end so Jan 31 + 1 month is Feb 28/29, not Mar 3.
  const day = Math.min(p.day, daysInMonth(year, month));
  return formatYmd(year, month, day);
}

/**
 * `d` advanced by `steps` cadence intervals. Month-based cadences are computed
 * from `d` in one jump rather than by repeated single steps, so a 31st anchor
 * does not drift to the 28th after February. SEMI_MONTHLY is approximated as
 * 15 days. UNKNOWN has no interval and returns null.
 */
export function addCadence(
  d: IsoDate,
  frequency: RecurringFrequency,
  steps: number = 1
): IsoDate | null {
  const start = dayNumber(d);
  if (start === null) return null;
  switch (frequency) {
    case "WEEKLY":
      return fromDayNumber(start + 7 * steps);
    case "BIWEEKLY":
      return fromDayNumber(start + 14 * steps);
    case "SEMI_MONTHLY":
      return fromDayNumber(start + 15 * steps);
    case "MONTHLY":
      return addMonthsClamped(d, steps);
    case "ANNUALLY":
      return addMonthsClamped(d, 12 * steps);
    default:
      return null;
  }
}

/**
 * The smallest `k >= 0` for which `addCadence(d, frequency, k)` falls on or
 * after `targetDay` (a UTC day number), computed directly instead of by
 * stepping from `d`, so a stale anchor costs nothing. null for an invalid date
 * or an UNKNOWN cadence.
 */
export function firstCadenceStepOnOrAfter(
  d: IsoDate,
  frequency: RecurringFrequency,
  targetDay: number
): number | null {
  const start = dayNumber(d);
  if (start === null) return null;
  switch (frequency) {
    case "WEEKLY":
      return Math.max(0, Math.ceil((targetDay - start) / 7));
    case "BIWEEKLY":
      return Math.max(0, Math.ceil((targetDay - start) / 14));
    case "SEMI_MONTHLY":
      return Math.max(0, Math.ceil((targetDay - start) / 15));
    case "MONTHLY":
    case "ANNUALLY": {
      if (start >= targetDay) return 0;
      const from = parseYmd(d) as { year: number; month: number };
      const target = parseYmd(fromDayNumber(targetDay)) as { year: number; month: number };
      const months = (target.year - from.year) * 12 + (target.month - from.month);
      const perStep = frequency === "MONTHLY" ? 1 : 12;
      // One step short of the target's month lands before targetDay, so at
      // most two forward steps remain.
      let k = Math.max(0, Math.floor(months / perStep) - 1);
      for (;;) {
        const day = dayNumber(addCadence(d, frequency, k) as IsoDate);
        if (day === null) return null;
        if (day >= targetDay) return k;
        k++;
      }
    }
    default:
      return null;
  }
}
