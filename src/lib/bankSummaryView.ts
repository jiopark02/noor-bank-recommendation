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
// Data issues in the summary (for example, transactions in Plaid's catch-all
// category) are information about the figures, not a connection problem: they
// create no action and do not hide safe-to-spend.
// =============================================================================

import type {
  BankCompleteness,
  BankConnectionStatus,
  FinanceSummaryResponse,
  TransactionsListResponse,
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
        amountCents: "number|null",
        uncoveredObligationsCents: "number|null",
        horizon: { to: "string" },
        totals: {
          spendableCashCents: "number",
          upcomingRecurringCents: "number",
          reservedCreditCents: "number",
          bufferCents: "number",
        },
        assumptions: { listOf: "string" },
      },
      recurring: {
        totalMonthlyCents: "number|null",
        items: {
          listOf: {
            streamId: "string",
            label: "string",
            monthlyCents: "number",
            nextDate: "string|null",
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

/** What the money screen reads from a transaction list body. */
export const TRANSACTIONS_RESPONSE_FIELDS = {
  transactions: {
    listOf: {
      transactionId: "string",
      accountId: "string",
      amountCents: "number",
      date: "string",
      pending: "boolean",
      name: "string",
      merchantName: "string|null",
      category: { listOf: "string" },
    },
  },
  connections: { listOf: CONNECTION_FIELDS },
  period: { completeness: COMPLETENESS },
} as const;

export type ScreenSummaryResponse = FieldsOf<typeof SUMMARY_RESPONSE_FIELDS>;
export type ScreenSummary = NonNullable<ScreenSummaryResponse["summary"]>;
export type ScreenTransactionsList = FieldsOf<typeof TRANSACTIONS_RESPONSE_FIELDS>;
export type ScreenTransaction = ScreenTransactionsList["transactions"][number];

type Holds<T extends true> = T;
/** Compile-time only: what the routes declare they send has every listed field. */
export type RouteBodiesSatisfyScreenFields = Holds<
  [FinanceSummaryResponse] extends [ScreenSummaryResponse]
    ? [TransactionsListResponse] extends [ScreenTransactionsList]
      ? true
      : false
    : false
>;

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
 * A transaction list response body, or null when it lacks a field the money
 * screen reads or carries one with the wrong type. A wrong-shaped 2xx is a
 * failed read, never an empty list.
 */
export function parseTransactionsListResponse(value: unknown): ScreenTransactionsList | null {
  return fitsFields(TRANSACTIONS_RESPONSE_FIELDS, value)
    ? (value as ScreenTransactionsList)
    : null;
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
