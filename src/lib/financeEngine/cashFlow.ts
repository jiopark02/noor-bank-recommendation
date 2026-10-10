import type {
  AssumptionCode,
  CashFlowResult,
  EngineAccount,
  EngineInput,
  EngineTransaction,
} from "./types";
import { isCents } from "./money";
import { dayNumber, isIsoDate } from "./dates";
import { classifyTransaction } from "./classify";

/** A transaction that cannot be counted at all: no id, a non-integer amount, a bad date. */
export function isValidTransaction(t: EngineTransaction): boolean {
  return (
    typeof t.transactionId === "string" &&
    t.transactionId !== "" &&
    typeof t.accountId === "string" &&
    isCents(t.amountCents) &&
    isIsoDate(t.date)
  );
}

export function transactionKey(t: EngineTransaction): string {
  return t.accountId + ":" + t.transactionId;
}

/**
 * The one account dedupe every metric uses: the first account with a given id
 * wins, later ones are dropped and returned as `duplicateIds` (the entry point
 * reports them). Accounts without a usable id are dropped too.
 */
export function uniqueAccounts(accounts: EngineAccount[]): {
  accounts: EngineAccount[];
  duplicateIds: string[];
} {
  const seen: Record<string, true> = {};
  const unique: EngineAccount[] = [];
  const duplicateIds: string[] = [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    if (!a || typeof a.accountId !== "string" || a.accountId === "") continue;
    if (seen[a.accountId]) {
      duplicateIds.push(a.accountId);
      continue;
    }
    seen[a.accountId] = true;
    unique.push(a);
  }
  return { accounts: unique, duplicateIds };
}

export function indexAccounts(
  accounts: EngineAccount[]
): Record<string, EngineAccount> {
  const byId: Record<string, EngineAccount> = {};
  const unique = uniqueAccounts(accounts).accounts;
  for (let i = 0; i < unique.length; i++) byId[unique[i].accountId] = unique[i];
  return byId;
}

/**
 * Income and spending over the caller's period. Totals only: nothing is
 * extrapolated to a month, and every transaction that was left out is counted
 * in an `excluded` bucket with its reason.
 */
export function computeCashFlow(input: EngineInput): CashFlowResult {
  const startDay = dayNumber(input.period.start);
  const endDay = dayNumber(input.period.end);
  const periodValid = startDay !== null && endDay !== null && endDay >= startDay;

  const result: CashFlowResult = {
    period: {
      start: input.period.start,
      end: input.period.end,
      days: periodValid ? (endDay as number) - (startDay as number) + 1 : 0,
      completeness: input.period.completeness,
    },
    incomeCents: 0,
    spendingGrossCents: 0,
    refundsCents: 0,
    spendingNetCents: 0,
    netCents: 0,
    unclassifiedInflowCents: 0,
    excluded: {
      pending: { count: 0, cents: 0 },
      betweenAccounts: { count: 0, cents: 0 },
      cardPayments: { count: 0, cents: 0 },
      nonCashAccounts: { count: 0, cents: 0 },
      unknownAccount: { count: 0 },
      otherCurrency: { count: 0 },
      outsidePeriod: { count: 0 },
      invalid: { count: 0 },
    },
    classificationSource: { pfc: 0, legacy: 0, none: 0 },
    assumptions: [],
  };

  const accounts = indexAccounts(input.accounts);
  const seen: Record<string, true> = {};
  const ex = result.excluded;

  for (let i = 0; i < input.transactions.length; i++) {
    const t = input.transactions[i];
    if (!t || !isValidTransaction(t)) {
      ex.invalid.count += 1;
      continue;
    }
    const key = transactionKey(t);
    if (seen[key]) {
      ex.invalid.count += 1;
      continue;
    }
    seen[key] = true;

    if (t.currency !== input.currency) {
      ex.otherCurrency.count += 1;
      continue;
    }
    const day = dayNumber(t.date) as number;
    if (!periodValid || day < (startDay as number) || day > (endDay as number)) {
      ex.outsidePeriod.count += 1;
      continue;
    }

    const { cls, source } = classifyTransaction(t, accounts[t.accountId]);
    result.classificationSource[source] += 1;
    const magnitude = Math.abs(t.amountCents);

    switch (cls) {
      case "spending":
        result.spendingGrossCents += t.amountCents;
        break;
      case "income":
        result.incomeCents += magnitude;
        break;
      case "refund":
        result.refundsCents += magnitude;
        break;
      case "unclassified_inflow":
        result.unclassifiedInflowCents += magnitude;
        break;
      case "excluded_pending":
        ex.pending.count += 1;
        ex.pending.cents += magnitude;
        break;
      case "excluded_between_accounts":
        ex.betweenAccounts.count += 1;
        ex.betweenAccounts.cents += magnitude;
        break;
      case "excluded_card_payment":
        ex.cardPayments.count += 1;
        ex.cardPayments.cents += magnitude;
        break;
      case "excluded_non_cash_account":
        ex.nonCashAccounts.count += 1;
        ex.nonCashAccounts.cents += magnitude;
        break;
      case "excluded_unknown_account":
        ex.unknownAccount.count += 1;
        break;
    }
  }

  result.spendingNetCents = result.spendingGrossCents - result.refundsCents;
  result.netCents = result.incomeCents - result.spendingNetCents;

  const assumptions: AssumptionCode[] = ["dates_utc"];
  if (ex.betweenAccounts.count > 0) {
    assumptions.push("account_to_account_excluded_ownership_unknown");
  }
  if (result.classificationSource.legacy > 0) {
    assumptions.push("legacy_categories_used");
  }
  if (result.classificationSource.none > 0) {
    assumptions.push("no_category_data");
  }
  result.assumptions = assumptions;

  return result;
}
