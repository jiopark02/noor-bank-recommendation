import type { EngineAccount, EnginePolicy } from "./types";
import { isCents } from "./money";

/** The safe-to-spend definition the screens use. */
export const DEFAULT_POLICY: EnginePolicy = {
  spendableSubtypes: ["checking", "cash management", "prepaid", "paypal"],
  reserveCreditCardBalances: true,
  bufferCents: 0,
  pastDueGraceDays: 7,
};

/**
 * Whether safe-to-spend reserves this account's balance as a card balance:
 * a credit account, while the policy reserves card balances, in the summary
 * currency, with a balance that is an amount owed (more than 0). A card with
 * no balance, a zero or credit balance, or another currency is not reserved.
 *
 * The one definition both places use: the card reserve in computeSafeToSpend,
 * and computeRecurring, which leaves out a card-payment stream only when the
 * reserve already covers that card.
 */
export function reservesCardBalance(
  account: EngineAccount,
  policy: Pick<EnginePolicy, "reserveCreditCardBalances">,
  currency: string
): boolean {
  return (
    account.type === "credit" &&
    policy.reserveCreditCardBalances === true &&
    account.currency === currency &&
    isCents(account.currentCents) &&
    account.currentCents > 0
  );
}
