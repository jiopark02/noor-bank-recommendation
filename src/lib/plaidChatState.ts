// =============================================================================
// Plaid capability scaffold — I/O orchestrator.
//
// Populates a PlaidChatState (see plaidChatContext.ts) for the chat route:
//   L1 (always): connection state from the plaid_connections DB table.
//   L2 (depth "balances"): the accounts of every active connection, read
//       through the shared bank adapter (readBankData, plaidEngineAdapter.ts),
//       accounts only.
//
// Kept separate from plaidChatContext.ts so the pure prompt-assembly helpers
// stay importable with zero side effects (and unit-testable without the SDK).
//
// Constraints:
//  - No storage, no cache — live fetch only.
//  - Multi-connection safe: reads plaid_connections directly (never .single()).
//    At depth "balances", a connection whose read fails is reported as needing
//    reconnection or as not read this turn, and the others are read. The
//    exception is a token that does not decrypt: when no active connection's
//    token decrypts (one active connection included), the adapter throws and
//    the turn gets the "state unknown" block, as for a DB error.
//  - DB error on the connection read THROWS (so the route emits an explicit
//    "state unknown" block) — distinct from an empty result ("no connections").
//    This does not use the shared getAllPlaidConnections helper: that helper
//    reports a failed read by returning null, where this path needs a throw,
//    and it selects the whole row where this path reads four columns.
//  - Null/undefined Plaid balances are preserved as "unavailable", never 0.
//  - userId comes only from the verified token (passed in by the caller).
// =============================================================================

import { isPlaidConfigured } from "@/lib/plaid";
import { createServerClient } from "@/lib/supabase";
import {
  bankWindow,
  liveAdapterDeps,
  readBankData,
  type BankConnectionState,
  type ReadAccount,
  type StoredConnectionRow,
} from "@/lib/plaidEngineAdapter";
import type {
  PlaidChatAccount,
  PlaidChatConnection,
  PlaidChatConnectionRead,
  PlaidChatDepth,
  PlaidChatState,
} from "@/lib/plaidChatContext";

/**
 * The plaid_connections read failed. Thrown so the caller can tell this case
 * from any other failure; the message names the read, and `code` is the
 * database's error code when it sent one (never a row or a message).
 */
export class PlaidConnectionReadError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null, cause: unknown) {
    super(message, { cause });
    this.name = "PlaidConnectionReadError";
    this.code = code;
    // ES5 target: keep instanceof working on the subclass.
    Object.setPrototypeOf(this, PlaidConnectionReadError.prototype);
  }
}

/**
 * Maps Plaid account type + subtype to a human "kind" label. Subtype-aware so a
 * savings account is not mislabeled "checking".
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

/** One account as the chat block shows it. Cents become dollars; null stays unknown. */
function toChatAccount(a: ReadAccount): PlaidChatAccount {
  const known = a.currentCents !== null;
  return {
    label: a.name || a.officialName || "Account",
    kind: mapAccountKind(a.type, a.subtype),
    balanceStatus: known ? "known" : "unavailable",
    owed: a.type === "credit" || a.type === "loan",
    current: known ? (a.currentCents as number) / 100 : undefined,
    available: a.availableCents !== null ? a.availableCents / 100 : undefined,
    currency: a.currency || undefined,
  };
}

function readOf(status: BankConnectionState): PlaidChatConnectionRead {
  if (status === "ok") return "read";
  if (status === "login_required") return "needs_reconnect";
  return "not_read";
}

interface ConnectionRow {
  institution_name: unknown;
  status: unknown;
  access_token: unknown;
  item_id: unknown;
}

/**
 * Builds the per-turn Plaid state for the chat prompt.
 *
 * @param userId  Authenticated user id (from the verified token — never a body).
 *   Also the additional authenticated data for decrypting the stored tokens,
 *   so it must be passed through unmodified.
 * @param opts.depth  "connection" = DB read only; "balances" = also read the
 *   accounts of every active connection, live.
 *
 * A DB error on the connection read throws; the route wraps this call in
 * try/catch and falls back to an explicit "state unknown" (readError) block.
 * An empty result is NOT an error — it is a genuine "no connections".
 *
 * At depth "balances" each active connection is marked with what its read came
 * to (read / needs_reconnect / not_read). A token that does not decrypt marks
 * only its own connection not_read; when no token decrypts, the adapter
 * throws, and that throw reaches the route like the DB error does: a fault
 * shared by every row is the key's, not any one bank's. When Plaid is not
 * configured, nothing is read and every active connection is not_read.
 *
 * @param opts.signal  Optional. Passed to the connection read and to every
 *   Plaid call so a caller that has stopped waiting can cancel them. When it
 *   has already been aborted after the connection read, no Plaid call is made.
 *   A cancelled call marks its connection not_read like any other failure, so
 *   a caller that cancels must not use the result.
 */
export async function getPlaidChatState(
  userId: string,
  opts: { depth: PlaidChatDepth; signal?: AbortSignal }
): Promise<PlaidChatState> {
  // L1 — authoritative connection state, read directly (see file header for why
  // not getAllPlaidConnections). Multi-connection safe (no .single()). On a DB
  // error we THROW so the route can surface an explicit unknown state rather
  // than a false "not connected"; an empty result is a genuine "no connections".
  const supabase = createServerClient();
  const connectionsQuery = supabase
    .from("plaid_connections")
    .select("institution_name,status,access_token,item_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const { data, error } = await (opts.signal
    ? connectionsQuery.abortSignal(opts.signal)
    : connectionsQuery);

  if (error) {
    const code = (error as { code?: unknown }).code;
    throw new PlaidConnectionReadError(
      `getPlaidChatState: failed to read plaid_connections: ${error.message}`,
      typeof code === "string" && code !== "" ? code : null,
      error
    );
  }

  const rows: ConnectionRow[] = data ?? [];

  const connections: PlaidChatConnection[] = rows.map((r) => ({
    institution: typeof r.institution_name === "string" ? r.institution_name : "",
    status: r.status === "active" ? "active" : "error",
  }));

  // Indexes into rows/connections of the active connections, in row order.
  const activeIndexes: number[] = [];
  rows.forEach((r, i) => {
    if (r.status === "active") activeIndexes.push(i);
  });
  const connected = activeIndexes.length > 0;

  const state: PlaidChatState = {
    depth: opts.depth,
    connected,
    connections,
  };

  // L2 — accounts. Only at depth "balances" and when connected. Live read, no
  // storage, no cache.
  if (opts.depth !== "balances" || !connected) return state;

  if (!isPlaidConfigured()) {
    for (const i of activeIndexes) connections[i].read = "not_read";
    state.accounts = [];
    return state;
  }

  // Cancelled while the connection read was answering: make no Plaid call.
  if (opts.signal?.aborted) return state;

  const adapterRows: StoredConnectionRow[] = activeIndexes.map((i) => ({
    access_token: rows[i].access_token as string,
    item_id: rows[i].item_id as string,
    institution_name:
      typeof rows[i].institution_name === "string"
        ? (rows[i].institution_name as string)
        : null,
  }));

  // An accounts-only read makes no use of the window: it bounds transaction
  // reads, which are not made here. One day ending today (UTC) satisfies the
  // signature.
  const today = new Date().toISOString().slice(0, 10);
  const read = await readBankData(
    userId,
    adapterRows,
    { accounts: true, transactions: false, recurring: false },
    bankWindow(today, 1),
    liveAdapterDeps(),
    { itemStatus: false, signal: opts.signal, logOrigin: "chat" }
  );

  // read.connections is in the order of adapterRows.
  activeIndexes.forEach((rowIndex, k) => {
    connections[rowIndex].read = readOf(read.connections[k].status);
  });
  state.accounts = read.accounts.map(toChatAccount);
  return state;
}
