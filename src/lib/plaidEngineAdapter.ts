// =============================================================================
// Plaid -> finance engine adapter. SERVER ONLY.
//
// The one place where Plaid's account, transaction and recurring-stream
// responses are read and turned into the engine's input. The summary route,
// which serves the dashboard and the money screen, calls this; the chat path
// does not.
//
// Server only: it decrypts stored access tokens and calls Plaid. Client code may
// import its TYPES (`import type`), never its values; a source probe in the test
// suite holds that line, since the `server-only` package is not installed.
//
// Rules this module keeps:
//   - Money is integer cents (toCents). A balance Plaid did not report stays
//     null; it is never read as 0.
//   - Account type is Plaid's own type, not the app's collapsed mapping.
//   - Every stored token is decrypted before any Plaid call. When every row
//     fails to decrypt, the read throws with nothing sent: that is the key's
//     fault, not any one connection's. When only some rows fail, each of
//     those connections is reported `failed` with no data and no Plaid call
//     is made with it; the others are read as usual. The log line for such a
//     row carries `cause=decrypt` and the crypto module's reason only.
//   - Each connection answers with a status. A connection that is not `ok`
//     contributes no data at all, so a half-read bank never looks complete.
//   - A recurring stream keeps the currency code Plaid sent with its amounts.
//     Only a stream that names none at all takes its account's currency, from
//     the accounts read on the same connection (see mapStream).
//   - Logs carry status, error code (or crypto reason) and counts only: no
//     item id, token, ciphertext, error message, amount or name.
//   - The keys handed to the engine (connection key, duplicate key) are
//     opaque: the duplicate key is a hash, so no name or mask reaches the
//     engine input. Neither key is part of any response.
//   - A transaction that cannot be used (isUsableTransaction) or repeats one
//     already kept is left out of the engine input and the screens' list
//     alike, and counted on its connection (invalidTransactions). One such
//     element never fails its connection.
// =============================================================================

import { createHash } from "crypto";
import {
  PersonalFinanceCategoryVersion,
  type AccountBase,
  type AccountsGetRequest,
  type AccountsGetResponse,
  type ItemGetRequest,
  type ItemGetResponse,
  type Transaction,
  type TransactionStream,
  type TransactionStreamAmount,
  type TransactionsGetRequest,
  type TransactionsGetResponse,
  type TransactionsRecurringGetRequest,
  type TransactionsRecurringGetResponse,
} from "plaid";
import { plaidClient } from "@/lib/plaid";
import {
  decryptPlaidAccessToken,
  isPlaidTokenCryptoError,
} from "@/lib/plaidTokenCrypto";
import { getPlaidErrorCode } from "@/lib/plaidErrorRedaction";
import {
  dayNumber,
  fromDayNumber,
  isCardPaymentCategory,
  isCents,
  isIsoDate,
  toCents,
} from "@/lib/financeEngine";
import type {
  Completeness,
  DateBasis,
  EngineAccount,
  EngineConnection,
  EngineInput,
  EngineRecurringStream,
  EngineTransaction,
  FinancialSummary,
  RecurringFrequency,
  RecurringStatus,
} from "@/lib/financeEngine";

/**
 * Days of transactions read, counting today: a full year plus the month
 * before it, inclusive on both ends. The cash flow the screens show covers a
 * shorter window inside it (DISPLAY_WINDOW_DAYS in bankSummaryView).
 */
export const READ_WINDOW_DAYS = 397;
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

export type BankCompleteness = Completeness;

/** Body of a successful POST /api/finance/summary. */
export interface FinanceSummaryResponse {
  success: true;
  connections: BankConnectionStatus[];
  accounts: DisplayAccount[];
  /**
   * The transactions dated inside the cash-flow period (the screens'
   * display window), from the same read as the figures. Present only when
   * the request's `includeTransactions` is exactly `true`; then empty when no
   * connection could be read.
   */
  transactions?: DisplayTransaction[];
  /** null when no connection could be read. */
  summary: FinancialSummary | null;
}

// ---- dependencies -------------------------------------------------------------

type CallOptions = { timeout: number };

/** The Plaid calls the adapter makes, shaped like the SDK client so it can be passed as is. */
export interface PlaidReadCalls {
  itemGet(request: ItemGetRequest, options?: CallOptions): Promise<{ data: ItemGetResponse }>;
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

/**
 * Which reads to make. `recurring` needs `accounts`: a stream that names no
 * currency takes its account's, from the accounts read on the same
 * connection, so readBankData refuses recurring without accounts.
 */
export interface BankReadRequest {
  accounts: boolean;
  transactions: boolean;
  recurring: boolean;
}

// ---- dates --------------------------------------------------------------------

/** What the request said about the user's calendar, as far as it could be used. */
export interface UserToday {
  today: string;
  dateBasis: DateBasis;
}

// Characters an IANA zone name (or Etc/GMT±n) can contain. Anything else is
// refused before the platform sees it.
const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/;
const TIME_ZONE_MAX_LENGTH = 64;

function utcToday(now: Date): UserToday {
  return { today: now.toISOString().slice(0, 10), dateBasis: "utc" };
}

/**
 * The user's calendar date at `now`, from a time zone the client sent.
 *
 * The value must be a string of 1 to 64 characters from TIME_ZONE_PATTERN that
 * the platform accepts as a time zone (Intl.DateTimeFormat throws a
 * RangeError otherwise). It is not compared against Intl.supportedValuesOf:
 * that list names one spelling per zone and differs between ICU versions, so
 * valid aliases would be refused. An accepted value is normalized through
 * resolvedOptions(), and the date is taken in the normalized zone.
 *
 * Anything else falls back to the UTC date with dateBasis "utc". The value is
 * never returned, logged or stored.
 */
export function resolveToday(raw: unknown, now: Date): UserToday {
  if (
    typeof raw !== "string" ||
    raw.length < 1 ||
    raw.length > TIME_ZONE_MAX_LENGTH ||
    !TIME_ZONE_PATTERN.test(raw)
  ) {
    return utcToday(now);
  }
  try {
    const zone = new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    let year = "";
    let month = "";
    let day = "";
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === "year") year = parts[i].value;
      else if (parts[i].type === "month") month = parts[i].value;
      else if (parts[i].type === "day") day = parts[i].value;
    }
    const today = `${year}-${month}-${day}`;
    if (!isIsoDate(today)) return utcToday(now);
    return { today, dateBasis: "user_time_zone" };
  } catch {
    return utcToday(now);
  }
}

/**
 * The `days`-long window ending on `today`, inclusive on both ends. Throws on
 * an invalid date or length (caller bug).
 */
export function bankWindow(today: string, days: number): BankWindow {
  const end = dayNumber(today);
  if (end === null) throw new Error("bankWindow: invalid today");
  if (!(Number.isSafeInteger(days) && days >= 1)) throw new Error("bankWindow: invalid days");
  return { start: fromDayNumber(end - (days - 1)), end: today };
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
  duplicateKey: string | null;
  connectionKey: string;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A string as sent (empty included becomes null), anything else null. */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A string as sent, or null for anything that is not a string. */
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * An opaque key two connections share for what looks like the same bank
 * account: a hash of the institution's name, the account type and subtype,
 * the last four digits and the account name. null when any of them is
 * missing, so an account is never matched on part of its description.
 */
export function duplicateKeyOf(
  account: AccountBase,
  institutionName: string | null
): string | null {
  const parts: unknown[] = [
    institutionName,
    account.type,
    account.subtype,
    account.mask,
    account.name,
  ];
  for (let i = 0; i < parts.length; i++) {
    if (!nonEmpty(parts[i])) return null;
  }
  return createHash("sha256")
    .update(JSON.stringify(["v2"].concat(parts as string[])))
    .digest("hex");
}

/** The connection key handed to the engine: its position in this request only. */
export function connectionKeyOf(index: number): string {
  return "c" + index;
}

export function mapAccount(
  account: AccountBase,
  connection: { itemId: string; institutionName: string | null; connectionKey: string },
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
    subtype: stringOrNull(account.subtype),
    currentCents: centsOrNull(b.current),
    availableCents: centsOrNull(b.available),
    limitCents: centsOrNull(b.limit),
    currency: stringOrNull(b.iso_currency_code),
    balanceAsOf: b.last_updated_datetime ?? null,
    fetchedAt,
    duplicateKey: duplicateKeyOf(account, connection.institutionName),
    connectionKey: connection.connectionKey,
  };
}

/** A transaction as read: what the screens show plus what only the engine needs. */
export interface ReadTransaction extends DisplayTransaction {
  merchantEntityId: string | null;
}

/**
 * Whether one element of a /transactions/get page can be used at all. It
 * cannot when it is not an object, or when any of these fails, checked in
 * this order:
 *   - transaction_id is a non-empty string;
 *   - account_id is a non-empty string;
 *   - amount is a number (null and numeric strings are not), and its value in
 *     cents is a safe integer (NaN and Infinity are not);
 *   - date is a calendar date (isIsoDate, the engine's own rule);
 *   - pending is a boolean.
 * The SDK's types promise all of these, so every well-formed answer passes.
 */
export function isUsableTransaction(raw: unknown): raw is Transaction {
  if (typeof raw !== "object" || raw === null) return false;
  const t = raw as Record<string, unknown>;
  if (typeof t.transaction_id !== "string" || t.transaction_id === "") return false;
  if (typeof t.account_id !== "string" || t.account_id === "") return false;
  if (typeof t.amount !== "number") return false;
  if (!isCents(toCents(t.amount))) return false;
  if (typeof t.date !== "string" || !isIsoDate(t.date)) return false;
  if (typeof t.pending !== "boolean") return false;
  return true;
}

/** Maps a transaction that passed isUsableTransaction. */
export function mapTransaction(txn: Transaction): ReadTransaction {
  const pfc = txn.personal_finance_category ?? null;
  return {
    transactionId: txn.transaction_id,
    accountId: txn.account_id,
    amountCents: toCents(txn.amount),
    currency: stringOrNull(txn.iso_currency_code),
    date: txn.date,
    pending: txn.pending,
    name: txn.name,
    merchantName: txn.merchant_name ?? null,
    logoUrl: txn.logo_url ?? null,
    category: stringsOnly(txn.category),
    pfcPrimary: pfc ? textOrNull(pfc.primary) : null,
    pfcDetailed: pfc ? textOrNull(pfc.detailed) : null,
    merchantEntityId: nonEmpty(txn.merchant_entity_id) ? txn.merchant_entity_id : null,
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

/**
 * How a stream's amounts name their currency. The first of average_amount and
 * last_amount that carries any code decides:
 *   usd        an ISO code equal to ENGINE_CURRENCY, exactly as sent
 *   other_iso  any other ISO code, including a differently cased "usd"
 *   unofficial an unofficial (non-ISO) code
 *   none       neither amount carries a code of either kind
 */
export type StreamCurrencyShape = "usd" | "other_iso" | "unofficial" | "none";

export const STREAM_CURRENCY_SHAPES: ReadonlyArray<StreamCurrencyShape> = [
  "usd",
  "other_iso",
  "unofficial",
  "none",
];

function isSent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

type AmountCode = { kind: "iso"; code: unknown } | { kind: "unofficial" } | { kind: "none" };

function amountCode(amount: TransactionStreamAmount | null | undefined): AmountCode {
  if (!amount) return { kind: "none" };
  if (isSent(amount.iso_currency_code)) return { kind: "iso", code: amount.iso_currency_code };
  if (isSent(amount.unofficial_currency_code)) return { kind: "unofficial" };
  return { kind: "none" };
}

/** The stream's currency shape and the ISO code it names, if it names one. */
export function streamCurrency(stream: TransactionStream): {
  shape: StreamCurrencyShape;
  iso: string | null;
} {
  let code = amountCode(stream.average_amount);
  if (code.kind === "none") code = amountCode(stream.last_amount);
  if (code.kind === "iso") {
    const iso = typeof code.code === "string" ? code.code : null;
    return { shape: iso === ENGINE_CURRENCY ? "usd" : "other_iso", iso };
  }
  return { shape: code.kind, iso: null };
}

type ShapeCounts = Record<StreamCurrencyShape, number>;

function emptyShapeCounts(): ShapeCounts {
  return { usd: 0, other_iso: 0, unofficial: 0, none: 0 };
}

/** `usd:N,other_iso:N,unofficial:N,none:N` — counts only. */
function formatShapeCounts(counts: ShapeCounts): string {
  const parts: string[] = [];
  for (let i = 0; i < STREAM_CURRENCY_SHAPES.length; i++) {
    parts.push(`${STREAM_CURRENCY_SHAPES[i]}:${counts[STREAM_CURRENCY_SHAPES[i]]}`);
  }
  return parts.join(",");
}

function stringsOnly(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] === "string") out.push(value[i]);
  }
  return out;
}

/**
 * A stream (outflow or inflow) as Plaid reported it. One gap is filled: when neither
 * amount names a currency of any kind, the stream takes the currency of its
 * own account (`account_id`) from `accountCurrencies`, the accounts read on
 * the same connection; with no such account, or an account without an ISO
 * code, it stays null. A code Plaid did send is kept as sent, so an
 * unofficial or unexpected code still keeps the stream out of the totals.
 */
export function mapStream(
  stream: TransactionStream,
  accountCurrencies: ReadonlyMap<string, string | null>
): EngineRecurringStream {
  const avg = stream.average_amount ?? {};
  const last = stream.last_amount ?? {};
  const { shape, iso } = streamCurrency(stream);
  const pfc = stream.personal_finance_category ?? null;
  return {
    // Checked, not repaired, by the engine contract below (streamFieldFault).
    streamId: stream.stream_id,
    label: textOrNull(stream.merchant_name) ?? textOrNull(stream.description) ?? "Recurring charge",
    frequency: oneOf(stream.frequency, FREQUENCIES) ?? "UNKNOWN",
    averageAmountCents: centsOrNull(avg.amount),
    lastAmountCents: centsOrNull(last.amount),
    currency: shape === "none" ? accountCurrencies.get(stream.account_id) ?? null : iso,
    lastDate: stream.last_date ?? null,
    predictedNextDate: stream.predicted_next_date ?? null,
    isActive: stream.is_active === true,
    status: oneOf(stream.status, STATUSES) ?? "UNKNOWN",
    accountId: nonEmpty(stream.account_id) ? stream.account_id : null,
    pfcPrimary: pfc ? textOrNull(pfc.primary) : null,
    pfcDetailed: pfc ? textOrNull(pfc.detailed) : null,
    legacyCategory: stringsOnly(stream.category),
    transactionIds: stringsOnly(stream.transaction_ids),
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
  engine: EngineConnection;
  accounts: ReadAccount[];
  transactions: ReadTransaction[];
  /** Elements isUsableTransaction refused; 0 when the connection was not read. */
  invalidTransactions: number;
  streams: EngineRecurringStream[];
  incomeStreams: EngineRecurringStream[];
}

type ItemStatusRead =
  | { state: "skipped" }
  | { state: "ok"; lastSuccessfulUpdate: string | null }
  | { state: "failed"; code: string };

/**
 * The Item's last successful transactions update, from /item/get. Started
 * alongside the other reads and never rejects: a failure, including one
 * thrown before the call is made, is an answer of its own and does not
 * change the connection's status.
 */
function readItemStatus(
  plaid: PlaidReadCalls,
  accessToken: string,
  options: CallOptions
): Promise<ItemStatusRead> {
  return Promise.resolve()
    .then(() => plaid.itemGet({ access_token: accessToken }, options))
    .then((response): ItemStatusRead => {
      const last = response.data.status?.transactions?.last_successful_update;
      return { state: "ok", lastSuccessfulUpdate: nonEmpty(last) ? last : null };
    })
    .catch((error: unknown): ItemStatusRead => ({
      state: "failed",
      code: getPlaidErrorCode(error) ?? "none",
    }));
}

function itemLogFields(item: ItemStatusRead): string {
  const lastUpdate =
    item.state === "ok" && item.lastSuccessfulUpdate !== null ? "present" : "absent";
  const code = item.state === "failed" ? ` item_code=${item.code}` : "";
  return `item=${item.state}${code} last_update=${lastUpdate}`;
}

/** The earliest valid date among the transactions, or null. */
function earliestDate(transactions: ReadTransaction[]): string | null {
  let earliest: string | null = null;
  for (let i = 0; i < transactions.length; i++) {
    const d = transactions[i].date;
    if (isIsoDate(d) && (earliest === null || d < earliest)) earliest = d;
  }
  return earliest;
}

/**
 * The observed history length: days from the earliest transaction received
 * to the end of the read window (today), inclusive of both ends, or "none"
 * when no transaction arrived.
 */
function historyDays(earliest: string | null, range: BankWindow): string {
  const from = earliest === null ? null : dayNumber(earliest);
  const to = dayNumber(range.end);
  return from === null || to === null ? "none" : String(to - from + 1);
}

function hasCategory(stream: TransactionStream): boolean {
  return !!stream.personal_finance_category;
}

/** Where card-payment streams sit, by the type of the account they name. */
type CardPaymentCounts = { depository: number; credit: number; other: number; none: number };

function emptyCardPaymentCounts(): CardPaymentCounts {
  return { depository: 0, credit: 0, other: 0, none: 0 };
}

function countCardPayment(
  counts: CardPaymentCounts,
  stream: EngineRecurringStream,
  accountTypes: ReadonlyMap<string, EngineAccount["type"]>
): void {
  if (!isCardPaymentCategory(stream)) return;
  const type = stream.accountId === null ? undefined : accountTypes.get(stream.accountId);
  if (type === undefined) counts.none += 1;
  else if (type === "depository") counts.depository += 1;
  else if (type === "credit") counts.credit += 1;
  else counts.other += 1;
}

/** `depository:N,credit:N,other:N,none:N` — counts only. */
function formatCardPaymentCounts(c: CardPaymentCounts): string {
  return `depository:${c.depository},credit:${c.credit},other:${c.other},none:${c.none}`;
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
  const connectionKey = connectionKeyOf(index);
  const options: CallOptions = { timeout: PLAID_CALL_TIMEOUT_MS };
  const accounts: ReadAccount[] = [];
  const transactions: ReadTransaction[] = [];
  let invalidTransactions = 0;
  let pages = 0;
  let truncated = false;
  let pfcV2 = 0;
  let pfcOtherVersion = 0;
  // Read with the accounts: the Item's status belongs to the connection, and
  // a read that skips accounts has no use for it.
  const itemStatus: Promise<ItemStatusRead> = want.accounts
    ? readItemStatus(plaid, accessToken, options)
    : Promise.resolve({ state: "skipped" });

  try {
    if (want.accounts) {
      const response = await plaid.accountsGet({ access_token: accessToken }, options);
      const fetchedAt = new Date().toISOString();
      const list = response.data.accounts;
      for (let i = 0; i < list.length; i++) {
        // An account with no id cannot be told apart from another one, and a
        // card left out would understate what is owed: the whole read fails
        // rather than continue without it.
        const raw: unknown = list[i];
        if (
          typeof raw !== "object" ||
          raw === null ||
          !nonEmpty((raw as Record<string, unknown>).account_id) ||
          typeof (raw as Record<string, unknown>).balances !== "object" ||
          (raw as Record<string, unknown>).balances === null
        ) {
          throw new Error("account without a usable id or balances");
        }
        accounts.push(
          mapAccount(list[i], { itemId, institutionName, connectionKey }, fetchedAt)
        );
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
          // Checked before any field is read, so an element that is not a
          // transaction is counted rather than failing the connection.
          const raw: unknown = page[i];
          if (!isUsableTransaction(raw)) {
            invalidTransactions += 1;
            continue;
          }
          const version = raw.personal_finance_category?.version;
          if (version === PersonalFinanceCategoryVersion.V2) pfcV2 += 1;
          else pfcOtherVersion += 1;
          transactions.push(mapTransaction(raw));
        }
        // Every element Plaid sent, kept or not: the offset follows its count.
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
    const item = await itemStatus;
    console.warn(
      `[bank-read] idx=${index} status=${state} code=${code} pages=${pages} ` +
        `truncated=false pfc_v2=0 pfc_other_version=0 recurring=skipped streams=0 ` +
        `stream_ccy=${formatShapeCounts(emptyShapeCounts())} ` +
        `${itemLogFields(item)} inflow_streams=0 stream_pfc=0 history_days=none ` +
        `card_pay_out=${formatCardPaymentCounts(emptyCardPaymentCounts())} ` +
        `card_pay_in=${formatCardPaymentCounts(emptyCardPaymentCounts())}`
    );
    return {
      status: { itemId, institutionName, status: state },
      engine: {
        connectionKey,
        state,
        lastSuccessfulUpdate: item.state === "ok" ? item.lastSuccessfulUpdate : null,
        recurringRead: null,
        transactionsTruncated: false,
        earliestTransactionDate: null,
      },
      accounts: [],
      transactions: [],
      invalidTransactions: 0,
      streams: [],
      incomeStreams: [],
    };
  }

  // null when the recurring call was not made or failed.
  let streams: EngineRecurringStream[] | null = null;
  let incomeStreams: EngineRecurringStream[] = [];
  let streamsWithCategory = 0;
  let cardPayOut = emptyCardPaymentCounts();
  let cardPayIn = emptyCardPaymentCounts();
  let recurringCode = "none";
  const shapeCounts = emptyShapeCounts();
  if (want.recurring) {
    // Only this connection's accounts: a stream belongs to an account of its own Item.
    const accountCurrencies = new Map<string, string | null>();
    const accountTypes = new Map<string, EngineAccount["type"]>();
    for (let i = 0; i < accounts.length; i++) {
      if (!accountCurrencies.has(accounts[i].accountId)) {
        accountCurrencies.set(accounts[i].accountId, accounts[i].currency);
        accountTypes.set(accounts[i].accountId, accounts[i].type);
      }
    }
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
      const inflow = response.data.inflow_streams ?? [];
      const mapped: EngineRecurringStream[] = [];
      const mappedIncome: EngineRecurringStream[] = [];
      const counted = emptyShapeCounts();
      const outCounts = emptyCardPaymentCounts();
      const inCounts = emptyCardPaymentCounts();
      let withCategory = 0;
      for (let i = 0; i < outflow.length; i++) {
        counted[streamCurrency(outflow[i]).shape] += 1;
        if (hasCategory(outflow[i])) withCategory += 1;
        const s = mapStream(outflow[i], accountCurrencies);
        countCardPayment(outCounts, s, accountTypes);
        mapped.push(s);
      }
      for (let i = 0; i < inflow.length; i++) {
        if (hasCategory(inflow[i])) withCategory += 1;
        const s = mapStream(inflow[i], accountCurrencies);
        countCardPayment(inCounts, s, accountTypes);
        mappedIncome.push(s);
      }
      // Committed only once every stream mapped, so a failure part-way through
      // reports no streams and no counts rather than some of each.
      streams = mapped;
      incomeStreams = mappedIncome;
      streamsWithCategory = withCategory;
      cardPayOut = outCounts;
      cardPayIn = inCounts;
      for (let i = 0; i < STREAM_CURRENCY_SHAPES.length; i++) {
        shapeCounts[STREAM_CURRENCY_SHAPES[i]] = counted[STREAM_CURRENCY_SHAPES[i]];
      }
    } catch (error: unknown) {
      recurringCode = getPlaidErrorCode(error) ?? "none";
      streams = null;
      incomeStreams = [];
      streamsWithCategory = 0;
      cardPayOut = emptyCardPaymentCounts();
      cardPayIn = emptyCardPaymentCounts();
    }
  }

  const recurringRead: EngineConnection["recurringRead"] = !want.recurring
    ? null
    : streams === null
      ? "failed"
      : streams.length === 0
        ? "empty"
        : "ok";
  // After the usability check, before the duplicate check in readBankData,
  // which sets the engine's earliest date again from what it keeps. The log's
  // history_days uses this one.
  const earliest = earliestDate(transactions);
  const item = await itemStatus;
  const recurringLabel = !want.recurring ? "skipped" : streams === null ? "failed" : "ok";
  console.log(
    `[bank-read] idx=${index} status=ok code=${recurringCode} pages=${pages} ` +
      `truncated=${truncated} pfc_v2=${pfcV2} pfc_other_version=${pfcOtherVersion} ` +
      `recurring=${recurringLabel} streams=${streams === null ? 0 : streams.length} ` +
      `stream_ccy=${formatShapeCounts(shapeCounts)} ` +
      `${itemLogFields(item)} inflow_streams=${incomeStreams.length} ` +
      `stream_pfc=${streamsWithCategory} history_days=${historyDays(earliest, range)} ` +
      `card_pay_out=${formatCardPaymentCounts(cardPayOut)} ` +
      `card_pay_in=${formatCardPaymentCounts(cardPayIn)}`
  );

  return {
    status: { itemId, institutionName, status: "ok" },
    engine: {
      connectionKey,
      state: "ok",
      lastSuccessfulUpdate: item.state === "ok" ? item.lastSuccessfulUpdate : null,
      recurringRead,
      transactionsTruncated: truncated,
      earliestTransactionDate: earliest,
    },
    accounts,
    transactions,
    invalidTransactions,
    streams: streams === null ? [] : streams,
    incomeStreams,
  };
}

/**
 * The crypto module's reason for a failed decrypt, for the log line only.
 * Never the error's message, which is not ours to vouch for, and never any
 * part of the stored value.
 */
function decryptFailureReason(error: unknown): string {
  return isPlaidTokenCryptoError(error) ? error.reason : "unknown";
}

/**
 * The answer for a connection whose stored token would not decrypt: failed,
 * with no data. No Plaid call is made for it.
 */
function decryptFailedRead(
  index: number,
  row: StoredConnectionRow,
  reason: string
): ConnectionRead {
  const itemId = row.item_id;
  const institutionName = row.institution_name ?? null;
  console.error(`[bank-read] idx=${index} status=failed cause=decrypt reason=${reason}`);
  return {
    status: { itemId, institutionName, status: "failed" },
    engine: {
      connectionKey: connectionKeyOf(index),
      state: "failed",
      lastSuccessfulUpdate: null,
      recurringRead: null,
      transactionsTruncated: false,
      earliestTransactionDate: null,
    },
    accounts: [],
    transactions: [],
    invalidTransactions: 0,
    streams: [],
    incomeStreams: [],
  };
}

type DecryptedToken = { ok: true; token: string } | { ok: false; error: unknown };

// ---- engine contract ----------------------------------------------------------
//
// The engine refuses a whole request when one value breaks its input contract.
// Values Plaid sent that would break it are dealt with here, before the call,
// so one odd value never fails every figure. What happens depends on what the
// value is for. Nothing that is owed (an outflow stream, a card) is dropped:
// dropping it would understate what is owed and overstate what can be spent.
//
//   account balanceAsOf not a valid instant     -> null, counted
//   account amount not a safe integer of cents  -> null, counted
//   cash (depository) account whose available
//   amount was nulled above                     -> its current amount null too,
//                                                  counted
//   connection lastSuccessfulUpdate not valid   -> null, counted
//   outflow stream lastDate / predictedNextDate -> null, counted
//   outflow stream amount not a safe integer,
//   or any stream id empty or not a string      -> that connection's recurring
//                                                  read is "failed"
//   income stream date or amount not valid      -> recurring read "failed"
//   one stream id on two streams (every connection's outflow and income lists
//   together): identical copies keep the first, counted in the log only;
//   copies that differ, or that sit in both lists -> every connection holding
//   one has its recurring read "failed"
//
// A connection whose recurring read is "failed" sends no streams at all: the
// engine checks every stream it is given, used or not. Transactions are
// filtered earlier (isUsableTransaction, invalidTransactions). The counts go
// to the log only, never into the engine input.

/** A calendar date the engine accepts: YYYY-MM-DD, a real day, 2000-01-01 to 9998-12-31. */
export function isEngineDate(value: unknown): value is string {
  return typeof value === "string" && isIsoDate(value);
}

// The engine's instant: seconds required, a fraction of any length, and a
// zone of "Z" or ±hh:mm.
const ENGINE_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** An instant the engine accepts. Its date part follows isEngineDate. */
export function isEngineInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ENGINE_INSTANT.exec(value);
  if (!m || !isIsoDate(m[1])) return false;
  if (Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59) return false;
  if (m[6] !== "Z" && (Number(m[6].slice(1, 3)) > 23 || Number(m[6].slice(4, 6)) > 59)) {
    return false;
  }
  return true;
}

function nullableCents(value: number | null): number | null {
  return value === null || isCents(value) ? value : null;
}

/** What the contract changed on one connection. Counts only. */
export interface ContractCounts {
  balanceAsOfNulled: number;
  amountsNulled: number;
  streamDatesNulled: number;
  lastUpdateNulled: number;
  identicalStreamsDropped: number;
  /** Why the recurring read was set to "failed" here, or "none". */
  recurringFailed: "none" | "stream_field" | "stream_id_conflict";
}

/** One connection's share of a read, before or after the contract. */
export interface ContractConnection {
  engine: EngineConnection;
  accounts: ReadAccount[];
  streams: EngineRecurringStream[];
  incomeStreams: EngineRecurringStream[];
}

function emptyCounts(): ContractCounts {
  return {
    balanceAsOfNulled: 0,
    amountsNulled: 0,
    streamDatesNulled: 0,
    lastUpdateNulled: 0,
    identicalStreamsDropped: 0,
    recurringFailed: "none",
  };
}

/** Whether a stream's own fields fail it outright (see the table above). */
function streamFieldFault(s: EngineRecurringStream, income: boolean): boolean {
  if (typeof s.streamId !== "string" || s.streamId === "") return true;
  if (!(s.averageAmountCents === null || isCents(s.averageAmountCents))) return true;
  if (!(s.lastAmountCents === null || isCents(s.lastAmountCents))) return true;
  if (income) {
    if (!(s.lastDate === null || isEngineDate(s.lastDate))) return true;
    if (!(s.predictedNextDate === null || isEngineDate(s.predictedNextDate))) return true;
  }
  return false;
}

/** The same JSON whatever order an object's keys were written in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonicalJson(record[k]))
        .join(",")
    ) + "}";
  }
  return JSON.stringify(value);
}

function recurringWasAnswered(c: EngineConnection): boolean {
  return c.recurringRead === "ok" || c.recurringRead === "empty";
}

/**
 * Applies the engine contract to every connection of one read, in connection
 * order. Pure: the input is not changed.
 */
export function applyEngineContract(connections: ContractConnection[]): {
  connections: ContractConnection[];
  counts: ContractCounts[];
} {
  const counts = connections.map(() => emptyCounts());
  const failed = connections.map(() => false);

  // ---- fields of each connection, account and outflow stream
  const fixed: ContractConnection[] = connections.map((c, i) => {
    const n = counts[i];
    let lastSuccessfulUpdate = c.engine.lastSuccessfulUpdate;
    if (lastSuccessfulUpdate !== null && !isEngineInstant(lastSuccessfulUpdate)) {
      lastSuccessfulUpdate = null;
      n.lastUpdateNulled += 1;
    }
    const accounts = c.accounts.map((a) => {
      let balanceAsOf = a.balanceAsOf;
      if (balanceAsOf !== null && !isEngineInstant(balanceAsOf)) {
        balanceAsOf = null;
        n.balanceAsOfNulled += 1;
      }
      const availableCents = nullableCents(a.availableCents);
      // A cash account whose available balance was dropped must not fall back
      // to its current balance, which leaves out pending withdrawals and can
      // be higher: both go null, so the engine treats the balance as unknown.
      const cashAvailableDropped =
        a.type === "depository" && a.availableCents !== null && availableCents === null;
      const currentCents = cashAvailableDropped ? null : nullableCents(a.currentCents);
      const limitCents = nullableCents(a.limitCents);
      n.amountsNulled +=
        Number(currentCents !== a.currentCents) +
        Number(availableCents !== a.availableCents) +
        Number(limitCents !== a.limitCents);
      return { ...a, balanceAsOf, currentCents, availableCents, limitCents };
    });
    const streams = c.streams.map((s) => {
      let lastDate = s.lastDate;
      let predictedNextDate = s.predictedNextDate;
      if (lastDate !== null && !isEngineDate(lastDate)) {
        lastDate = null;
        n.streamDatesNulled += 1;
      }
      if (predictedNextDate !== null && !isEngineDate(predictedNextDate)) {
        predictedNextDate = null;
        n.streamDatesNulled += 1;
      }
      return { ...s, lastDate, predictedNextDate };
    });
    if (
      recurringWasAnswered(c.engine) &&
      (streams.some((s) => streamFieldFault(s, false)) ||
        c.incomeStreams.some((s) => streamFieldFault(s, true)))
    ) {
      failed[i] = true;
      n.recurringFailed = "stream_field";
    }
    return {
      engine: { ...c.engine, lastSuccessfulUpdate },
      accounts,
      streams,
      incomeStreams: c.incomeStreams.slice(),
    };
  });

  // ---- one stream id on two streams, across every connection still sending
  // streams. Failing a connection only removes copies, so it never turns an
  // id that agreed into one that conflicts: one pass is enough.
  type Copy = { at: number; income: boolean; key: string };
  const copiesById = new Map<string, Copy[]>();
  for (let i = 0; i < fixed.length; i++) {
    if (failed[i]) continue;
    const lists: Array<[EngineRecurringStream[], boolean]> = [
      [fixed[i].streams, false],
      [fixed[i].incomeStreams, true],
    ];
    for (const [list, income] of lists) {
      for (let j = 0; j < list.length; j++) {
        const copy = { at: i, income, key: canonicalJson(list[j]) };
        const known = copiesById.get(list[j].streamId);
        if (known) known.push(copy);
        else copiesById.set(list[j].streamId, [copy]);
      }
    }
  }
  copiesById.forEach((copies) => {
    if (copies.length < 2) return;
    const conflict = copies.some((c) => c.key !== copies[0].key || c.income !== copies[0].income);
    if (!conflict) return;
    for (let k = 0; k < copies.length; k++) {
      failed[copies[k].at] = true;
      counts[copies[k].at].recurringFailed = "stream_id_conflict";
    }
  });

  // ---- identical copies: the first, in connection order, is kept. Decided
  // after every failure above, so a copy is never dropped in favour of one on
  // a connection that then sends no streams.
  const kept = new Set<string>();
  const out: ContractConnection[] = fixed.map((c, i) => {
    if (failed[i]) {
      return {
        engine: { ...c.engine, recurringRead: "failed" },
        accounts: c.accounts,
        streams: [],
        incomeStreams: [],
      };
    }
    const keepFirst = (list: EngineRecurringStream[]) =>
      list.filter((s) => {
        if (kept.has(s.streamId)) {
          counts[i].identicalStreamsDropped += 1;
          return false;
        }
        kept.add(s.streamId);
        return true;
      });
    const streams = keepFirst(c.streams);
    const incomeStreams = keepFirst(c.incomeStreams);
    return { engine: c.engine, accounts: c.accounts, streams, incomeStreams };
  });

  return { connections: out, counts };
}

/**
 * Every connection's answer, merged. Whether the figures are complete, and
 * whether recurring charges are known, is not decided here: the engine
 * decides both from `engineConnections`.
 */
export interface BankRead {
  /** Per connection, for the screens: which bank, and whether it was read. */
  connections: BankConnectionStatus[];
  /** Per connection, for the engine, in the same order. */
  engineConnections: EngineConnection[];
  accounts: ReadAccount[];
  transactions: ReadTransaction[];
  streams: EngineRecurringStream[];
  incomeStreams: EngineRecurringStream[];
}

/**
 * Reads every given connection and merges the results.
 *
 * `rows` are the caller's own active connections, read with the verified
 * token's user id; `userId` is that same id, used unmodified as the decrypt
 * AAD. All tokens are decrypted before the first Plaid call.
 *
 * When every row fails to decrypt, this throws the first row's error with
 * nothing sent: a fault shared by every row is the key's, and must not be
 * reported as each bank failing. When only some rows fail, each of those
 * connections is answered `failed` with no data, no Plaid call is made with
 * it, and the remaining connections are read as usual.
 */
export async function readBankData(
  userId: string,
  rows: StoredConnectionRow[],
  want: BankReadRequest,
  range: BankWindow,
  deps: BankAdapterDeps
): Promise<BankRead> {
  // Checked before any token is decrypted or any call made.
  if (want.recurring && !want.accounts) {
    throw new Error("readBankData: recurring needs accounts");
  }

  const tokens: DecryptedToken[] = [];
  let decryptFailures = 0;
  let firstDecryptError: unknown = null;
  for (let i = 0; i < rows.length; i++) {
    try {
      tokens.push({ ok: true, token: deps.decrypt(rows[i].access_token, userId) });
    } catch (error: unknown) {
      if (decryptFailures === 0) firstDecryptError = error;
      decryptFailures += 1;
      tokens.push({ ok: false, error });
    }
  }
  if (decryptFailures > 0 && decryptFailures === rows.length) {
    throw firstDecryptError;
  }

  const reads = await Promise.all(
    rows.map((row, i) => {
      const t = tokens[i];
      return t.ok
        ? readConnection(i, row, t.token, want, range, deps.plaid)
        : Promise.resolve(decryptFailedRead(i, row, decryptFailureReason(t.error)));
    })
  );

  const connections: BankConnectionStatus[] = [];
  const engineConnections: EngineConnection[] = [];
  const accounts: ReadAccount[] = [];
  const transactions: ReadTransaction[] = [];
  const streams: EngineRecurringStream[] = [];
  const incomeStreams: EngineRecurringStream[] = [];
  const seenAccounts = new Set<string>();
  // transaction id -> the account of the copy kept. A Map, so an id such as
  // "constructor" is not read as already seen.
  const keptTransactions = new Map<string, string>();

  const contract = applyEngineContract(
    reads.map((r) => ({
      engine: r.engine,
      accounts: r.accounts,
      streams: r.streams,
      incomeStreams: r.incomeStreams,
    }))
  );

  // In connection order, so which copy is kept never depends on which bank
  // answered first.
  for (let i = 0; i < reads.length; i++) {
    const r = reads[i];
    const c = contract.connections[i];
    connections.push(r.status);
    for (let j = 0; j < c.accounts.length; j++) {
      // Distinct Items normally yield distinct account ids; never emit one twice.
      if (seenAccounts.has(c.accounts[j].accountId)) continue;
      seenAccounts.add(c.accounts[j].accountId);
      accounts.push(c.accounts[j]);
    }
    // The first copy of a transaction id is kept. A later copy on the same
    // account is a duplicate; one on another account is invalid, since an id
    // names a single transaction.
    let duplicate = 0;
    let invalid = r.invalidTransactions;
    const kept: ReadTransaction[] = [];
    for (let j = 0; j < r.transactions.length; j++) {
      const t = r.transactions[j];
      const keptAccount = keptTransactions.get(t.transactionId);
      if (keptAccount === undefined) {
        keptTransactions.set(t.transactionId, t.accountId);
        kept.push(t);
        transactions.push(t);
      } else if (keptAccount === t.accountId) {
        duplicate += 1;
      } else {
        invalid += 1;
      }
    }
    engineConnections.push({
      ...c.engine,
      earliestTransactionDate: earliestDate(kept),
      invalidTransactions: { duplicate, invalid },
    });
    if (duplicate > 0 || invalid > 0) {
      // Counts only: no id, amount or account.
      console.log(`[bank-filter] idx=${i} invalid=${invalid} duplicate=${duplicate}`);
    }
    // One line per connection, zeros included, so how often each case
    // happens can be read from the log. Counts only.
    const n = contract.counts[i];
    console.log(
      `[bank-contract] idx=${i} invalid_txn=${invalid} duplicate_txn=${duplicate} ` +
        `balance_as_of_nulled=${n.balanceAsOfNulled} amounts_nulled=${n.amountsNulled} ` +
        `stream_dates_nulled=${n.streamDatesNulled} last_update_nulled=${n.lastUpdateNulled} ` +
        `identical_streams_dropped=${n.identicalStreamsDropped} recurring_failed=${n.recurringFailed}`
    );
    for (let j = 0; j < c.streams.length; j++) streams.push(c.streams[j]);
    for (let j = 0; j < c.incomeStreams.length; j++) incomeStreams.push(c.incomeStreams[j]);
  }

  return { connections, engineConnections, accounts, transactions, streams, incomeStreams };
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

/** A transaction as the screens receive it: no field only the engine reads. */
export function toDisplayTransaction(t: ReadTransaction): DisplayTransaction {
  return {
    transactionId: t.transactionId,
    accountId: t.accountId,
    amountCents: t.amountCents,
    currency: t.currency,
    date: t.date,
    pending: t.pending,
    name: t.name,
    merchantName: t.merchantName,
    logoUrl: t.logoUrl,
    category: t.category,
    pfcPrimary: t.pfcPrimary,
    pfcDetailed: t.pfcDetailed,
  };
}

/**
 * The read's transactions dated inside `window` (inclusive), as the screens
 * receive them, in the order they were read. `read.transactions` already
 * holds only the transactions the engine is given (usable, one copy per
 * transaction id), so the list and the figures leave out the same ones and
 * no two rows share an account and transaction id. The date check below is
 * kept as a guard.
 */
export function displayTransactions(read: BankRead, window: BankWindow): DisplayTransaction[] {
  const out: DisplayTransaction[] = [];
  for (let i = 0; i < read.transactions.length; i++) {
    const t = read.transactions[i];
    if (!isIsoDate(t.date)) continue;
    if (t.date < window.start || t.date > window.end) continue;
    out.push(toDisplayTransaction(t));
  }
  return out;
}

function toEngineTransaction(t: ReadTransaction): EngineTransaction {
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
    merchantEntityId: t.merchantEntityId,
  };
}

/** The request-wide dates an engine input is built from, all from one `today`. */
export interface EngineInputDates {
  nowIso: string;
  today: string;
  dateBasis: DateBasis;
  /** The window the transactions were read over. */
  readWindow: BankWindow;
  /** The cash-flow period, inside readWindow. */
  period: BankWindow;
}

/** Only the fields the engine reads: no names, masks or institution. */
export function toEngineInput(read: BankRead, dates: EngineInputDates): EngineInput {
  return {
    now: dates.nowIso,
    today: dates.today,
    dateBasis: dates.dateBasis,
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
      duplicateKey: a.duplicateKey,
      connectionKey: a.connectionKey,
    })),
    transactions: read.transactions.map(toEngineTransaction),
    readWindow: { start: dates.readWindow.start, end: dates.readWindow.end },
    period: { start: dates.period.start, end: dates.period.end },
    connections: read.engineConnections.map((c) => ({ ...c })),
    recurring: { streams: read.streams, incomeStreams: read.incomeStreams },
  };
}
