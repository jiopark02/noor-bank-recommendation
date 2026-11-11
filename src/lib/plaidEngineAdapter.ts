// =============================================================================
// Plaid -> finance engine adapter. SERVER ONLY.
//
// The one place where Plaid's account, transaction and recurring-stream
// responses are read and turned into the engine's input. The routes that serve
// the dashboard and the money screen call this; the chat path does not.
//
// Server only: it decrypts stored access tokens and calls Plaid. Client code may
// import its TYPES (`import type`), never its values; a source probe in the test
// suite holds that line, since the `server-only` package is not installed.
//
// Rules this module keeps:
//   - Money is integer cents (toCents). A balance Plaid did not report stays
//     null; it is never read as 0.
//   - Account type is Plaid's own type, not the app's collapsed mapping.
//   - Every stored token is decrypted before any Plaid call. A decrypt failure
//     throws: it means the key is wrong or a row is corrupt, which is not a
//     per-connection condition and must not be reported as one.
//   - Each connection answers with a status. A connection that is not `ok`
//     contributes no data at all, so a half-read bank never looks complete.
//   - Logs carry status, error code and counts only: no item id, token,
//     amount or name.
// =============================================================================

import {
  PersonalFinanceCategoryVersion,
  type AccountBase,
  type AccountsGetRequest,
  type AccountsGetResponse,
  type Transaction,
  type TransactionStream,
  type TransactionsGetRequest,
  type TransactionsGetResponse,
  type TransactionsRecurringGetRequest,
  type TransactionsRecurringGetResponse,
} from "plaid";
import { plaidClient } from "@/lib/plaid";
import { decryptPlaidAccessToken } from "@/lib/plaidTokenCrypto";
import { getPlaidErrorCode } from "@/lib/plaidErrorRedaction";
import { toCents } from "@/lib/financeEngine";
import type {
  EngineAccount,
  EngineInput,
  EngineRecurringStream,
  EngineTransaction,
  FinancialSummary,
  RecurringFrequency,
  RecurringStatus,
} from "@/lib/financeEngine";

/** Days of transactions read, counting today. */
export const LOOKBACK_DAYS = 90;
/** Plaid's documented maximum for /transactions/get `count`. */
export const TRANSACTIONS_PAGE_SIZE = 500;
/** Pages read per connection before the window is reported as possibly truncated. */
export const MAX_TRANSACTION_PAGES = 10;
/** Per Plaid call. An unvalidated default. */
export const PLAID_CALL_TIMEOUT_MS = 10_000;
/** The single currency every figure is computed in. The app serves the US only. */
export const ENGINE_CURRENCY = "USD";

// ---- public shapes ------------------------------------------------------------

export type BankConnectionState = "ok" | "login_required" | "syncing" | "failed";

export interface BankConnectionStatus {
  itemId: string;
  institutionName: string | null;
  status: BankConnectionState;
}

export interface DisplayAccount {
  accountId: string;
  itemId: string;
  institutionName: string | null;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: EngineAccount["type"];
  subtype: string | null;
  currentCents: number | null;
  availableCents: number | null;
  limitCents: number | null;
  currency: string | null;
}

export interface DisplayTransaction {
  transactionId: string;
  accountId: string;
  /** Plaid sign: positive = outflow, negative = inflow. */
  amountCents: number;
  currency: string | null;
  date: string;
  pending: boolean;
  name: string;
  merchantName: string | null;
  logoUrl: string | null;
  /** Plaid's legacy category hierarchy, possibly empty. */
  category: string[];
  pfcPrimary: string | null;
  pfcDetailed: string | null;
}

export interface BankWindow {
  start: string;
  end: string;
}

export type BankCompleteness = EngineInput["period"]["completeness"];

/** Body of a successful POST /api/finance/summary. */
export interface FinanceSummaryResponse {
  success: true;
  connections: BankConnectionStatus[];
  accounts: DisplayAccount[];
  /** null when no connection could be read. */
  summary: FinancialSummary | null;
}

/** Body of a successful POST /api/plaid/transactions. */
export interface TransactionsListResponse {
  success: true;
  transactions: DisplayTransaction[];
  connections: BankConnectionStatus[];
  period: BankWindow & { completeness: BankCompleteness };
}

// ---- dependencies -------------------------------------------------------------

type CallOptions = { timeout: number };

/** The three Plaid calls, shaped like the SDK client so it can be passed as is. */
export interface PlaidReadCalls {
  accountsGet(
    request: AccountsGetRequest,
    options?: CallOptions
  ): Promise<{ data: AccountsGetResponse }>;
  transactionsGet(
    request: TransactionsGetRequest,
    options?: CallOptions
  ): Promise<{ data: TransactionsGetResponse }>;
  transactionsRecurringGet(
    request: TransactionsRecurringGetRequest,
    options?: CallOptions
  ): Promise<{ data: TransactionsRecurringGetResponse }>;
}

export interface BankAdapterDeps {
  plaid: PlaidReadCalls;
  /** Plaintext out, stored ciphertext in. Throws on any failure. */
  decrypt: (stored: string, userId: string) => string;
}

/** Production wiring. */
export function liveAdapterDeps(): BankAdapterDeps {
  return {
    plaid: plaidClient,
    decrypt: (stored, userId) => decryptPlaidAccessToken(stored, userId),
  };
}

/** The minimum a stored connection row must carry. */
export interface StoredConnectionRow {
  access_token: string;
  item_id: string;
  institution_name: string | null;
}

export interface BankReadRequest {
  accounts: boolean;
  transactions: boolean;
  recurring: boolean;
}

// ---- dates --------------------------------------------------------------------

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The UTC window ending today, LOOKBACK_DAYS long, inclusive on both ends. */
export function bankWindow(now: Date): BankWindow {
  const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    start: isoDay(endMs - (LOOKBACK_DAYS - 1) * 86_400_000),
    end: isoDay(endMs),
  };
}

// ---- mappers ------------------------------------------------------------------

function centsOrNull(dollars: number | null | undefined): number | null {
  return typeof dollars === "number" && isFinite(dollars) ? toCents(dollars) : null;
}

const ACCOUNT_TYPES: ReadonlyArray<EngineAccount["type"]> = [
  "depository",
  "credit",
  "loan",
  "investment",
  "brokerage",
  "other",
];

function accountType(raw: unknown): EngineAccount["type"] {
  for (let i = 0; i < ACCOUNT_TYPES.length; i++) {
    if (raw === ACCOUNT_TYPES[i]) return ACCOUNT_TYPES[i];
  }
  return "other";
}

/** An account as read: what the screens show plus what the engine needs. */
export interface ReadAccount extends DisplayAccount {
  balanceAsOf: string | null;
  fetchedAt: string;
}

export function mapAccount(
  account: AccountBase,
  connection: { itemId: string; institutionName: string | null },
  fetchedAt: string
): ReadAccount {
  const b = account.balances;
  return {
    accountId: account.account_id,
    itemId: connection.itemId,
    institutionName: connection.institutionName,
    name: account.name,
    officialName: account.official_name ?? null,
    mask: account.mask ?? null,
    type: accountType(account.type),
    subtype: account.subtype ?? null,
    currentCents: centsOrNull(b.current),
    availableCents: centsOrNull(b.available),
    limitCents: centsOrNull(b.limit),
    currency: b.iso_currency_code ?? null,
    balanceAsOf: b.last_updated_datetime ?? null,
    fetchedAt,
  };
}

export function mapTransaction(txn: Transaction): DisplayTransaction {
  const pfc = txn.personal_finance_category ?? null;
  return {
    transactionId: txn.transaction_id,
    accountId: txn.account_id,
    amountCents: toCents(txn.amount),
    currency: txn.iso_currency_code ?? null,
    date: txn.date,
    pending: txn.pending,
    name: txn.name,
    merchantName: txn.merchant_name ?? null,
    logoUrl: txn.logo_url ?? null,
    category: Array.isArray(txn.category) ? txn.category : [],
    pfcPrimary: pfc && pfc.primary ? pfc.primary : null,
    pfcDetailed: pfc && pfc.detailed ? pfc.detailed : null,
  };
}

const FREQUENCIES: ReadonlyArray<RecurringFrequency> = [
  "WEEKLY",
  "BIWEEKLY",
  "SEMI_MONTHLY",
  "MONTHLY",
  "ANNUALLY",
  "UNKNOWN",
];
const STATUSES: ReadonlyArray<RecurringStatus> = [
  "MATURE",
  "EARLY_DETECTION",
  "TOMBSTONED",
  "UNKNOWN",
];

function oneOf<T extends string>(raw: unknown, allowed: ReadonlyArray<T>): T | null {
  for (let i = 0; i < allowed.length; i++) {
    if (raw === allowed[i]) return allowed[i];
  }
  return null;
}

/** An outflow stream as Plaid reported it; nothing is normalized away. */
export function mapStream(stream: TransactionStream): EngineRecurringStream {
  const avg = stream.average_amount ?? {};
  const last = stream.last_amount ?? {};
  return {
    streamId: stream.stream_id,
    label: stream.merchant_name || stream.description || "Recurring charge",
    frequency: oneOf(stream.frequency, FREQUENCIES) ?? "UNKNOWN",
    averageAmountCents: centsOrNull(avg.amount),
    lastAmountCents: centsOrNull(last.amount),
    currency: avg.iso_currency_code ?? last.iso_currency_code ?? null,
    lastDate: stream.last_date ?? null,
    predictedNextDate: stream.predicted_next_date ?? null,
    isActive: stream.is_active === true,
    status: oneOf(stream.status, STATUSES) ?? "UNKNOWN",
  };
}

// ---- reading ------------------------------------------------------------------

function stateForError(error: unknown): { state: BankConnectionState; code: string } {
  const code = getPlaidErrorCode(error);
  if (code === "ITEM_LOGIN_REQUIRED" || code === "INVALID_ACCESS_TOKEN") {
    return { state: "login_required", code };
  }
  if (code === "PRODUCT_NOT_READY") return { state: "syncing", code };
  return { state: "failed", code: code ?? "none" };
}

interface ConnectionRead {
  status: BankConnectionStatus;
  accounts: ReadAccount[];
  transactions: DisplayTransaction[];
  /** null when the recurring call was not made or failed. */
  streams: EngineRecurringStream[] | null;
  truncated: boolean;
}

async function readConnection(
  index: number,
  row: StoredConnectionRow,
  accessToken: string,
  want: BankReadRequest,
  range: BankWindow,
  plaid: PlaidReadCalls
): Promise<ConnectionRead> {
  const itemId = row.item_id;
  const institutionName = row.institution_name ?? null;
  const options: CallOptions = { timeout: PLAID_CALL_TIMEOUT_MS };
  const accounts: ReadAccount[] = [];
  const transactions: DisplayTransaction[] = [];
  let pages = 0;
  let truncated = false;
  let pfcV2 = 0;
  let pfcOtherVersion = 0;

  try {
    if (want.accounts) {
      const response = await plaid.accountsGet({ access_token: accessToken }, options);
      const fetchedAt = new Date().toISOString();
      const list = response.data.accounts;
      for (let i = 0; i < list.length; i++) {
        accounts.push(mapAccount(list[i], { itemId, institutionName }, fetchedAt));
      }
    }

    if (want.transactions) {
      let offset = 0;
      for (;;) {
        if (pages >= MAX_TRANSACTION_PAGES) {
          truncated = true;
          break;
        }
        const response = await plaid.transactionsGet(
          {
            access_token: accessToken,
            start_date: range.start,
            end_date: range.end,
            options: {
              count: TRANSACTIONS_PAGE_SIZE,
              offset,
              include_personal_finance_category: true,
              personal_finance_category_version: PersonalFinanceCategoryVersion.V2,
            },
          },
          options
        );
        pages += 1;
        const page = response.data.transactions;
        for (let i = 0; i < page.length; i++) {
          const version = page[i].personal_finance_category?.version;
          if (version === PersonalFinanceCategoryVersion.V2) pfcV2 += 1;
          else pfcOtherVersion += 1;
          transactions.push(mapTransaction(page[i]));
        }
        offset += page.length;
        if (offset >= response.data.total_transactions) break;
        // More are reported but none arrived: stop rather than ask again.
        if (page.length === 0) {
          truncated = true;
          break;
        }
      }
    }
  } catch (error: unknown) {
    const { state, code } = stateForError(error);
    console.warn(
      `[bank-read] idx=${index} status=${state} code=${code} pages=${pages} ` +
        `truncated=false pfc_v2=0 pfc_other_version=0 recurring=skipped streams=0`
    );
    return {
      status: { itemId, institutionName, status: state },
      accounts: [],
      transactions: [],
      streams: null,
      truncated: false,
    };
  }

  let streams: EngineRecurringStream[] | null = null;
  let recurringCode = "none";
  if (want.recurring) {
    try {
      const response = await plaid.transactionsRecurringGet(
        {
          access_token: accessToken,
          options: {
            include_personal_finance_category: true,
            personal_finance_category_version: PersonalFinanceCategoryVersion.V2,
          },
        },
        options
      );
      const outflow = response.data.outflow_streams ?? [];
      streams = [];
      for (let i = 0; i < outflow.length; i++) streams.push(mapStream(outflow[i]));
    } catch (error: unknown) {
      recurringCode = getPlaidErrorCode(error) ?? "none";
      streams = null;
    }
  }

  const recurringLabel = !want.recurring ? "skipped" : streams === null ? "failed" : "ok";
  console.log(
    `[bank-read] idx=${index} status=ok code=${recurringCode} pages=${pages} ` +
      `truncated=${truncated} pfc_v2=${pfcV2} pfc_other_version=${pfcOtherVersion} ` +
      `recurring=${recurringLabel} streams=${streams === null ? 0 : streams.length}`
  );

  return {
    status: { itemId, institutionName, status: "ok" },
    accounts,
    transactions,
    streams,
    truncated,
  };
}

export interface BankRead {
  connections: BankConnectionStatus[];
  accounts: ReadAccount[];
  transactions: DisplayTransaction[];
  recurring: EngineInput["recurring"];
  completeness: BankCompleteness;
}

/**
 * Reads every given connection and merges the results.
 *
 * `rows` are the caller's own active connections, read with the verified
 * token's user id; `userId` is that same id, used unmodified as the decrypt
 * AAD. All tokens are decrypted before the first Plaid call, so a decrypt
 * failure throws with nothing sent.
 */
export async function readBankData(
  userId: string,
  rows: StoredConnectionRow[],
  want: BankReadRequest,
  range: BankWindow,
  deps: BankAdapterDeps
): Promise<BankRead> {
  const tokens: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    tokens.push(deps.decrypt(rows[i].access_token, userId));
  }

  const reads = await Promise.all(
    rows.map((row, i) => readConnection(i, row, tokens[i], want, range, deps.plaid))
  );

  const connections: BankConnectionStatus[] = [];
  const accounts: ReadAccount[] = [];
  const transactions: DisplayTransaction[] = [];
  const streams: EngineRecurringStream[] = [];
  const seenAccounts = new Set<string>();
  let allOk = true;
  let allRecurringOk = true;
  let anyTruncated = false;

  for (let i = 0; i < reads.length; i++) {
    const r = reads[i];
    connections.push(r.status);
    if (r.status.status !== "ok") allOk = false;
    if (r.truncated) anyTruncated = true;
    for (let j = 0; j < r.accounts.length; j++) {
      // Distinct Items normally yield distinct account ids; never emit one twice.
      if (seenAccounts.has(r.accounts[j].accountId)) continue;
      seenAccounts.add(r.accounts[j].accountId);
      accounts.push(r.accounts[j]);
    }
    for (let j = 0; j < r.transactions.length; j++) transactions.push(r.transactions[j]);
    if (r.streams === null) allRecurringOk = false;
    else for (let j = 0; j < r.streams.length; j++) streams.push(r.streams[j]);
  }

  // Recurring charges are known only when every bank answered and at least one
  // stream came back. An empty answer is treated as unknown, not as "none":
  // Plaid needs enough history to detect a stream, so empty does not prove absence.
  const recurring: EngineInput["recurring"] =
    want.recurring && allOk && allRecurringOk && streams.length > 0
      ? { source: "plaid_streams", streams }
      : { source: "unavailable" };

  const completeness: BankCompleteness = !allOk
    ? "unknown"
    : anyTruncated
      ? "possibly_truncated"
      : "complete";

  return { connections, accounts, transactions, recurring, completeness };
}

// ---- engine input and display -------------------------------------------------

export function toDisplayAccount(a: ReadAccount): DisplayAccount {
  return {
    accountId: a.accountId,
    itemId: a.itemId,
    institutionName: a.institutionName,
    name: a.name,
    officialName: a.officialName,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    currentCents: a.currentCents,
    availableCents: a.availableCents,
    limitCents: a.limitCents,
    currency: a.currency,
  };
}

function toEngineTransaction(t: DisplayTransaction): EngineTransaction {
  return {
    transactionId: t.transactionId,
    accountId: t.accountId,
    amountCents: t.amountCents,
    currency: t.currency,
    date: t.date,
    pending: t.pending,
    pfcPrimary: t.pfcPrimary,
    pfcDetailed: t.pfcDetailed,
    legacyCategory: t.category,
  };
}

/** Only the fields the engine reads: no names, masks or institution. */
export function toEngineInput(read: BankRead, nowIso: string, range: BankWindow): EngineInput {
  return {
    now: nowIso,
    currency: ENGINE_CURRENCY,
    accounts: read.accounts.map((a) => ({
      accountId: a.accountId,
      type: a.type,
      subtype: a.subtype,
      currentCents: a.currentCents,
      availableCents: a.availableCents,
      limitCents: a.limitCents,
      currency: a.currency,
      balanceAsOf: a.balanceAsOf,
      fetchedAt: a.fetchedAt,
    })),
    transactions: read.transactions.map(toEngineTransaction),
    period: { start: range.start, end: range.end, completeness: read.completeness },
    recurring: read.recurring,
  };
}
