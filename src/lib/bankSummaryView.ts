// =============================================================================
// What the dashboard and the money screen may show from a finance summary.
//
// Pure and client-safe: besides types it imports only the sentence for a
// failed re-link (plaidRelinkFlow), which is a pure function too. Both screens
// decide through here, so the rules below are executed by tests rather than
// read from page source:
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
//   - The next step the engine picked is checked apart from the figures too:
//     a missing or wrong-shaped one means no next step is shown, and the
//     figures stay.
//   - A linked bank's status label on the money screen says what the summary
//     of this load read from that bank; with no summary, or no match for the
//     bank in it, no label is drawn.
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
import { relinkNoticeMessage, type RelinkNotice } from "./plaidRelinkFlow";

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
  /** Shown under this line only: the re-link of this bank did not go through. */
  relinkError: string | null;
}

/**
 * The action lines to draw, with a failed re-link attached to the line of the
 * bank it was for, in the sentence for why it failed. A failed re-link is
 * about that bank only: every line stays, including that bank's re-link line
 * (so it can be tried again), and it does not touch the figures — it is never
 * an input to summaryLoadInputs or decideBankView.
 */
export function bankActionLines(
  actions: BankAction[],
  relinkNotice: RelinkNotice | null
): BankActionLine[] {
  return actions.map((action) => ({
    action,
    relinkError:
      relinkNotice !== null &&
      action.kind === "relink" &&
      action.itemId === relinkNotice.itemId
        ? relinkNoticeMessage(relinkNotice.kind, action.institutionName)
        : null,
  }));
}

// ---- the linked-bank list -------------------------------------------------------

export const CONNECTION_STATUS_LABEL_OK = "Connected";
export const CONNECTION_STATUS_LABEL_LOGIN_REQUIRED = "Sign-in needed";
export const CONNECTION_STATUS_LABEL_SYNCING = "Importing";
export const CONNECTION_STATUS_LABEL_FAILED = "Couldn't reach";

/**
 * The short label for what a summary said about one connection, or null for
 * any value that is not one of the summary's statuses. Decided by a switch,
 * never by a lookup in an object: a value such as "constructor" has no label.
 */
export function connectionStatusLabel(status: string): string | null {
  switch (status) {
    case "ok":
      return CONNECTION_STATUS_LABEL_OK;
    case "login_required":
      return CONNECTION_STATUS_LABEL_LOGIN_REQUIRED;
    case "syncing":
      return CONNECTION_STATUS_LABEL_SYNCING;
    case "failed":
      return CONNECTION_STATUS_LABEL_FAILED;
    default:
      return null;
  }
}

export interface LinkedBankRow {
  itemId: string;
  institutionName: string;
  /** null: draw no status line for this bank. */
  statusLabel: string | null;
}

/**
 * The rows of the money screen's linked-bank list: one row for every listed
 * connection, in the list's order, whatever is known about it. A row is never
 * left out, so every listed bank keeps its place and its remove control.
 *
 * A row's status label says what the summary of this load read from that bank,
 * matched by item id. It is null when there is no summary (still loading, or
 * the load failed), when the summary names no connection with that item id,
 * and when the status it names is not one this module knows. The stored status
 * of a listed connection is not an input: the parameter type does not carry
 * it.
 */
export function linkedBankRows(
  connections: ReadonlyArray<{ itemId: string; institutionName: string }>,
  response: ScreenSummaryResponse | null
): LinkedBankRow[] {
  const rows: LinkedBankRow[] = [];
  for (let i = 0; i < connections.length; i++) {
    const itemId = connections[i].itemId;
    let statusLabel: string | null = null;
    if (response !== null) {
      for (let j = 0; j < response.connections.length; j++) {
        if (response.connections[j].itemId !== itemId) continue;
        statusLabel = connectionStatusLabel(response.connections[j].status);
        break;
      }
    }
    rows.push({ itemId, institutionName: connections[i].institutionName, statusLabel });
  }
  return rows;
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

/**
 * The part of a summary that comes from the cash-flow engine. The route builds
 * a summary by picking exactly these fields from the engine's answer
 * (pickFields), so a field the engine adds never reaches the browser.
 */
export const ENGINE_SUMMARY_FIELDS = {
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
    // Both are null when the figure could not be computed. Of the totals, only
    // the cash the figure starts from and the cushion it leaves in the account
    // are read: the figure also sets money aside that the totals do not
    // itemize, so the screens never list a breakdown that would not add up to
    // it.
    horizon: {
      orNull: {
        to: "string",
        rule: { oneOf: ["next_income_date", "end_of_calendar_month"] },
      },
    },
    totals: {
      orNull: {
        spendableCashCents: "number",
        cushionFloorCents: "number",
      },
    },
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
        // The engine had no expected date and used today's.
        nextDateAssumedToday: "boolean",
        pastDue: "boolean",
        // What is known about a payment since an expected date that has
        // passed: "counted" when the engine took that payment as made,
        // "pending" when only a pending transaction has appeared, and
        // "unconfirmed" when a posted transaction has but the engine did not
        // take it as the payment. null when the date has not passed, or
        // nothing has appeared since.
        paymentSincePredicted: { orNull: { oneOf: ["counted", "pending", "unconfirmed"] } },
      },
    },
  },
} as const;

/** The part of a summary the app computes itself. */
export const CREDIT_UTILIZATION_FIELDS = {
  accounts: {
    listOf: {
      accountId: "string",
      balanceCents: "number|null",
      ratioBasisPoints: "number|null",
    },
  },
} as const;

/** Every summary field the dashboard, the money screen and this module read. */
export const SCREEN_SUMMARY_FIELDS = {
  ...ENGINE_SUMMARY_FIELDS,
  creditUtilization: CREDIT_UTILIZATION_FIELDS,
  // The cash total, sent only when both hold: safe-to-spend was held back
  // because no bank reported a recurring charge, and every connection was
  // read. null in every other case.
  cashBalanceCents: "number|null",
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
  summary: { orNull: SCREEN_SUMMARY_FIELDS },
} as const;

/**
 * The money screen's transaction list, the `transactions` field of a summary
 * body. Checked apart from SUMMARY_RESPONSE_FIELDS: the route sends it only
 * to a request that asks for it, and a bad list must not fail the figures.
 */
export const SUMMARY_TRANSACTIONS_FIELDS = { listOf: TRANSACTION_FIELDS } as const;

/** The kinds of next step the cash-flow engine can pick. */
export const NEXT_ACTION_KINDS = [
  "fix_connection",
  "cover_bills",
  "move_to_checking",
  "move_to_emergency",
  "pay_card",
  "review_recurring",
  "safe_spend",
] as const;

/**
 * The one next step the engine picked, the `nextAction` field of a summary:
 * why it was picked, and the picked step's kind and amount. `pick` is null
 * when the engine picked nothing. Checked apart from SCREEN_SUMMARY_FIELDS,
 * like the transaction list: a bad next step must not fail the figures.
 * Nothing else the engine says about its candidates is sent.
 */
export const SUMMARY_NEXT_ACTION_FIELDS = {
  reason: { oneOf: ["best", "kept_current", "data_incomplete", "nothing_to_do"] },
  pick: {
    orNull: {
      kind: { oneOf: NEXT_ACTION_KINDS },
      // null for a step that has no amount.
      amountCents: "number|null",
    },
  },
} as const;

export type ScreenNextAction = FieldsOf<typeof SUMMARY_NEXT_ACTION_FIELDS>;

export type ScreenSummaryResponse = FieldsOf<typeof SUMMARY_RESPONSE_FIELDS>;
/** The engine's part of a summary, as the screens read it. */
export type EngineSummaryFields = FieldsOf<typeof ENGINE_SUMMARY_FIELDS>;
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

/** Compile-time only: the next step the route declares it sends fits its field list. */
export type RouteNextActionSatisfiesScreenFields = Holds<
  [NonNullable<FinanceSummaryResponse["summary"]>["nextAction"]] extends [ScreenNextAction | null]
    ? true
    : false
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
  if (!fitsFields(SUMMARY_RESPONSE_FIELDS, value)) return null;
  const body = value as ScreenSummaryResponse;
  if (body.summary === null) return body;
  // Every screen draws recurring charges from this body, so ordering them
  // here (orderRecurringItems) puts every list on the screens in that order.
  return {
    ...body,
    summary: {
      ...body.summary,
      recurring: {
        ...body.summary.recurring,
        items: orderRecurringItems(body.summary.recurring.items),
      },
    },
  };
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

/**
 * The next step a summary body carries, or null when the body has no
 * summary, the summary carries no next step, or the next step has a missing
 * or wrongly typed field. Only the listed fields are returned. null never
 * changes how the figures are read.
 */
export function parseSummaryNextAction(body: unknown): ScreenNextAction | null {
  if (!isRecord(body) || !isRecord(body.summary)) return null;
  const next = body.summary.nextAction;
  if (next === null || next === undefined) return null;
  const picked = pickFields(SUMMARY_NEXT_ACTION_FIELDS, next);
  return picked.ok ? (picked.value as ScreenNextAction) : null;
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
 * The one exception is a figure held back only because no bank reported a
 * recurring charge: the balances are known then, so the tile shows the cash
 * total the summary carries for that case, when it carries one.
 */
export function spendableCashTile(summary: ScreenSummary | null): SpendableCashTile {
  if (summary === null) return { kind: "amount", cents: 0 };
  const s = summary.safeToSpend;
  if (s.status === "computed" && s.totals !== null) {
    return { kind: "amount", cents: s.totals.spendableCashCents };
  }
  if (
    s.status !== "computed" &&
    s.reason === "recurring_empty_unknown" &&
    summary.cashBalanceCents !== null
  ) {
    return { kind: "amount", cents: summary.cashBalanceCents };
  }
  if (s.reason === "no_cash_account") return { kind: "no_cash_account" };
  return { kind: "unknown" };
}

export const NO_CASH_ACCOUNT_LABEL = "No checking account linked";
export const NO_CASH_ACCOUNT_HINT = "Link a checking account to see your cash balance.";

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
    case "recurring_empty_unknown":
    case "recurring_amount_unknown":
      return "recurring_unknown";
    case "history_incomplete":
      return "history_incomplete";
    default:
      return "other";
  }
}

/**
 * What the dashboard says when it gives no safe-to-spend figure, by reason.
 * A bank that was not read has its own message on the dashboard, naming
 * what to do for each bank, so it has no entry here.
 */
export const HIDDEN_SAFE_TO_SPEND_ANSWER: Readonly<
  Record<Exclude<SafeToSpendHidden, "banks_not_read">, string>
> = {
  no_cash_account:
    "I don't see a checking balance to work from yet, so I can't give a spending number.",
  balance_unknown:
    "I can't see an up-to-date balance for your account yet, so I'm not giving a spending number.",
  recurring_unknown:
    "I can't tell what recurring charges you have yet, so I'm not giving a spending number.",
  history_incomplete:
    "I don't have your full transaction history yet, so I'm not giving a spending number.",
  other: "I can't work out a spending number from these accounts yet.",
};

/** Plain code-unit order, the same on every platform and in every locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order recurring charges are drawn in: the largest monthly amount
 * first, charges with no known amount after every charge with one, then by
 * label, then by stream id, so the order is the same for the same charges
 * whatever order they arrived in.
 */
export function compareRecurringItems(
  a: { streamId: string; label: string; monthlyCents: number | null },
  b: { streamId: string; label: string; monthlyCents: number | null }
): number {
  if (a.monthlyCents !== b.monthlyCents) {
    if (a.monthlyCents === null) return 1;
    if (b.monthlyCents === null) return -1;
    return b.monthlyCents - a.monthlyCents;
  }
  return compareText(a.label, b.label) || compareText(a.streamId, b.streamId);
}

/** A copy of `items` in the order the screens draw recurring charges in. */
export function orderRecurringItems<
  T extends { streamId: string; label: string; monthlyCents: number | null },
>(items: readonly T[]): T[] {
  return items.slice().sort(compareRecurringItems);
}

/**
 *   date    - draw the charge's expected date
 *   pending - draw PAYMENT_PENDING_LABEL in place of the date
 *   none    - draw no line
 */
export type RecurringDateLine = "date" | "pending" | "none";

/** Shown in place of a passed expected date while its payment is still pending. */
export const PAYMENT_PENDING_LABEL = "Payment pending";

/**
 * The line under a recurring charge's name. A date is drawn only when the
 * engine expected one: a date it filled in with today because it had none is
 * not shown. For a date that has passed, the line follows what is known about
 * the payment since: taken as made, no line; only a pending transaction so
 * far, the pending label instead of the date; a posted transaction the engine
 * did not take as the payment, or nothing at all, the date stays.
 */
export function recurringDateLine(item: {
  nextDate: string | null;
  nextDateAssumedToday: boolean;
  paymentSincePredicted: "counted" | "pending" | "unconfirmed" | null;
}): RecurringDateLine {
  if (item.nextDate === null || item.nextDateAssumedToday) return "none";
  if (item.paymentSincePredicted === "counted") return "none";
  if (item.paymentSincePredicted === "pending") return "pending";
  return "date";
}

/**
 * The dashboard's safe-to-spend lines, after its greeting. What the figure
 * sets aside is named in words, never itemized, because the parts the summary
 * carries do not add up to it. A negative figure is the shortfall, stated as
 * its absolute value.
 *
 * The figure is what is left after a cushion is kept in the account, and the
 * answer says so with the cushion's amount, the only other amount in the
 * lines. That amount is the one the figure was computed with, passed in; it
 * is never written here. With no cushion (0, or none given) the answer names
 * none.
 */
export function safeToSpendLines(
  amountCents: number,
  horizon: { to: string; rule: string },
  cushionFloorCents: number | null
): { statement: string; answer: string } {
  const reach = safeToSpendHorizonPhrase(horizon);
  const cushion =
    cushionFloorCents !== null && cushionFloorCents > 0 ? formatCents(cushionFloorCents) : null;
  if (amountCents >= 0) {
    return {
      statement: `You have about ${formatCents(amountCents)} to spend ${reach}.`,
      answer:
        "That's what's left after setting aside upcoming bills, card payments, your usual spending and other expected costs" +
        (cushion === null ? "." : `, and keeping a ${cushion} cushion in your account.`),
    };
  }
  return {
    statement: `What I'd set aside ${reach} comes to about ${formatCents(
      -amountCents
    )} more than your cash.`,
    answer:
      "That covers upcoming bills, card payments, your usual spending and other expected costs" +
      (cushion === null ? "." : `, plus a ${cushion} cushion I'd keep in your account.`),
  };
}

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

// ---- the next step --------------------------------------------------------------

/**
 *   line   - draw this one sentence at the top of the dashboard
 *   hidden - draw nothing
 */
export type NextActionCard = { kind: "hidden" } | { kind: "line"; text: string };

/** A bank was not read: the steps for each bank are drawn with the figures. */
export const NEXT_ACTION_BANK_NEEDS_ATTENTION =
  "A bank connection needs your attention. See the steps below.";
export const NEXT_ACTION_NOT_ENOUGH_DATA =
  "There isn't enough bank data yet to suggest a next step.";
export const NEXT_ACTION_NOTHING_TO_MOVE =
  "Nothing needs moving right now. Your spending number is below.";

/**
 * The dashboard's next-step line, from the step the engine picked. The app
 * writes every sentence; the engine supplies only the kind and the amount,
 * which is the only amount a sentence names. A sentence never names a
 * product, an institution or an account, never states a rate or an expected
 * return, and never says the app moves money: any move is the user's own.
 *
 * Nothing is drawn unless the figures are ready, and nothing when the engine
 * picked no step: that it has nothing to suggest does not mean nothing is
 * wrong, so it is not put into words.
 *
 * By kind:
 *   - The step the engine picks when it could not compute safe-to-spend is
 *     worded from what the screen already decided, never decided again here:
 *     a bank that was not read (view.actions) points at the steps drawn for
 *     each bank. With every bank read, the line asks for a checking account
 *     exactly when the spendable-cash tile does (spendableCashTile), so the
 *     two never disagree about whether one is linked; any other reason gets
 *     the general line.
 *   - Every other step is drawn only with an amount above zero.
 *   - A step whose amount comes from the balances behind safe-to-spend is
 *     drawn only where the safe-to-spend figure itself may be: with the
 *     figure held back, a bank that was not read could change the amount.
 *   - The step that is the safe-to-spend figure names no amount: the
 *     dashboard states that figure once already.
 *   - A recurring-charges step names a monthly amount, so it is drawn only
 *     while recurring charges are known and every bank was read: a bank that
 *     was not read (view.actions, the same test the per-bank steps are drawn
 *     under) may hold charges the amount leaves out.
 */
export function nextActionCard(
  view: BankView,
  summary: ScreenSummary | null,
  next: ScreenNextAction | null
): NextActionCard {
  const hidden: NextActionCard = { kind: "hidden" };
  const line = (text: string): NextActionCard => ({ kind: "line", text });
  if (view.figures !== "ready" || summary === null || next === null) return hidden;
  const pick = next.pick;
  if (pick === null) return hidden;
  const notShown = safeToSpendHiddenReason(view, summary);

  if (pick.kind === "fix_connection") {
    // Safe-to-spend is shown, so the screen has no missing data to name.
    if (notShown === null) return hidden;
    if (view.actions.length > 0) return line(NEXT_ACTION_BANK_NEEDS_ATTENTION);
    if (spendableCashTile(summary).kind === "no_cash_account") return line(NO_CASH_ACCOUNT_HINT);
    return line(NEXT_ACTION_NOT_ENOUGH_DATA);
  }

  if (pick.amountCents === null || pick.amountCents <= 0) return hidden;
  const amount = formatCents(pick.amountCents);

  if (pick.kind === "review_recurring") {
    if (view.actions.length > 0 || summary.recurring.totalMonthlyCents === null) return hidden;
    return line(
      `About ${amount} a month goes to subscriptions and other optional recurring charges. ` +
        "It's worth checking you still want them all."
    );
  }

  const horizon = summary.safeToSpend.horizon;
  if (!view.showSafeToSpend || notShown !== null || horizon === null) return hidden;
  if (pick.kind === "safe_spend") return line(NEXT_ACTION_NOTHING_TO_MOVE);
  const due =
    `Bills and payments coming up ${safeToSpendHorizonPhrase(horizon)} come to about ${amount} ` +
    "more than the cash in your checking.";
  switch (pick.kind) {
    case "cover_bills":
      return line(`${due} Adding ${amount} before then would cover them.`);
    case "move_to_checking":
      return line(`${due} You could move ${amount} over from your savings to cover them.`);
    case "move_to_emergency":
      return line(
        `You have about ${amount} beyond what your bills and usual spending need. ` +
          "You could move it into savings as an emergency cushion."
      );
    case "pay_card":
      return line(`You could put about ${amount} toward your credit card balance.`);
    default:
      return hidden;
  }
}
