// =============================================================================
// The adapter's normalized read of Plaid, and credit utilization's result.
//
// The cash-flow figures themselves come from the engine package; these types
// describe what the adapter reads and what the app still computes itself.
//
// Money is integer cents throughout. Plaid's sign convention is kept on
// transactions: a positive amount is money leaving the account, a negative
// amount is money arriving.
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

// ---- output -----------------------------------------------------------------

/** The assumption codes credit utilization can report. */
export type AssumptionCode = "other_currency_accounts_excluded";

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
