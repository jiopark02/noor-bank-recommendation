import type { CreditUtilizationResult, EngineInput, Freshness } from "./types";
import { isCents } from "./money";
import { freshnessOf } from "./dates";
import { uniqueAccounts } from "./cashFlow";

/**
 * Credit utilization, descriptive only: balance over limit per card and in
 * aggregate, in basis points. No threshold, grade, or target is attached.
 */
export function computeCreditUtilization(
  input: EngineInput
): CreditUtilizationResult {
  const result: CreditUtilizationResult = {
    accounts: [],
    aggregate: {
      balanceCents: 0,
      limitCents: 0,
      ratioBasisPoints: null,
      accountsIncluded: 0,
      accountsExcluded: 0,
    },
    excludedAccounts: [],
    assumptions: [],
  };

  const accounts = uniqueAccounts(input.accounts).accounts;
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    if (a.type !== "credit") continue;
    if (a.currency !== input.currency) {
      // Includes a null (unofficial) currency. Nothing is converted.
      result.aggregate.accountsExcluded += 1;
      result.excludedAccounts.push({ accountId: a.accountId, reason: "other_currency" });
      if (result.assumptions.indexOf("other_currency_accounts_excluded") === -1) {
        result.assumptions.push("other_currency_accounts_excluded");
      }
      continue;
    }

    const balance = isCents(a.currentCents) ? a.currentCents : null;
    const limit = isCents(a.limitCents) && a.limitCents > 0 ? a.limitCents : null;
    const fresh: Freshness = freshnessOf(a);

    let state: CreditUtilizationResult["accounts"][number]["state"];
    let ratio: number | null = null;
    if (limit === null) {
      state = "no_limit";
    } else if (balance === null) {
      state = "no_balance";
    } else if (balance < 0) {
      state = "credit_balance";
      ratio = 0;
    } else {
      state = "measured";
      ratio = Math.round((balance * 10000) / limit);
    }

    result.accounts.push({
      accountId: a.accountId,
      balanceCents: balance,
      limitCents: limit,
      ratioBasisPoints: ratio,
      state,
      asOf: fresh.asOf,
      fetchedAt: fresh.fetchedAt,
      asOfSource: fresh.asOfSource,
    });

    if (state === "measured" || state === "credit_balance") {
      // A credit balance owes nothing; it counts as 0, not as an offset
      // against another card's balance.
      result.aggregate.balanceCents += Math.max(0, balance as number);
      result.aggregate.limitCents += limit as number;
      result.aggregate.accountsIncluded += 1;
    } else {
      result.aggregate.accountsExcluded += 1;
    }
  }

  if (result.aggregate.limitCents > 0) {
    result.aggregate.ratioBasisPoints = Math.round(
      (result.aggregate.balanceCents * 10000) / result.aggregate.limitCents
    );
  }

  return result;
}
