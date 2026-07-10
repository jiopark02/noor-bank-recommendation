// =============================================================================
// Plaid capability scaffold — I/O orchestrator.
//
// Populates a PlaidChatState (see plaidChatContext.ts) for the chat route:
//   L1 (always): connection state from the plaid_connections DB table.
//   L2 (depth "balances"): a live, multi-connection-safe shallow accounts read.
//
// Kept separate from plaidChatContext.ts so the pure prompt-assembly helpers
// stay importable with zero side effects (and unit-testable without the SDK).
//
// Constraints (see docs/design/B-1-plaid-chat-capability-scaffold.md):
//  - No storage, no cache — live fetch only.
//  - Multi-connection safe: reads plaid_connections directly (never .single());
//    a single broken item must not sink the turn.
//  - DB error on the connection read THROWS (so the route emits an explicit
//    "state unknown" block) — distinct from an empty result ("no connections").
//    We deliberately do NOT use the shared getAllPlaidConnections helper here
//    because it swallows DB errors into [], which would misreport a transient
//    failure as "no bank connected".
//  - Null/undefined Plaid balances are preserved as "unavailable", never 0.
//  - Does NOT touch the shared /api/plaid/accounts route (dashboard regression
//    avoidance) — this is a dedicated in-process read.
//  - userId comes only from the verified token (passed in by the caller).
// =============================================================================

import { plaidClient, isPlaidConfigured } from "@/lib/plaid";
import { createServerClient } from "@/lib/supabase";
import type {
  PlaidChatAccount,
  PlaidChatConnection,
  PlaidChatDepth,
  PlaidChatState,
} from "@/lib/plaidChatContext";

/**
 * Maps Plaid account type + subtype to a human "kind" label. Subtype-aware so a
 * savings account is not mislabeled "checking" (fixes §6 #2 for the chat path).
 * Returns a raw label; it is sanitized at render time in the pure builder.
 */
function mapAccountKind(
  type: string | null | undefined,
  subtype: string | null | undefined
): string {
  if (typeof subtype === "string" && subtype.trim()) return subtype.trim();
  switch (type) {
    case "depository":
      return "bank account";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
      return "investment";
    default:
      return "account";
  }
}

/**
 * Shallow accounts across all active connections. Multi-connection safe: a
 * failing item (e.g. ITEM_LOGIN_REQUIRED, expired token) is skipped, not fatal.
 * Balances are preserved exactly — a null/undefined current balance becomes
 * balanceStatus "unavailable" (never coerced to 0).
 */
async function fetchShallowAccounts(
  activeConnections: Array<{ access_token: string }>
): Promise<PlaidChatAccount[]> {
  const accounts: PlaidChatAccount[] = [];

  for (const conn of activeConnections) {
    try {
      const res = await plaidClient.accountsGet({
        access_token: conn.access_token,
      });

      for (const a of res.data.accounts) {
        const current = a.balances?.current;
        const available = a.balances?.available;
        const known = typeof current === "number";

        accounts.push({
          label: a.name || a.official_name || "Account",
          kind: mapAccountKind(a.type, a.subtype),
          balanceStatus: known ? "known" : "unavailable",
          current: known ? (current as number) : undefined,
          available: typeof available === "number" ? available : undefined,
          currency: a.balances?.iso_currency_code || undefined,
        });
      }
    } catch (err) {
      // One broken connection must not sink the whole turn.
      console.warn(
        "[plaid-state] accountsGet failed for a connection; skipping it:",
        err instanceof Error ? err.message : err
      );
      continue;
    }
  }

  return accounts;
}

/**
 * Builds the per-turn Plaid state for the chat prompt.
 *
 * @param userId  Authenticated user id (from the verified token — never a body).
 * @param opts.depth  "connection" = DB read only; "balances" = also live-fetch
 *   shallow accounts (when connected and Plaid is configured).
 *
 * The connection read is in-process (DB) and the accounts read uses the stored
 * access tokens directly, so no request/headers need to be threaded in.
 *
 * A DB error on the connection read throws; the route wraps this call in
 * try/catch and falls back to an explicit "state unknown" (readError) block.
 * An empty result is NOT an error — it is a genuine "no connections".
 */
export async function getPlaidChatState(
  userId: string,
  opts: { depth: PlaidChatDepth }
): Promise<PlaidChatState> {
  // L1 — authoritative connection state, read directly (see file header for why
  // not getAllPlaidConnections). Multi-connection safe (no .single()). On a DB
  // error we THROW so the route can surface an explicit unknown state rather
  // than a false "not connected"; an empty result is a genuine "no connections".
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("plaid_connections")
    .select("institution_name,status,access_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `getPlaidChatState: failed to read plaid_connections: ${error.message}`,
      { cause: error }
    );
  }

  const rows = data ?? [];

  const connections: PlaidChatConnection[] = rows.map((r) => ({
    institution: typeof r.institution_name === "string" ? r.institution_name : "",
    status: r.status === "active" ? "active" : "error",
  }));

  const activeRows = rows.filter((r) => r.status === "active");
  const connected = activeRows.length > 0;

  const state: PlaidChatState = {
    depth: opts.depth,
    connected,
    connections,
  };

  // L2 — shallow balances. Only when explicitly at depth "balances", connected,
  // and Plaid is configured. Live fetch, no storage, no cache.
  if (opts.depth === "balances" && connected && isPlaidConfigured()) {
    state.accounts = await fetchShallowAccounts(
      activeRows.map((r) => ({ access_token: r.access_token }))
    );
  }

  return state;
}
