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

export function decideBankView(input: {
  hasActiveConnection: boolean;
  fetchState: SummaryFetchState;
  response: FinanceSummaryResponse | null;
}): BankView {
  const nothing: BankView = { figures: "loading", showSafeToSpend: false, actions: [] };

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
    return { figures: "unavailable", showSafeToSpend: false, actions };
  }

  const everyConnectionRead =
    connections.length > 0 && connections.every((c) => c.status === "ok");
  return {
    figures: "ready",
    showSafeToSpend: everyConnectionRead && summary.safeToSpend.status === "computed",
    actions,
  };
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

/** A balance that may be missing: null renders as a dash, never as $0.00. */
export function formatCentsOrDash(cents: number | null): string {
  return cents === null ? "—" : formatCents(cents);
}

/** Monthly recurring total: null (unknown) renders as "Unknown", never as $0.00. */
export function formatMonthlyOrUnknown(cents: number | null): string {
  return cents === null ? "Unknown" : formatCents(cents);
}
