import type {
  AssumptionCode,
  EngineInput,
  EnginePolicy,
  EngineRecurringStream,
  RecurringResult,
  SafeToSpendResult,
} from "./types";
import { isCents } from "./money";
import {
  dayNumber,
  endOfMonthUtc,
  freshnessOf,
  parseTimestampMs,
  utcDateOf,
} from "./dates";
import { nextDateOf, upcomingOccurrences } from "./recurring";
import { uniqueAccounts } from "./cashFlow";

/** The earlier of two zoned timestamps; both have already been validated. */
function olderOf(a: string | null, b: string): string {
  if (a === null) return b;
  return (parseTimestampMs(b) as number) < (parseTimestampMs(a) as number)
    ? b
    : a;
}

/**
 * Safe-to-spend — the engine's single definition:
 *
 *   spendable cash
 *   − recurring charges expected between today and the end of this calendar
 *     month (UTC)
 *   − positive credit-card balances, in full (policy)
 *   − buffer (policy)
 *
 * Every figure that went into the number is listed in `inputs`, every
 * assumption in `assumptions`, and every balance carries its freshness. The
 * result is signed and never clamped; when obligations exceed cash the excess
 * is reported as `uncoveredObligationsCents`.
 */
export function computeSafeToSpend(
  input: EngineInput,
  policy: EnginePolicy,
  recurring: RecurringResult
): SafeToSpendResult {
  const today = utcDateOf(input.now);
  if (today === null) throw new Error("computeSafeToSpend: invalid now");
  // A policy is a caller-supplied constant; a broken one is a caller bug, not
  // data. NaN would otherwise make every comparison below false and report a
  // computed figure with no shortfall.
  if (!isCents(policy.bufferCents)) {
    throw new Error("computeSafeToSpend: invalid bufferCents");
  }
  const horizonEnd = endOfMonthUtc(today);
  const fromDay = dayNumber(today) as number;
  const toDay = dayNumber(horizonEnd) as number;

  const assumptions: AssumptionCode[] = ["dates_utc"];
  const addAssumption = (code: AssumptionCode) => {
    if (assumptions.indexOf(code) === -1) assumptions.push(code);
  };

  const result: SafeToSpendResult = {
    status: "computed",
    reason: null,
    amountCents: null,
    uncoveredObligationsCents: null,
    obligationsExceedCash: false,
    horizon: { from: today, to: horizonEnd, rule: "end_of_calendar_month_utc" },
    inputs: {
      balances: [],
      upcomingRecurring: [],
      creditCardBalances: [],
      excludedRecurring: [],
      excludedAccounts: [],
    },
    totals: {
      spendableCashCents: 0,
      upcomingRecurringCents: 0,
      reservedCreditCents: 0,
      bufferCents: policy.bufferCents,
    },
    policy: {
      spendableSubtypes: policy.spendableSubtypes.slice(),
      reserveCreditCardBalances: policy.reserveCreditCardBalances,
      bufferCents: policy.bufferCents,
    },
    assumptions,
    freshness: { oldestAsOf: null, oldestFetchedAt: null, anyAsOfUnknown: false },
  };

  const noteFreshness = (asOf: string | null, fetchedAt: string | null) => {
    const f = result.freshness;
    if (asOf === null) f.anyAsOfUnknown = true;
    else f.oldestAsOf = olderOf(f.oldestAsOf, asOf);
    if (fetchedAt !== null) f.oldestFetchedAt = olderOf(f.oldestFetchedAt, fetchedAt);
  };

  const excludeForCurrency = (accountId: string) => {
    result.inputs.excludedAccounts.push({ accountId, reason: "other_currency" });
    addAssumption("other_currency_accounts_excluded");
  };

  // ---- spendable cash and card balances
  const accounts = uniqueAccounts(input.accounts).accounts;
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];

    if (a.type === "depository") {
      if (a.subtype === null) {
        addAssumption("unknown_subtype_excluded");
        continue;
      }
      if (policy.spendableSubtypes.indexOf(a.subtype) === -1) continue;
      // Includes a null (unofficial) currency. Nothing is converted.
      if (a.currency !== input.currency) {
        excludeForCurrency(a.accountId);
        continue;
      }

      let field: "available" | "current";
      let cents: number;
      if (isCents(a.availableCents)) {
        field = "available";
        cents = a.availableCents;
        addAssumption("available_reflects_pending");
      } else if (isCents(a.currentCents)) {
        field = "current";
        cents = a.currentCents;
        addAssumption("current_used_when_available_missing");
      } else {
        result.inputs.excludedAccounts.push({
          accountId: a.accountId,
          reason: "no_balance",
        });
        continue;
      }
      const fresh = freshnessOf(a);
      result.inputs.balances.push({
        accountId: a.accountId,
        subtype: a.subtype,
        field,
        cents,
        asOf: fresh.asOf,
        fetchedAt: fresh.fetchedAt,
        asOfSource: fresh.asOfSource,
      });
      result.totals.spendableCashCents += cents;
      noteFreshness(fresh.asOf, fresh.fetchedAt);
    } else if (a.type === "credit" && policy.reserveCreditCardBalances) {
      if (a.currency !== input.currency) {
        // An other-currency card's balance is not reserved, which makes the
        // result higher than it would be — hence the explicit listing.
        excludeForCurrency(a.accountId);
        continue;
      }
      if (!isCents(a.currentCents) || a.currentCents <= 0) continue;
      const fresh = freshnessOf(a);
      result.inputs.creditCardBalances.push({
        accountId: a.accountId,
        cents: a.currentCents,
        asOf: fresh.asOf,
        fetchedAt: fresh.fetchedAt,
        asOfSource: fresh.asOfSource,
      });
      result.totals.reservedCreditCents += a.currentCents;
      noteFreshness(fresh.asOf, fresh.fetchedAt);
    }
  }
  if (policy.reserveCreditCardBalances) {
    addAssumption("credit_balances_reserved_in_full");
  }

  // ---- recurring charges due before the horizon ends
  if (input.recurring.source !== "plaid_streams") {
    addAssumption("recurring_unavailable");
  } else {
    for (let i = 0; i < recurring.excluded.length; i++) {
      result.inputs.excludedRecurring.push({
        streamId: recurring.excluded[i].streamId,
        reason: recurring.excluded[i].reason,
      });
    }
    const streamsById: Record<string, EngineRecurringStream> = {};
    const streams = input.recurring.streams;
    for (let i = 0; i < streams.length; i++) {
      streamsById[streams[i].streamId] = streams[i];
    }
    for (let i = 0; i < recurring.items.length; i++) {
      const item = recurring.items[i];
      const stream = streamsById[item.streamId];
      if (!stream || nextDateOf(stream) === null) {
        result.inputs.excludedRecurring.push({
          streamId: item.streamId,
          reason: "no_next_date",
        });
        addAssumption("recurring_without_next_date_excluded");
        continue;
      }
      // SEMI_MONTHLY dates are spaced 15 days apart rather than on the stream's
      // real calendar days, so the count inside the horizon can be off by one.
      if (stream.frequency === "SEMI_MONTHLY") {
        addAssumption("semi_monthly_spacing_approximated");
      }
      const dates = upcomingOccurrences(stream, fromDay, toDay);
      for (let j = 0; j < dates.length; j++) {
        result.inputs.upcomingRecurring.push({
          streamId: item.streamId,
          label: item.label,
          dueDate: dates[j],
          cents: item.basisCents,
        });
        result.totals.upcomingRecurringCents += item.basisCents;
      }
    }
  }

  // The horizon includes today. A charge due today may already sit in an
  // available balance as a pending debit, in which case it is subtracted
  // twice. The figure is left as is; the possibility is stated.
  let anyDueToday = false;
  for (let i = 0; i < result.inputs.upcomingRecurring.length; i++) {
    if (result.inputs.upcomingRecurring[i].dueDate === today) anyDueToday = true;
  }
  let anyAvailableUsed = false;
  for (let i = 0; i < result.inputs.balances.length; i++) {
    if (result.inputs.balances[i].field === "available") anyAvailableUsed = true;
  }
  if (anyDueToday && anyAvailableUsed) {
    addAssumption("recurring_due_today_may_already_be_pending");
  }

  if (result.freshness.anyAsOfUnknown) addAssumption("balance_as_of_unknown");

  if (result.inputs.balances.length === 0) {
    result.status = "unavailable";
    result.reason = "no_spendable_balance";
    return result;
  }

  const t = result.totals;
  const amount =
    t.spendableCashCents -
    t.upcomingRecurringCents -
    t.reservedCreditCents -
    t.bufferCents;
  result.amountCents = amount;
  result.uncoveredObligationsCents = amount < 0 ? -amount : 0;
  result.obligationsExceedCash = amount < 0;
  return result;
}
