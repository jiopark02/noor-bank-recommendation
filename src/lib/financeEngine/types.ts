// =============================================================================
// Finance engine v1 — input and output types.
//
// The engine is a pure module: it imports nothing outside this directory, reads
// no environment, makes no network call and never reads the clock. Callers hand
// it normalized data (see the adapter notes below) and the current time.
//
// Money is integer cents throughout. Plaid's sign convention is kept on
// transactions: a positive amount is money leaving the account, a negative
// amount is money arriving.
//
// Output boundary (enforced by financeEngineBoundary.test.ts, not by review):
//   - no number embeds a future rate-of-return assumption;
//   - no number refers to a product or institution as a recommendation;
//   - no number tells the user to move money between accounts.
// Every numeric output path is pinned in that test, so adding a number here
// fails CI until the pinned list is changed deliberately.
// =============================================================================

/** Integer number of cents. */
export type Cents = number;
/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/**
 * ISO 8601 date-time string with an explicit zone ("Z" or ±hh:mm). A zone-less
 * date-time is invalid: `now` throws, any other field is reported in
 * `dataIssues` and treated as null.
 */
export type IsoDateTime = string;

// ---- input ------------------------------------------------------------------

export interface EngineAccount {
  accountId: string;
  /** Plaid's account type, not the app's collapsed mapping. */
  type: "depository" | "credit" | "loan" | "investment" | "other";
  subtype: string | null;
  /** null means the source returned no balance — never coerced to 0. */
  currentCents: Cents | null;
  availableCents: Cents | null;
  limitCents: Cents | null;
  /** ISO currency code; null when the source reported only an unofficial one. */
  currency: string | null;
  /** When the institution says the balance was measured, if it says. */
  balanceAsOf: IsoDateTime | null;
  /** When our server received the balance. Not a substitute for balanceAsOf. */
  fetchedAt: IsoDateTime;
}

export interface EngineTransaction {
  transactionId: string;
  accountId: string;
  /** Plaid sign: positive = outflow, negative = inflow. */
  amountCents: Cents;
  currency: string | null;
  date: IsoDate;
  pending: boolean;
  /** Plaid personal_finance_category, v1 or v2 strings, treated as opaque. */
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  /** Plaid legacy category hierarchy. May be empty. */
  legacyCategory: string[];
}

export type RecurringFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";

export type RecurringStatus =
  | "MATURE"
  | "EARLY_DETECTION"
  | "TOMBSTONED"
  | "UNKNOWN";

export interface EngineRecurringStream {
  streamId: string;
  label: string;
  frequency: RecurringFrequency;
  /** Positive cents per occurrence (Plaid outflow streams report positive amounts). */
  averageAmountCents: Cents | null;
  lastAmountCents: Cents | null;
  currency: string | null;
  lastDate: IsoDate | null;
  predictedNextDate: IsoDate | null;
  isActive: boolean;
  status: RecurringStatus;
}

export interface EngineInput {
  /** The current time, injected by the caller. */
  now: IsoDateTime;
  /** The single currency every figure is computed in. Nothing is converted. */
  currency: string;
  accounts: EngineAccount[];
  transactions: EngineTransaction[];
  /** The window the caller fetched transactions for, inclusive on both ends. */
  period: {
    start: IsoDate;
    end: IsoDate;
    completeness: "complete" | "possibly_truncated" | "unknown";
  };
  recurring:
    | { source: "plaid_streams"; streams: EngineRecurringStream[] }
    | { source: "unavailable" };
}

/** The adjustable parts of the safe-to-spend definition. Echoed in the output. */
export interface EnginePolicy {
  /** Depository subtypes whose balance counts as spendable cash. */
  spendableSubtypes: string[];
  /** Whether positive credit-card balances are subtracted in full. */
  reserveCreditCardBalances: boolean;
  bufferCents: Cents;
}

// ---- output -----------------------------------------------------------------

export type AssumptionCode =
  | "account_to_account_excluded_ownership_unknown"
  | "legacy_categories_used"
  | "no_category_data"
  | "available_reflects_pending"
  | "current_used_when_available_missing"
  | "unknown_subtype_excluded"
  | "recurring_unavailable"
  | "recurring_without_next_date_excluded"
  | "credit_balances_reserved_in_full"
  | "dates_utc"
  | "balance_as_of_unknown"
  | "other_currency_accounts_excluded"
  | "semi_monthly_spacing_approximated"
  | "recurring_due_today_may_already_be_pending";

/** An account a metric left out, and why. */
export interface ExcludedAccount {
  accountId: string;
  reason: "other_currency" | "no_balance";
}

export interface Freshness {
  asOf: IsoDateTime | null;
  /** null when the input's fetchedAt was not a zoned date-time. */
  fetchedAt: IsoDateTime | null;
  asOfSource: "institution" | "unknown";
}

export interface Bucket {
  count: number;
  cents: Cents;
}

export interface CashFlowResult {
  period: {
    start: IsoDate;
    end: IsoDate;
    /** Inclusive day count; 0 when the period is not a valid date range. */
    days: number;
    completeness: EngineInput["period"]["completeness"];
  };
  incomeCents: Cents;
  spendingGrossCents: Cents;
  refundsCents: Cents;
  spendingNetCents: Cents;
  netCents: Cents;
  unclassifiedInflowCents: Cents;
  excluded: {
    pending: Bucket;
    betweenAccounts: Bucket;
    cardPayments: Bucket;
    nonCashAccounts: Bucket;
    unknownAccount: { count: number };
    otherCurrency: { count: number };
    outsidePeriod: { count: number };
    invalid: { count: number };
  };
  classificationSource: { pfc: number; legacy: number; none: number };
  assumptions: AssumptionCode[];
}

export type RecurringExclusionReason =
  | "unknown_frequency"
  | "no_amount"
  | "inactive"
  | "tombstoned"
  | "other_currency";

export interface RecurringResult {
  source: "plaid_streams" | "unavailable";
  items: Array<{
    streamId: string;
    label: string;
    frequency: RecurringFrequency;
    status: RecurringStatus;
    basis: "average" | "last";
    basisCents: Cents;
    monthlyCents: Cents;
    nextDate: IsoDate | null;
  }>;
  /** null when no recurring data was available at all. */
  totalMonthlyCents: Cents | null;
  excluded: Array<{ streamId: string; reason: RecurringExclusionReason }>;
}

export interface SafeToSpendResult {
  status: "computed" | "unavailable";
  reason: "no_spendable_balance" | null;
  /** Signed. Never clamped: a negative value is reported as negative. */
  amountCents: Cents | null;
  /** How far committed obligations exceed spendable cash; 0 when they do not. */
  uncoveredObligationsCents: Cents | null;
  obligationsExceedCash: boolean;
  horizon: { from: IsoDate; to: IsoDate; rule: "end_of_calendar_month_utc" };
  inputs: {
    balances: Array<
      {
        accountId: string;
        subtype: string | null;
        field: "available" | "current";
        cents: Cents;
      } & Freshness
    >;
    upcomingRecurring: Array<{
      streamId: string;
      label: string;
      dueDate: IsoDate;
      cents: Cents;
    }>;
    creditCardBalances: Array<{ accountId: string; cents: Cents } & Freshness>;
    excludedRecurring: Array<{
      streamId: string;
      reason: RecurringExclusionReason | "no_next_date";
    }>;
    /** Spendable-subtype or card accounts that could not be counted. */
    excludedAccounts: ExcludedAccount[];
  };
  totals: {
    spendableCashCents: Cents;
    upcomingRecurringCents: Cents;
    reservedCreditCents: Cents;
    bufferCents: Cents;
  };
  policy: EnginePolicy;
  assumptions: AssumptionCode[];
  freshness: {
    oldestAsOf: IsoDateTime | null;
    oldestFetchedAt: IsoDateTime | null;
    anyAsOfUnknown: boolean;
  };
}

export interface CreditUtilizationResult {
  accounts: Array<
    {
      accountId: string;
      balanceCents: Cents | null;
      limitCents: Cents | null;
      ratioBasisPoints: number | null;
      state: "measured" | "no_limit" | "no_balance" | "credit_balance";
    } & Freshness
  >;
  aggregate: {
    balanceCents: Cents;
    limitCents: Cents;
    ratioBasisPoints: number | null;
    accountsIncluded: number;
    accountsExcluded: number;
  };
  /** Credit accounts left out entirely (they also count in accountsExcluded). */
  excludedAccounts: ExcludedAccount[];
  assumptions: AssumptionCode[];
}

export interface DataIssue {
  kind: "account" | "transaction" | "stream" | "period";
  id: string;
  reason:
    | "invalid_amount"
    | "invalid_date"
    | "missing_id"
    | "duplicate"
    | "invalid_period"
    | "invalid_account_id"
    | "invalid_fetched_at"
    | "invalid_balance_as_of"
    | "invalid_predicted_next_date"
    | "no_balance";
}

export interface FinancialSummary {
  engineVersion: "v1";
  currency: string;
  computedAt: IsoDateTime;
  cashFlow: CashFlowResult;
  recurring: RecurringResult;
  safeToSpend: SafeToSpendResult;
  creditUtilization: CreditUtilizationResult;
  dataIssues: DataIssue[];
}
