// =============================================================================
// Finance engine v1 — entry point.
//
// Pure computation over normalized inputs; derived metrics are never stored,
// they are computed per request. See types.ts for the input contract and the
// output boundary, and financeEngineBoundary.test.ts for how that boundary is
// enforced.
// =============================================================================

import type {
  DataIssue,
  EngineInput,
  EnginePolicy,
  FinancialSummary,
} from "./types";
import { isCents } from "./money";
import { dayNumber, isIsoDate, parseTimestampMs, utcDateOf } from "./dates";
import { cashFlowDetail, transactionKey, uniqueAccounts } from "./cashFlow";
import { computeRecurring } from "./recurring";
import { computeSafeToSpend } from "./safeToSpend";
import { computeCreditUtilization } from "./creditUtilization";
import { coverageOf } from "./coverage";
import { dropDuplicateAccountCopies } from "./duplicates";
import { DEFAULT_POLICY } from "./policy";

export const ENGINE_VERSION = "v1" as const;

export { DEFAULT_POLICY };

function collectDataIssues(input: EngineInput): DataIssue[] {
  const issues: DataIssue[] = [];

  const start = dayNumber(input.period.start);
  const end = dayNumber(input.period.end);
  if (start === null || end === null || end < start) {
    issues.push({ kind: "period", id: "period", reason: "invalid_period" });
  }

  // ---- accounts: same dedupe as the metrics (first wins)
  for (let i = 0; i < input.accounts.length; i++) {
    const a = input.accounts[i];
    if (!a || typeof a.accountId !== "string" || a.accountId === "") {
      issues.push({ kind: "account", id: "", reason: "missing_id" });
    }
  }
  const unique = uniqueAccounts(input.accounts);
  for (let i = 0; i < unique.duplicateIds.length; i++) {
    issues.push({ kind: "account", id: unique.duplicateIds[i], reason: "duplicate" });
  }
  for (let i = 0; i < unique.accounts.length; i++) {
    const a = unique.accounts[i];
    const amounts = [a.currentCents, a.availableCents, a.limitCents];
    for (let j = 0; j < amounts.length; j++) {
      if (amounts[j] !== null && !isCents(amounts[j])) {
        issues.push({ kind: "account", id: a.accountId, reason: "invalid_amount" });
        break;
      }
    }
    if (parseTimestampMs(a.fetchedAt) === null) {
      issues.push({ kind: "account", id: a.accountId, reason: "invalid_fetched_at" });
    }
    if (a.balanceAsOf !== null && parseTimestampMs(a.balanceAsOf) === null) {
      issues.push({ kind: "account", id: a.accountId, reason: "invalid_balance_as_of" });
    }
    if (a.type === "depository" && a.availableCents === null && a.currentCents === null) {
      issues.push({ kind: "account", id: a.accountId, reason: "no_balance" });
    }
  }

  // ---- transactions
  const seen: Record<string, true> = {};
  for (let i = 0; i < input.transactions.length; i++) {
    const t = input.transactions[i];
    if (!t || typeof t.transactionId !== "string" || t.transactionId === "") {
      issues.push({ kind: "transaction", id: "", reason: "missing_id" });
      continue;
    }
    if (typeof t.accountId !== "string") {
      issues.push({ kind: "transaction", id: t.transactionId, reason: "invalid_account_id" });
      continue;
    }
    if (!isCents(t.amountCents)) {
      issues.push({ kind: "transaction", id: t.transactionId, reason: "invalid_amount" });
      continue;
    }
    if (!isIsoDate(t.date)) {
      issues.push({ kind: "transaction", id: t.transactionId, reason: "invalid_date" });
      continue;
    }
    const key = transactionKey(t);
    if (seen[key]) {
      issues.push({ kind: "transaction", id: t.transactionId, reason: "duplicate" });
      continue;
    }
    seen[key] = true;
  }

  // ---- recurring streams, only when they are used
  if (coverageOf(input).recurringAvailable) {
    const streams = input.recurring.streams;
    // Same rule as uniqueStreams: first copy wins, and a Set so that an id
    // like "constructor" is not read as already seen.
    const seenStreams = new Set<string>();
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i];
      if (!s || typeof s.streamId !== "string" || s.streamId === "") {
        issues.push({ kind: "stream", id: "", reason: "missing_id" });
        continue;
      }
      if (seenStreams.has(s.streamId)) {
        issues.push({ kind: "stream", id: s.streamId, reason: "duplicate" });
        continue;
      }
      seenStreams.add(s.streamId);
      if (s.predictedNextDate !== null && !isIsoDate(s.predictedNextDate)) {
        issues.push({ kind: "stream", id: s.streamId, reason: "invalid_predicted_next_date" });
      }
      const amounts = [s.averageAmountCents, s.lastAmountCents];
      for (let j = 0; j < amounts.length; j++) {
        if (amounts[j] !== null && !isCents(amounts[j])) {
          issues.push({ kind: "stream", id: s.streamId, reason: "invalid_amount" });
          break;
        }
      }
    }
  }

  return issues;
}

/**
 * The dates and lists the caller builds, as opposed to the data it passes
 * through. Each check failing is a caller bug:
 *   - `now` and `today` parse, and `dateBasis` is a known basis;
 *   - `readWindow` is a valid range that ends on `today`, so every date in
 *     one answer counts from the same day;
 *   - a valid `period` lies inside `readWindow`, so the cash flow never
 *     counts days whose transactions were not read. A period that is not a
 *     valid range at all stays data: it is reported as `invalid_period`;
 *   - `connections` is a list.
 */
function checkCallerInput(input: EngineInput): void {
  const fail = (what: string) => {
    throw new Error("computeFinancialSummary: invalid " + what);
  };
  if (utcDateOf(input.now) === null) fail("now");
  if (!isIsoDate(input.today)) fail("today");
  if (input.dateBasis !== "user_time_zone" && input.dateBasis !== "utc") fail("dateBasis");

  const window = input.readWindow;
  const windowStart = window ? dayNumber(window.start) : null;
  const windowEnd = window ? dayNumber(window.end) : null;
  if (windowStart === null || windowEnd === null || windowStart > windowEnd) fail("readWindow");
  if (window.end !== input.today) fail("readWindow (it must end on today)");

  const periodStart = dayNumber(input.period.start);
  const periodEnd = dayNumber(input.period.end);
  if (periodStart !== null && periodEnd !== null && periodStart <= periodEnd) {
    if (periodStart < (windowStart as number) || periodEnd > (windowEnd as number)) {
      fail("period (it must lie inside readWindow)");
    }
  }

  if (!Array.isArray(input.connections)) fail("connections");
}

/**
 * Computes every v1 metric from one input. Throws only on a caller bug (see
 * checkCallerInput) or an invalid policy; bad data is skipped and reported in
 * `dataIssues` and in each metric's exclusion counts. Copies of one bank
 * account reached through two connections are left out first, so every
 * metric sees each account once.
 */
export function computeFinancialSummary(
  rawInput: EngineInput,
  policy: EnginePolicy = DEFAULT_POLICY
): FinancialSummary {
  checkCallerInput(rawInput);
  const { input, dropped } = dropDuplicateAccountCopies(rawInput);
  const coverage = coverageOf(input);
  const recurring = computeRecurring(input, policy);
  const cashFlow = cashFlowDetail(input);
  const dataIssues = collectDataIssues(input);
  // Only the transactions the cash flow actually counted into the bucket, so
  // the bucket count and these issues always match.
  for (let i = 0; i < cashFlow.unclassifiedCategoryIds.length; i++) {
    dataIssues.push({
      kind: "transaction",
      id: cashFlow.unclassifiedCategoryIds[i],
      reason: "unclassified_category",
    });
  }
  const safeToSpend = computeSafeToSpend(input, policy, recurring);
  return {
    engineVersion: ENGINE_VERSION,
    currency: input.currency,
    computedAt: input.now,
    coverage: {
      completeness: coverage.completeness,
      allConnectionsRead: coverage.allConnectionsRead,
      safeToSpendShowable:
        coverage.allConnectionsRead && safeToSpend.status === "computed",
      duplicateCopiesDropped: dropped,
    },
    cashFlow: cashFlow.result,
    recurring,
    safeToSpend,
    creditUtilization: computeCreditUtilization(input),
    dataIssues,
  };
}

export { toCents, isCents, sumCents, monthlyCentsFromCadence } from "./money";
export {
  isIsoDate,
  dayNumber,
  fromDayNumber,
  utcDateOf,
  parseTimestampMs,
  endOfMonth,
  addCadence,
  freshnessOf,
} from "./dates";
export { classifyTransaction, isCardPaymentCategory } from "./classify";
export type { TxnClass, ClassificationSource } from "./classify";
export { computeCashFlow } from "./cashFlow";
export { computeRecurring, upcomingOccurrences } from "./recurring";
export { computeSafeToSpend } from "./safeToSpend";
export { computeCreditUtilization } from "./creditUtilization";
export { computeCoverage, coverageOf } from "./coverage";
export { dropDuplicateAccountCopies } from "./duplicates";
export type { DuplicateCopiesDropped } from "./duplicates";
export type { CoverageDecision } from "./coverage";
export type * from "./types";
