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
import { computeCashFlow, transactionKey, uniqueAccounts } from "./cashFlow";
import { computeRecurring } from "./recurring";
import { computeSafeToSpend } from "./safeToSpend";
import { computeCreditUtilization } from "./creditUtilization";

export const ENGINE_VERSION = "v1" as const;

export const DEFAULT_POLICY: EnginePolicy = {
  spendableSubtypes: ["checking", "cash management", "prepaid", "paypal"],
  reserveCreditCardBalances: true,
  bufferCents: 0,
};

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

  // ---- recurring streams
  if (input.recurring.source === "plaid_streams") {
    const streams = input.recurring.streams;
    const seenStreams: Record<string, true> = {};
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i];
      if (!s || typeof s.streamId !== "string" || s.streamId === "") {
        issues.push({ kind: "stream", id: "", reason: "missing_id" });
        continue;
      }
      if (seenStreams[s.streamId]) {
        issues.push({ kind: "stream", id: s.streamId, reason: "duplicate" });
        continue;
      }
      seenStreams[s.streamId] = true;
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
 * Computes every v1 metric from one input. Throws only when `input.now` does
 * not parse, which is a caller bug; bad data is skipped and reported in
 * `dataIssues` and in each metric's exclusion counts.
 */
export function computeFinancialSummary(
  input: EngineInput,
  policy: EnginePolicy = DEFAULT_POLICY
): FinancialSummary {
  if (utcDateOf(input.now) === null) {
    throw new Error("computeFinancialSummary: invalid now");
  }
  const recurring = computeRecurring(input);
  return {
    engineVersion: ENGINE_VERSION,
    currency: input.currency,
    computedAt: input.now,
    cashFlow: computeCashFlow(input),
    recurring,
    safeToSpend: computeSafeToSpend(input, policy, recurring),
    creditUtilization: computeCreditUtilization(input),
    dataIssues: collectDataIssues(input),
  };
}

export { toCents, isCents, sumCents, monthlyCentsFromCadence } from "./money";
export {
  isIsoDate,
  dayNumber,
  fromDayNumber,
  utcDateOf,
  parseTimestampMs,
  endOfMonthUtc,
  addCadence,
  freshnessOf,
} from "./dates";
export { classifyTransaction } from "./classify";
export type { TxnClass, ClassificationSource } from "./classify";
export { computeCashFlow } from "./cashFlow";
export { computeRecurring, upcomingOccurrences } from "./recurring";
export { computeSafeToSpend } from "./safeToSpend";
export { computeCreditUtilization } from "./creditUtilization";
export type * from "./types";
