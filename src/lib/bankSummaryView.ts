// =============================================================================
// What the dashboard and the money screen may show from a finance summary.
//
// Pure and client-safe: it imports types only. Both screens decide through
// here, so the rules below are executed by tests rather than read from page
// source:
//   - A figure is shown only for a summary that arrived in this load; while
//     loading, or after a failed load, no dollar amount is drawn.
//   - Safe-to-spend is shown only when the engine says it may be: every bank
//     connection was read (a bank that could not be read may hold a card
//     balance the number would miss) and the figure was computed.
//   - Each connection that was not read gets one action: re-link for a login
//     problem, wait while Plaid is still importing, retry otherwise.
//   - Unknown recurring charges render as "Unknown", never as $0.00.
//   - Figures or a transaction list over a period that may be incomplete
//     carry one line saying so.
//   - A response body missing a field the screens read is a failed read.
//   - The transaction list is checked apart from the figures: a missing or
//     wrong-shaped list fails the list only, never the figures, and is never
//     drawn as an empty list.
// Data issues in the summary (for example, transactions in Plaid's catch-all
// category) are information about the figures, not a connection problem: they
// create no action and do not hide safe-to-spend.
// =============================================================================

import type {
  BankCompleteness,
  BankConnectionStatus,
  DisplayTransaction,
  FinanceSummaryResponse,
} from "./plaidEngineAdapter";

/**
 *   ready       - a summary for a connected bank arrived; show its numbers.
 *   none        - no active connection; zeros are true.
 *   unavailable - the load failed, or no bank could be read; numbers unknown.
 *   loading     - connected, no answer yet.
 */
export type MoneyDisplayState = "ready" | "none" | "unavailable" | "loading";

export type SummaryFetchState = "idle" | "loading" | "loaded" | "failed";

export interface BankAction {
  kind: "relink" | "wait" | "retry";
  itemId: string;
  institutionName: string;
}

export interface BankView {
  figures: MoneyDisplayState;
  showSafeToSpend: boolean;
  actions: BankAction[];
  /**
   * Names of the banks the shown figures leave out, one per connection that
   * was not read, in response order (duplicates kept once). Empty unless the
   * figures are ready.
   */
  missingFrom: string[];
}

export const UNNAMED_BANK = "Your bank";

/**
 * Days of income and spending the screens show, counting today. The summary
 * route computes the cash flow over exactly this window, so the label the
 * screens draw and the figures under it cannot disagree.
 */
export const DISPLAY_WINDOW_DAYS = 90;

/** The heading over the figures and the list that cover DISPLAY_WINDOW_DAYS. */
export const DISPLAY_WINDOW_LABEL = `Last ${DISPLAY_WINDOW_DAYS} days`;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date (YYYY-MM-DD) as "Nov 1", exactly as given. It is read and
 * formatted on the UTC axis: read as local time, a date west of UTC would
 * show as the day before. Anything that is not such a date is returned as is.
 */
export function formatCalendarDay(isoDate: string): string {
  if (!CALENDAR_DATE.test(isoDate)) return isoDate;
  const date = new Date(isoDate + "T00:00:00Z");
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Tells a screen whether an answer belongs to its latest request. A screen
 * calls begin() when it starts a load and draws an answer only while
 * isCurrent(token) holds, so an earlier request that answers late can never
 * cover a later one.
 */
export interface RequestGate {
  begin(): number;
  isCurrent(token: number): boolean;
}

export function createRequestGate(): RequestGate {
  let latest = 0;
  return {
    begin: () => {
      latest += 1;
      return latest;
    },
    isCurrent: (token) => token === latest,
  };
}

/**
 * The browser's IANA time zone, sent with the summary request so the server
 * can count dates in the user's calendar. null when the browser does not say;
 * the server then falls back to UTC.
 */
export function browserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone !== "" ? zone : null;
  } catch {
    return null;
  }
}

function actionFor(c: BankConnectionStatus): BankAction | null {
  const institutionName = c.institutionName || UNNAMED_BANK;
  switch (c.status) {
    case "ok":
      return null;
    case "login_required":
      return { kind: "relink", itemId: c.itemId, institutionName };
    case "syncing":
      return { kind: "wait", itemId: c.itemId, institutionName };
    default:
      return { kind: "retry", itemId: c.itemId, institutionName };
  }
}

/** The routes' wording for "no active connection"; the screens match on it. */
const NO_ACTIVE_CONNECTION = /no active bank connection/i;

export function isNoActiveConnectionMessage(message: string | null): boolean {
  return message !== null && NO_ACTIVE_CONNECTION.test(message);
}

/**
 * decideBankView's inputs for a screen that learns about connections from its
 * own connection list and loads the summary separately:
 *   - while the connection list is still loading, the screen is loading (it
 *     must not show "no connection" zeros yet);
 *   - a failed connection list or a failed summary load is a failed load;
 *   - the summary route's "no active connection" answer means none, not failed.
 */
export function summaryLoadInputs(input: {
  connectionsLoading: boolean;
  connectionsFailed: boolean;
  hasActiveConnection: boolean;
  loadError: string | null;
  hasData: boolean;
}): { hasActiveConnection: boolean; fetchState: SummaryFetchState } {
  if (input.connectionsFailed) {
    return { hasActiveConnection: true, fetchState: "failed" };
  }
  if (input.connectionsLoading) {
    return { hasActiveConnection: true, fetchState: "loading" };
  }
  if (isNoActiveConnectionMessage(input.loadError)) {
    return { hasActiveConnection: false, fetchState: "idle" };
  }
  return {
    hasActiveConnection: input.hasActiveConnection,
    fetchState: input.loadError !== null ? "failed" : input.hasData ? "loaded" : "loading",
  };
}

/**
 * Names of the connections that were not read, in order, each name once
 * (unnamed banks share UNNAMED_BANK).
 */
export function banksNotRead(connections: BankConnectionStatus[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < connections.length; i++) {
    if (connections[i].status === "ok") continue;
    const name = connections[i].institutionName || UNNAMED_BANK;
    if (names.indexOf(name) < 0) names.push(name);
  }
  return names;
}

export function decideBankView(input: {
  hasActiveConnection: boolean;
  fetchState: SummaryFetchState;
  response: ScreenSummaryResponse | null;
}): BankView {
  const nothing: BankView = {
    figures: "loading",
    showSafeToSpend: false,
    actions: [],
    missingFrom: [],
  };

  if (input.fetchState === "failed") return { ...nothing, figures: "unavailable" };
  if (!input.hasActiveConnection) return { ...nothing, figures: "none" };
  if (input.fetchState !== "loaded" || input.response === null) return nothing;

  const actions: BankAction[] = [];
  const connections = input.response.connections;
  for (let i = 0; i < connections.length; i++) {
    const action = actionFor(connections[i]);
    if (action) actions.push(action);
  }

  const summary = input.response.summary;
  if (summary === null) {
    return { figures: "unavailable", showSafeToSpend: false, actions, missingFrom: [] };
  }

  // Whether safe-to-spend may be shown is the engine's decision, made from
  // the same connections; the screen only follows it.
  return {
    figures: "ready",
    showSafeToSpend: summary.coverage.safeToSpendShowable,
    actions,
    missingFrom: banksNotRead(connections),
  };
}

/**
 * What the user owes on credit accounts, from the engine's per-account credit
 * entries: every credit account in the summary currency, with or without a
 * limit, whatever the safe-to-spend policy says about reserving card balances.
 * A credit balance (money owed to the user) counts as 0, as in the engine's
 * own aggregate. null when any such account reported no balance: an unknown
 * card balance is not read as 0.
 */
export function creditUsedCents(summary: ScreenSummary): number | null {
  const entries = summary.creditUtilization.accounts;
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const cents = entries[i].balanceCents;
    if (cents === null) return null;
    total += Math.max(0, cents);
  }
  return total;
}

/**
 * A credit account's utilization as a whole percent, from the engine's own
 * ratio. null when the engine could not measure it (no limit, no balance,
 * another currency) — the screen draws no bar then.
 */
export function utilizationPercent(summary: ScreenSummary, accountId: string): number | null {
  const entries = summary.creditUtilization.accounts;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].accountId !== accountId) continue;
    const bp = entries[i].ratioBasisPoints;
    return bp === null ? null : Math.round(bp / 100);
  }
  return null;
}

/** One line naming the banks the figures leave out, or null when none are. */
export function missingBanksNote(missingFrom: string[]): string | null {
  if (missingFrom.length === 0) return null;
  if (missingFrom.length === 1) return `Doesn't include ${missingFrom[0]}`;
  const head = missingFrom.slice(0, -1).join(", ");
  return `Doesn't include ${head} or ${missingFrom[missingFrom.length - 1]}`;
}

/**
 * One line for transactions over a period that may be incomplete: a bank
 * whose transactions were cut off at the page limit, or a bank that was not
 * read. It does not say which, because the period alone does not tell. null
 * for a complete period, and for no period at all.
 */
export function incompletePeriodNote(completeness: BankCompleteness | null): string | null {
  if (completeness === null || completeness === "complete") return null;
  return "May not include every transaction from this period.";
}

/** The incomplete-period line for the shown figures; null unless they are ready. */
export function summaryPeriodNote(
  view: BankView,
  response: ScreenSummaryResponse | null
): string | null {
  if (view.figures !== "ready" || response === null || response.summary === null) return null;
  return incompletePeriodNote(response.summary.cashFlow.period.completeness);
}

/** What to tell the user about one connection that was not read. */
export function describeBankAction(action: BankAction): string {
  switch (action.kind) {
    case "relink":
      return `${action.institutionName} needs you to sign in again.`;
    case "wait":
      return `${action.institutionName} is still importing your transactions. Check back shortly.`;
    default:
      return `We couldn't reach ${action.institutionName} just now. Try again in a moment.`;
  }
}

export interface BankActionLine {
  action: BankAction;
  /** Shown under this line only: the re-link request for this bank failed. */
  relinkError: string | null;
}

/**
 * The action lines to draw, with a failed re-link request attached to the
 * line of the bank it was for. A failed re-link request is about that bank
 * only: every line stays, including that bank's re-link line (so it can be
 * tried again), and it does not touch the figures — it is never an input to
 * summaryLoadInputs or decideBankView.
 */
export function bankActionLines(
  actions: BankAction[],
  relinkFailedItemId: string | null
): BankActionLine[] {
  return actions.map((action) => ({
    action,
    relinkError:
      action.kind === "relink" && action.itemId === relinkFailedItemId
        ? `We couldn't start re-linking ${action.institutionName}. Please try again in a moment.`
        : null,
  }));
}

// ---- response shape -----------------------------------------------------------

//
// The fields the two screens and this module read from each response body are
// listed once, below. The same list gives both the check a 2xx body must pass
// and the type the screens receive, so:
//   - a body missing a listed field, or carrying it with the wrong type, is a
//     failed read (null), never something drawn as $NaN or a crash;
//   - a field the screens read that is not listed is a type error, because
//     the screens only ever see the listed type;
//   - fields that are not listed may be present and are ignored.
// RouteBodiesSatisfyScreenFields fails to compile when a listed field
// disagrees with what the routes declare they send.

type FieldLeaf = "string" | "number" | "boolean" | "string|null" | "number|null";

/**
 * A field list. `oneOf`, `listOf` and `orNull` are reserved words of this
 * notation, so no response field may be listed under one of those names.
 */
export type FieldSpec =
  | FieldLeaf
  | { readonly oneOf: readonly string[] }
  | { readonly listOf: FieldSpec }
  | { readonly orNull: FieldSpec }
  | { readonly [field: string]: FieldSpec };

/** The type a field list describes. */
export type FieldsOf<S> = S extends "string"
  ? string
  : S extends "number"
    ? number
    : S extends "boolean"
      ? boolean
      : S extends "string|null"
        ? string | null
        : S extends "number|null"
          ? number | null
          : S extends { readonly oneOf: readonly (infer U)[] }
            ? U
            : S extends { readonly listOf: infer E }
              ? FieldsOf<E>[]
              : S extends { readonly orNull: infer E }
                ? FieldsOf<E> | null
                : { -readonly [K in keyof S]: FieldsOf<S[K]> };

const CONNECTION_FIELDS = {
  itemId: "string",
  institutionName: "string|null",
  status: { oneOf: ["ok", "login_required", "syncing", "failed"] },
} as const;

const COMPLETENESS = { oneOf: ["complete", "possibly_truncated", "unknown"] } as const;

const TRANSACTION_FIELDS = {
  transactionId: "string",
  accountId: "string",
  amountCents: "number",
  date: "string",
  pending: "boolean",
  name: "string",
  merchantName: "string|null",
  category: { listOf: "string" },
} as const;

/** What the dashboard, the money screen and this module read from a summary body. */
export const SUMMARY_RESPONSE_FIELDS = {
  connections: { listOf: CONNECTION_FIELDS },
  accounts: {
    listOf: {
      accountId: "string",
      type: "string",
      name: "string",
      institutionName: "string|null",
      mask: "string|null",
      currentCents: "number|null",
      availableCents: "number|null",
      limitCents: "number|null",
    },
  },
  summary: {
    orNull: {
      coverage: { safeToSpendShowable: "boolean" },
      cashFlow: {
        incomeCents: "number",
        spendingNetCents: "number",
        period: { completeness: COMPLETENESS },
      },
      safeToSpend: {
        status: { oneOf: ["computed", "unavailable"] },
        reason: "string|null",
        amountCents: "number|null",
        uncoveredObligationsCents: "number|null",
        // Both are null when the figure could not be computed.
        horizon: {
          orNull: {
            to: "string",
            rule: { oneOf: ["next_income_date", "end_of_calendar_month"] },
          },
        },
        totals: {
          orNull: {
            spendableCashCents: "number",
            upcomingRecurringCents: "number",
            reservedCreditCents: "number",
            bufferCents: "number",
          },
        },
        assumptions: { listOf: "string" },
      },
      recurring: {
        totalMonthlyCents: "number|null",
        items: {
          listOf: {
            streamId: "string",
            label: "string",
            // null when the charge's amount or frequency is not known.
            monthlyCents: "number|null",
            nextDate: "string|null",
            pastDue: "boolean",
          },
        },
      },
      creditUtilization: {
        accounts: {
          listOf: {
            accountId: "string",
            balanceCents: "number|null",
            ratioBasisPoints: "number|null",
          },
        },
      },
    },
  },
} as const;

/**
 * The money screen's transaction list, the `transactions` field of a summary
 * body. Checked apart from SUMMARY_RESPONSE_FIELDS: the route sends it only
 * to a request that asks for it, and a bad list must not fail the figures.
 */
export const SUMMARY_TRANSACTIONS_FIELDS = { listOf: TRANSACTION_FIELDS } as const;

export type ScreenSummaryResponse = FieldsOf<typeof SUMMARY_RESPONSE_FIELDS>;
export type ScreenSummary = NonNullable<ScreenSummaryResponse["summary"]>;
export type ScreenTransaction = FieldsOf<typeof TRANSACTION_FIELDS>;

type Holds<T extends true> = T;
/** Compile-time only: what the route declares it sends has every listed field. */
export type RouteBodiesSatisfyScreenFields = Holds<
  [FinanceSummaryResponse] extends [ScreenSummaryResponse] ? true : false
>;
/** Compile-time only: each transaction the route sends has every listed field. */
export type RouteTransactionsSatisfyScreenFields = Holds<
  [DisplayTransaction] extends [ScreenTransaction] ? true : false
>;

/** True only for `any`. */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * True when no part of T, at any depth, is `any`. RouteBodiesSatisfyScreenFields
 * holds trivially for a field typed `any`, so this guard keeps the route's
 * declared body free of it: a body typed from an untyped source fails to
 * compile here instead of passing every check above.
 */
export type NoAnyDeep<T> =
  IsAny<T> extends true
    ? false
    : T extends readonly (infer E)[]
      ? NoAnyDeep<E>
      : T extends object
        ? false extends { [K in keyof T]-?: NoAnyDeep<T[K]> }[keyof T]
          ? false
          : true
        : true;

/** Compile-time only: no part of the summary body the route declares is `any`. */
export type RouteBodyHasNoAny = Holds<NoAnyDeep<FinanceSummaryResponse>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && isFinite(value);
}

/** Whether a value has every field a list names, each with its listed type. */
export function fitsFields(spec: FieldSpec, value: unknown): boolean {
  if (typeof spec === "string") {
    switch (spec) {
      case "string":
        return typeof value === "string";
      case "number":
        return isFiniteNumber(value);
      case "boolean":
        return typeof value === "boolean";
      case "string|null":
        return value === null || typeof value === "string";
      case "number|null":
        return value === null || isFiniteNumber(value);
    }
    return false;
  }
  const node = spec as {
    oneOf?: readonly string[];
    listOf?: FieldSpec;
    orNull?: FieldSpec;
  };
  if (node.oneOf !== undefined) {
    return typeof value === "string" && node.oneOf.indexOf(value) >= 0;
  }
  if (node.listOf !== undefined) {
    const element = node.listOf;
    return Array.isArray(value) && value.every((v) => fitsFields(element, v));
  }
  if (node.orNull !== undefined) {
    return value === null || fitsFields(node.orNull, value);
  }
  if (!isRecord(value)) return false;
  const fields = spec as { readonly [field: string]: FieldSpec };
  return Object.keys(fields).every((key) => fitsFields(fields[key], value[key]));
}

/** The outcome of pickFields: the copy, or a value that did not fit the list. */
export type Picked = { ok: true; value: unknown } | { ok: false };

/**
 * A copy of `value` holding only the fields `spec` lists, each checked as
 * fitsFields checks it. Fields the list does not name are left out at every
 * depth, so whatever else a source carries never travels further. A value
 * that does not fit the list gives `{ ok: false }`.
 */
export function pickFields(spec: FieldSpec, value: unknown): Picked {
  if (typeof spec === "string" || (spec as { oneOf?: unknown }).oneOf !== undefined) {
    return fitsFields(spec, value) ? { ok: true, value } : { ok: false };
  }
  const node = spec as { listOf?: FieldSpec; orNull?: FieldSpec };
  if (node.listOf !== undefined) {
    if (!Array.isArray(value)) return { ok: false };
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const element = pickFields(node.listOf, value[i]);
      if (!element.ok) return { ok: false };
      out.push(element.value);
    }
    return { ok: true, value: out };
  }
  if (node.orNull !== undefined) {
    return value === null ? { ok: true, value: null } : pickFields(node.orNull, value);
  }
  if (!isRecord(value)) return { ok: false };
  const fields = spec as { readonly [field: string]: FieldSpec };
  const out: Record<string, unknown> = {};
  const keys = Object.keys(fields);
  for (let i = 0; i < keys.length; i++) {
    const field = pickFields(fields[keys[i]], value[keys[i]]);
    if (!field.ok) return { ok: false };
    out[keys[i]] = field.value;
  }
  return { ok: true, value: out };
}

/**
 * A summary response body, or null when it lacks a field the screens read or
 * carries one with the wrong type. A wrong-shaped 2xx is a failed read, never
 * an empty one: read as empty it would show $0.00 as if it were the user's
 * real figure.
 */
export function parseFinanceSummaryResponse(value: unknown): ScreenSummaryResponse | null {
  return fitsFields(SUMMARY_RESPONSE_FIELDS, value) ? (value as ScreenSummaryResponse) : null;
}

/**
 * The transaction list of a summary body, or null when the body carries none
 * or carries one with a missing or wrongly typed field. null is never an
 * empty list: the screen says the list could not be loaded instead.
 */
export function parseSummaryTransactions(body: unknown): ScreenTransaction[] | null {
  if (!isRecord(body)) return null;
  const list = body.transactions;
  return fitsFields(SUMMARY_TRANSACTIONS_FIELDS, list) ? (list as ScreenTransaction[]) : null;
}

/** Shown in place of the transaction list when the list could not be read. */
export const TRANSACTIONS_UNAVAILABLE = "We couldn't load your transactions just now.";

/**
 *   rows        - draw these rows (possibly none)
 *   unavailable - the figures are shown but the list could not be read; say so
 *   hidden      - the figures are not shown, so neither is any row
 */
export type TransactionListView =
  | { kind: "rows"; rows: ScreenTransaction[] }
  | { kind: "unavailable" }
  | { kind: "hidden" };

/**
 * What the list area shows. It follows the figures (no rows unless they are
 * ready) and never feeds back into them: a list that could not be read
 * changes this area only.
 */
export function transactionListView(
  view: BankView,
  list: ScreenTransaction[] | null
): TransactionListView {
  if (view.figures !== "ready") return { kind: "hidden" };
  if (list === null) return { kind: "unavailable" };
  return { kind: "rows", rows: list };
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

/** Integer cents as US dollars. */
export function formatCents(cents: number): string {
  return USD.format(cents / 100);
}

/**
 * Net spending with its sign decided once, from the value: money out (0 or
 * more) reads "-$X", and net money back (refunds above spending) reads "+$X".
 * Never two signs.
 */
export function formatSpending(cents: number): string {
  return cents >= 0 ? `-${formatCents(cents)}` : `+${formatCents(-cents)}`;
}

/** A balance that may be missing: null renders as a dash, never as $0.00. */
export function formatCentsOrDash(cents: number | null): string {
  return cents === null ? "—" : formatCents(cents);
}

/** Monthly recurring total: null (unknown) renders as "Unknown", never as $0.00. */
export function formatMonthlyOrUnknown(cents: number | null): string {
  return cents === null ? "Unknown" : formatCents(cents);
}

// ---- spendable cash and safe-to-spend -----------------------------------------

/**
 *   amount          - the spendable cash safe-to-spend was computed from
 *   no_cash_account - no checking-type account is linked
 *   unknown         - safe-to-spend could not be computed for another reason,
 *                     so the cash behind it is not drawn as a value
 */
export type SpendableCashTile =
  | { kind: "amount"; cents: number }
  | { kind: "no_cash_account" }
  | { kind: "unknown" };

/**
 * What the "Spendable cash" tile shows. With no summary (no connection) the
 * zero is true. A summary whose safe-to-spend was not computed shows no
 * amount: the cash it would have used is not known to be complete or fresh.
 */
export function spendableCashTile(summary: ScreenSummary | null): SpendableCashTile {
  if (summary === null) return { kind: "amount", cents: 0 };
  const s = summary.safeToSpend;
  if (s.status === "computed" && s.totals !== null) {
    return { kind: "amount", cents: s.totals.spendableCashCents };
  }
  if (s.reason === "no_cash_account") return { kind: "no_cash_account" };
  return { kind: "unknown" };
}

export const NO_CASH_ACCOUNT_LABEL = "No checking account linked";
export const NO_CASH_ACCOUNT_HINT = "Link a checking account to see what you can spend.";

/**
 * The tile's amount, or null when it has none to show: formatted with
 * formatCentsOrDash, an unknown amount is a dash. A tile with no checking
 * account shows NO_CASH_ACCOUNT_LABEL in its place.
 */
export function spendableCashCents(tile: SpendableCashTile): number | null {
  return tile.kind === "amount" ? tile.cents : null;
}

/**
 * Why a safe-to-spend figure is not shown, or null when it is.
 *   banks_not_read     - a connection was not read
 *   no_cash_account    - no cash account, or none with a balance
 *   balance_unknown    - a balance is missing or has not updated recently
 *   recurring_unknown  - recurring charges could not be read or are unknown
 *   history_incomplete - the transaction history is not complete yet
 *   other              - any other reason
 */
export type SafeToSpendHidden =
  | "banks_not_read"
  | "no_cash_account"
  | "balance_unknown"
  | "recurring_unknown"
  | "history_incomplete"
  | "other";

export function safeToSpendHiddenReason(
  view: BankView,
  summary: ScreenSummary
): SafeToSpendHidden | null {
  const s = summary.safeToSpend;
  if (view.showSafeToSpend && s.status === "computed" && s.horizon !== null && s.totals !== null) {
    return null;
  }
  if (view.actions.length > 0) return "banks_not_read";
  if (s.status === "computed") {
    return summary.recurring.totalMonthlyCents === null ? "recurring_unknown" : "other";
  }
  switch (s.reason) {
    case "no_cash_account":
    case "no_spendable_balance":
      return "no_cash_account";
    case "null_balance":
    case "stale_balance":
      return "balance_unknown";
    case "recurring_unavailable":
    case "recurring_amount_unknown":
      return "recurring_unknown";
    case "history_incomplete":
      return "history_incomplete";
    default:
      return "other";
  }
}

/** What the dashboard says when it gives no safe-to-spend figure, by reason. */
export const HIDDEN_SAFE_TO_SPEND_ANSWER: Readonly<Record<SafeToSpendHidden, string>> = {
  banks_not_read: "Not every bank synced, so I'm not giving a spending number yet.",
  no_cash_account:
    "I don't see a checking balance to work from yet, so I can't give a spending number.",
  balance_unknown:
    "Your bank balance hasn't updated recently, so I'm not giving a spending number yet.",
  recurring_unknown:
    "I couldn't read your recurring charges yet, so I'm not giving a spending number.",
  history_incomplete:
    "Your bank is still sending your transaction history, so I'm not giving a spending number yet.",
  other: "I can't work out a spending number from these accounts yet.",
};

/**
 * How far the safe-to-spend figure reaches, for a sentence: "through Nov 30"
 * when it runs to the end of the month, and "until your next income on
 * Nov 21" when it runs to the next income date, which it does not include.
 */
export function safeToSpendHorizonPhrase(horizon: { to: string; rule: string }): string {
  const day = formatCalendarDay(horizon.to);
  return horizon.rule === "next_income_date"
    ? `until your next income on ${day}`
    : `through ${day}`;
}
