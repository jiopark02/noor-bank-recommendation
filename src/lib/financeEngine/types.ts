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
/** Calendar date, `YYYY-MM-DD`, year 2000 or later. */
export type IsoDate = string;
/**
 * ISO 8601 date-time string with an explicit zone ("Z" or ±hh:mm), at or after
 * 2000-01-01T00:00:00Z. A zone-less or earlier date-time is invalid: `now`
 * throws, any other field is reported in `dataIssues` and treated as null.
 */
export type IsoDateTime = string;

// ---- input ------------------------------------------------------------------

export interface EngineAccount {
  accountId: string;
  /** Plaid's account type, not the app's collapsed mapping. */
  type: "depository" | "credit" | "loan" | "investment" | "brokerage" | "other";
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
  /**
   * Opaque key shared by two accounts that look like the same bank account
   * reached through two connections; null when the source lacked any part
   * of it. Never in the output.
   */
  duplicateKey: string | null;
  /** Opaque key of the connection the account was read through. Never in the output. */
  connectionKey: string;
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
  /** Plaid's merchant identifier, when it has one. */
  merchantEntityId: string | null;
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
  /**
   * Cents per occurrence, with Plaid's sign: outflow streams report positive
   * amounts, inflow (income) streams negative ones.
   */
  averageAmountCents: Cents | null;
  lastAmountCents: Cents | null;
  currency: string | null;
  lastDate: IsoDate | null;
  predictedNextDate: IsoDate | null;
  isActive: boolean;
  status: RecurringStatus;
  /** The account the stream charges or pays into, when the source names one. */
  accountId: string | null;
  /** Plaid personal_finance_category of the stream, treated as opaque. */
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  /** Plaid legacy category hierarchy. May be empty. */
  legacyCategory: string[];
  /** The transactions Plaid grouped into the stream. May be empty. */
  transactionIds: string[];
}

export type ConnectionState = "ok" | "login_required" | "syncing" | "failed";

/** One bank connection as the caller read it. */
export interface EngineConnection {
  /** Opaque key, matching EngineAccount.connectionKey. Never in the output. */
  connectionKey: string;
  /** "ok" means every account and transaction call succeeded. */
  state: ConnectionState;
  /** The institution's last successful transactions update, when known. */
  lastSuccessfulUpdate: IsoDateTime | null;
  /**
   * The recurring-charges read, apart from the state:
   *   ok     - outflow streams came back
   *   empty  - the call answered with no outflow streams
   *   failed - the call failed
   *   null   - not attempted, because the connection was not read
   */
  recurringRead: "ok" | "empty" | "failed" | null;
  /** The transaction pages stopped before the reported total. */
  transactionsTruncated: boolean;
  /**
   * The earliest transaction date received on this connection, as a measure
   * of how much history the institution has sent; null when none arrived.
   */
  earliestTransactionDate: IsoDate | null;
  /**
   * Transactions the caller received on this connection but left out of
   * `transactions`: `duplicate` repeats a transaction already kept for the
   * same account, `invalid` could not be used at all. Optional; a missing or
   * malformed count is read as 0. The cash flow adds both to its `invalid`
   * exclusion count.
   */
  invalidTransactions?: { duplicate: number; invalid: number };
}

/**
 * Which calendar `today` was taken in: the user's own time zone, or UTC when
 * the caller had no usable time zone for the user.
 */
export type DateBasis = "user_time_zone" | "utc";

export interface EngineInput {
  /** The current time, injected by the caller. Used for freshness only. */
  now: IsoDateTime;
  /**
   * The user's calendar date, decided once by the caller. Every date the
   * engine works out (the month-end horizon, the grace window, past-due
   * charges) counts from this date, never from `now`.
   */
  today: IsoDate;
  dateBasis: DateBasis;
  /** The single currency every figure is computed in. Nothing is converted. */
  currency: string;
  accounts: EngineAccount[];
  /** Transactions over `readWindow`; the cash flow counts only `period`. */
  transactions: EngineTransaction[];
  /**
   * The window the caller fetched transactions for, inclusive on both ends.
   * It ends on `today`.
   */
  readWindow: { start: IsoDate; end: IsoDate };
  /** The cash-flow period, inclusive on both ends, inside `readWindow`. */
  period: { start: IsoDate; end: IsoDate };
  /**
   * Every connection the caller tried to read. Completeness, whether
   * recurring charges are known, and whether safe-to-spend may be shown are
   * decided from these.
   */
  connections: EngineConnection[];
  recurring: {
    /** Outflow streams of every connection that answered. */
    streams: EngineRecurringStream[];
    /** Inflow (income) streams of every connection that answered. */
    incomeStreams: EngineRecurringStream[];
  };
}

export type Completeness = "complete" | "possibly_truncated" | "unknown";

/** The adjustable parts of the safe-to-spend definition. Echoed in the output. */
export interface EnginePolicy {
  /** Depository subtypes whose balance counts as spendable cash. */
  spendableSubtypes: string[];
  /** Whether positive credit-card balances are subtracted in full. */
  reserveCreditCardBalances: boolean;
  bufferCents: Cents;
  /**
   * How many days back a recurring charge whose expected date has passed, and
   * which the stream has not recorded, still counts as an obligation. Integer,
   * 0 or more; 0 counts none. Above 7 a weekly stream can contribute more than
   * one past-due charge.
   */
  pastDueGraceDays: number;
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
  | "recurring_due_today_may_already_be_pending"
  | "recurring_past_due_assumed_unposted"
  /**
   * A past-due charge on a card whose balance is reserved in full is still
   * subtracted, but it may already sit in that balance, and so count twice.
   */
  | "recurring_past_due_on_card_may_be_in_balance"
  /**
   * A recurring card payment is subtracted while card balances are reserved
   * in full, so the same money may count twice. It comes from a cash
   * account, an account not found, or a card whose balance is not reserved.
   * The charges are marked `cardPayment` in `inputs.upcomingRecurring`.
   */
  | "card_payment_recurring_counted";

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
    /** Same as FinancialSummary.coverage.completeness. */
    completeness: Completeness;
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
    /** Borrowed money arriving (PFC LOAN_DISBURSEMENTS), either sign. */
    loanDisbursements: Bucket;
    /** PFC OTHER, either sign; each one is also listed in dataIssues. */
    unclassifiedCategory: Bucket;
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
  | "other_currency"
  /**
   * A card payment charged to a card whose balance safe-to-spend reserves in
   * full: the reserve already covers it.
   */
  | "card_payment_in_card_balance";

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
    /** nextDate is before today: the expected charge has not been recorded yet. */
    pastDue: boolean;
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
  /** From `today` through the end of its calendar month, in `dateBasis`. */
  horizon: { from: IsoDate; to: IsoDate; rule: "end_of_calendar_month"; dateBasis: DateBasis };
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
      /** dueDate is before today: counted inside the grace window, not yet recorded. */
      pastDue: boolean;
      /** The stream is a credit-card payment (see the card-payment assumption). */
      cardPayment: boolean;
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
    | "no_balance"
    /** A counted transaction whose category is Plaid's catch-all; left out of every total. */
    | "unclassified_category";
}

/** What the connections let the figures claim. */
export interface CoverageResult {
  /**
   *   complete           - every connection was read and no page limit was hit
   *   possibly_truncated - every connection was read, but one hit the page limit
   *   unknown            - a connection was not read
   */
  completeness: Completeness;
  /** At least one connection, and every one was read. */
  allConnectionsRead: boolean;
  /**
   * Safe-to-spend may be shown: every connection was read (a bank that was
   * not may hold a card balance the figure would miss) and it was computed.
   */
  safeToSpendShowable: boolean;
  /**
   * Copies of the same bank account reached through more than one
   * connection, left out of every figure, with their transactions and
   * recurring streams (outflow and income).
   */
  duplicateCopiesDropped: { accounts: number; transactions: number; streams: number };
}

export interface FinancialSummary {
  engineVersion: "v1";
  currency: string;
  computedAt: IsoDateTime;
  coverage: CoverageResult;
  cashFlow: CashFlowResult;
  recurring: RecurringResult;
  safeToSpend: SafeToSpendResult;
  creditUtilization: CreditUtilizationResult;
  dataIssues: DataIssue[];
}
