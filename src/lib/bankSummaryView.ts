// =============================================================================
// What the dashboard and the money screen may show from a finance summary.
//
// Pure and client-safe: it imports types only. Both screens decide through
// here, so the rules below are executed by tests rather than read from page
// source:
//   - A figure is shown only for a summary that arrived in this load; while
//     loading, or after a failed load, no dollar amount is drawn.
//   - Safe-to-spend is shown only when every bank connection was read. A bank
//     that could not be read may hold a card balance the number would miss.
//   - Each connection that was not read gets one action: re-link for a login
//     problem, wait while Plaid is still importing, retry otherwise.
//   - Unknown recurring charges render as "Unknown", never as $0.00.
// Data issues in the summary (for example, transactions in Plaid's catch-all
// category) are information about the figures, not a connection problem: they
// create no action and do not hide safe-to-spend.
// =============================================================================

import type {
  BankConnectionStatus,
  FinanceSummaryResponse,
} from "./plaidEngineAdapter";
import type { FinancialSummary } from "./financeEngine";

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

export function decideBankView(input: {
  hasActiveConnection: boolean;
  fetchState: SummaryFetchState;
  response: FinanceSummaryResponse | null;
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

  const missingFrom: string[] = [];
  for (let i = 0; i < connections.length; i++) {
    if (connections[i].status === "ok") continue;
    const name = connections[i].institutionName || UNNAMED_BANK;
    if (missingFrom.indexOf(name) < 0) missingFrom.push(name);
  }

  const everyConnectionRead =
    connections.length > 0 && connections.every((c) => c.status === "ok");
  return {
    figures: "ready",
    showSafeToSpend: everyConnectionRead && summary.safeToSpend.status === "computed",
    actions,
    missingFrom,
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
export function creditUsedCents(summary: FinancialSummary): number | null {
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
export function utilizationPercent(summary: FinancialSummary, accountId: string): number | null {
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

// ---- response shape -----------------------------------------------------------

const CONNECTION_STATES = ["ok", "login_required", "syncing", "failed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isConnection(value: unknown): value is BankConnectionStatus {
  return (
    isRecord(value) &&
    typeof value.itemId === "string" &&
    (value.institutionName === null || typeof value.institutionName === "string") &&
    CONNECTION_STATES.indexOf(value.status as string) >= 0
  );
}

function isSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.cashFlow) &&
    isRecord(value.safeToSpend) &&
    isRecord(value.recurring) &&
    isRecord(value.creditUtilization) &&
    Array.isArray(value.dataIssues)
  );
}

/**
 * A summary response body, or null when it does not have the shape the route
 * sends. A wrong-shaped 2xx is a failed read, never an empty one: read as
 * empty it would show $0.00 as if it were the user's real figure.
 */
export function parseFinanceSummaryResponse(value: unknown): FinanceSummaryResponse | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.connections) || !value.connections.every(isConnection)) return null;
  if (!Array.isArray(value.accounts) || !value.accounts.every(isRecord)) return null;
  if (value.summary !== null && !isSummary(value.summary)) return null;
  return value as unknown as FinanceSummaryResponse;
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
