import type {
  EngineInput,
  EngineRecurringStream,
  IsoDate,
  RecurringResult,
} from "./types";
import { isCents, monthlyCentsFromCadence } from "./money";
import {
  addCadence,
  dayNumber,
  firstCadenceStepOnOrAfter,
  isIsoDate,
} from "./dates";

/**
 * The one stream dedupe every metric uses: the first stream with a given id
 * wins, later copies are dropped. Streams without a usable id are dropped too.
 * The entry point reports both through its own pass, which applies the same
 * rule.
 */
export function uniqueStreams(
  streams: EngineRecurringStream[]
): EngineRecurringStream[] {
  // A Set, not a plain object: an id such as "constructor" would otherwise
  // read as already seen through Object.prototype.
  const seen = new Set<string>();
  const unique: EngineRecurringStream[] = [];
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    if (!s || typeof s.streamId !== "string" || s.streamId === "") continue;
    if (seen.has(s.streamId)) continue;
    seen.add(s.streamId);
    unique.push(s);
  }
  return unique;
}

/** The per-occurrence amount and which field it came from, or null if none is usable. */
export function streamBasis(
  s: EngineRecurringStream
): { basis: "average" | "last"; cents: number } | null {
  if (isCents(s.averageAmountCents) && s.averageAmountCents > 0) {
    return { basis: "average", cents: s.averageAmountCents };
  }
  if (isCents(s.lastAmountCents) && s.lastAmountCents > 0) {
    return { basis: "last", cents: s.lastAmountCents };
  }
  return null;
}

/** Plaid's predicted next date, else the last date plus one interval, else null. */
export function nextDateOf(s: EngineRecurringStream): IsoDate | null {
  if (typeof s.predictedNextDate === "string" && isIsoDate(s.predictedNextDate)) {
    return s.predictedNextDate;
  }
  if (typeof s.lastDate === "string" && isIsoDate(s.lastDate)) {
    return addCadence(s.lastDate, s.frequency);
  }
  return null;
}

/**
 * Dates on which the stream is expected to charge, from `fromDay` through
 * `toDay` inclusive (UTC day numbers). Starts at the first occurrence on or
 * after `fromDay`, computed from the next expected date however far back it
 * lies, and steps forward; every step advances at least seven days, so the
 * loop ends at `toDay`. An UNKNOWN cadence or a stream with no date yields
 * nothing.
 */
export function upcomingOccurrences(
  s: EngineRecurringStream,
  fromDay: number,
  toDay: number
): IsoDate[] {
  const out: IsoDate[] = [];
  if (s.frequency === "UNKNOWN") return out;
  const anchor = nextDateOf(s);
  if (anchor === null) return out;
  const first = firstCadenceStepOnOrAfter(anchor, s.frequency, fromDay);
  if (first === null) return out;

  for (let k = first; ; k++) {
    const occurrence = addCadence(anchor, s.frequency, k);
    if (occurrence === null) break;
    const day = dayNumber(occurrence);
    if (day === null || day > toDay) break;
    out.push(occurrence);
  }
  return out;
}

/**
 * Recurring charges normalized to a monthly amount. Source is Plaid's outflow
 * streams only; when they are unavailable nothing is inferred from
 * transactions, and the total is null rather than 0.
 */
export function computeRecurring(input: EngineInput): RecurringResult {
  if (input.recurring.source !== "plaid_streams") {
    return {
      source: "unavailable",
      items: [],
      totalMonthlyCents: null,
      excluded: [],
    };
  }

  const result: RecurringResult = {
    source: "plaid_streams",
    items: [],
    totalMonthlyCents: 0,
    excluded: [],
  };

  const streams = uniqueStreams(input.recurring.streams);
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    if (!s.isActive) {
      result.excluded.push({ streamId: s.streamId, reason: "inactive" });
      continue;
    }
    if (s.status === "TOMBSTONED") {
      result.excluded.push({ streamId: s.streamId, reason: "tombstoned" });
      continue;
    }
    if (s.currency !== input.currency) {
      result.excluded.push({ streamId: s.streamId, reason: "other_currency" });
      continue;
    }
    if (s.frequency === "UNKNOWN") {
      result.excluded.push({ streamId: s.streamId, reason: "unknown_frequency" });
      continue;
    }
    const basis = streamBasis(s);
    if (basis === null) {
      result.excluded.push({ streamId: s.streamId, reason: "no_amount" });
      continue;
    }
    const monthly = monthlyCentsFromCadence(basis.cents, s.frequency) as number;
    result.items.push({
      streamId: s.streamId,
      label: s.label,
      frequency: s.frequency,
      status: s.status,
      basis: basis.basis,
      basisCents: basis.cents,
      monthlyCents: monthly,
      nextDate: nextDateOf(s),
    });
    result.totalMonthlyCents = (result.totalMonthlyCents as number) + monthly;
  }

  return result;
}
