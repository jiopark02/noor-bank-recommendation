import type { EngineAccount, EngineTransaction } from "./types";

export type TxnClass =
  | "spending"
  | "income"
  | "refund"
  | "unclassified_inflow"
  | "excluded_pending"
  | "excluded_between_accounts"
  | "excluded_card_payment"
  | "excluded_non_cash_account"
  | "excluded_unknown_account";

export type ClassificationSource = "pfc" | "legacy" | "none";

const CARD_PAYMENT_DETAILED = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

function sourceOf(t: EngineTransaction): ClassificationSource {
  if (typeof t.pfcPrimary === "string" && t.pfcPrimary.trim() !== "") {
    return "pfc";
  }
  // The card-payment detailed category is decisive on its own, so a row that
  // carries it without a primary is still classified from PFC.
  if (t.pfcDetailed === CARD_PAYMENT_DETAILED) return "pfc";
  if (Array.isArray(t.legacyCategory) && t.legacyCategory.length > 0) {
    return "legacy";
  }
  return "none";
}

function bySign(amountCents: number, inflow: TxnClass): TxnClass {
  return amountCents < 0 ? inflow : "spending";
}

/**
 * Decides how one transaction counts toward cash flow.
 *
 * Personal finance category (PFC) is used first; the legacy category is a
 * fallback; with neither, only the sign is known and inflows stay unclassified
 * rather than being called income.
 *
 * Transfer primaries are excluded as movement between accounts. Plaid's PFC
 * descriptions do not say whether the other account belongs to the same user,
 * so this bucket can also hold payments to and from other people. The cash
 * flow result carries that as an assumption code instead of hiding it.
 */
export function classifyTransaction(
  t: EngineTransaction,
  acct: EngineAccount | undefined
): { cls: TxnClass; source: ClassificationSource } {
  const source = sourceOf(t);

  if (!acct) return { cls: "excluded_unknown_account", source };
  if (acct.type !== "depository" && acct.type !== "credit") {
    return { cls: "excluded_non_cash_account", source };
  }
  if (t.pending) return { cls: "excluded_pending", source };

  if (source === "pfc") {
    // Checked before the primary, which may be absent for this category.
    if (t.pfcDetailed === CARD_PAYMENT_DETAILED) {
      return { cls: "excluded_card_payment", source };
    }
    const primary = t.pfcPrimary as string;
    if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") {
      return { cls: "excluded_between_accounts", source };
    }
    if (primary === "INCOME") {
      return { cls: bySign(t.amountCents, "income"), source };
    }
    // Any other category: an outflow is spending, an inflow is a refund
    // against spending.
    return { cls: bySign(t.amountCents, "refund"), source };
  }

  if (source === "legacy") {
    const top = t.legacyCategory[0];
    const sub = t.legacyCategory[1];
    if (top === "Payment" && sub === "Credit Card") {
      return { cls: "excluded_card_payment", source };
    }
    // Plaid's legacy taxonomy files payroll under Transfer.
    if (top === "Transfer" && sub === "Payroll") {
      return { cls: bySign(t.amountCents, "income"), source };
    }
    if (top === "Transfer") {
      return { cls: "excluded_between_accounts", source };
    }
    // The legacy taxonomy cannot tell a refund from income.
    return { cls: bySign(t.amountCents, "unclassified_inflow"), source };
  }

  return { cls: bySign(t.amountCents, "unclassified_inflow"), source };
}
