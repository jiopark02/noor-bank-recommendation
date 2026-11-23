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
//
// The second part of this file (listSharedForChat, readSharedForChat) reads
// the connections another household member shares with the user, one read
// per owner with that owner's id; see its own header below.
// =============================================================================

import { isPlaidConfigured } from "@/lib/plaid";
import { createAdminClient, createServerClient } from "@/lib/supabase";
import {
  bankWindow,
  liveAdapterDeps,
  readBankData,
  type BankConnectionState,
  type BankRead,
  type ReadAccount,
  type StoredConnectionRow,
} from "@/lib/plaidEngineAdapter";
import { isPlaidTokenCryptoConfigured, isPlaidTokenCryptoError } from "@/lib/plaidTokenCrypto";
import type {
  PlaidChatAccount,
  PlaidChatConnection,
  PlaidChatConnectionRead,
  PlaidChatDepth,
  PlaidChatState,
  SharedChatOwner,
  SharedChatState,
} from "@/lib/plaidChatContext";
import {
  SHARED_ACCOUNTS_READ_TIMEOUT_MS,
  type SharedAccountsStore,
  type SharedConnection,
} from "@/lib/householdSharedAccounts";
import { makeSharedAccountsStore } from "@/lib/householdSharedAccountsStore";
import { logSafeCode } from "@/lib/householdInvite";

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

// =============================================================================
// Bank data another household member shares with the user.
//
// Which connections those are is answered by the database's shared-connections
// function, through the shared-accounts store (householdSharedAccountsStore.ts),
// called with the verified user's id and nothing else; this module adds no
// condition of its own. Reads are made per owner, with that owner's id, which
// the stored token is bound to: rows of two owners never go to one read.
// Accounts only: no transactions, no recurring streams, no Item read.
//
// Two steps, so the chat route can decide in between whether the turn needs
// the data at all: listSharedForChat says what is shared and whose it is
// (no bank call); readSharedForChat reads it and then asks the function
// again, keeping only connections still shared.
// =============================================================================

/** A shared connection whose data entered a turn: what the save records. */
export interface SharedChatSource {
  ownerUserId: string;
  connectionId: number;
}

/** What is shared with the user, before any bank is read. */
export interface SharedChatList {
  /** The function's rows, in the order it returned them. */
  connections: SharedConnection[];
  /** First names by owner id; null where there is none or it was unreadable. */
  firstNames: Record<string, string | null>;
}

/** The shared data read for one turn, and the connections it came from. */
export interface SharedChatRead {
  state: SharedChatState;
  /** Every connection the block names, read or not. */
  sources: SharedChatSource[];
}

/**
 * The shared-connections function failed, on the first call ("list") or on
 * the call after the reads ("recheck"), or the reads and that second call did
 * not finish inside their time limit ("timeout"). `code` is the database's
 * error code, or a fixed word; never a message.
 */
export class SharedChatReadError extends Error {
  readonly stage: "list" | "recheck" | "timeout";
  readonly code: string;

  constructor(stage: "list" | "recheck" | "timeout", code: string) {
    super(`shared connections could not be read (${stage})`);
    this.name = "SharedChatReadError";
    this.stage = stage;
    this.code = code;
    // ES5 target: keep instanceof working on the subclass.
    Object.setPrototypeOf(this, SharedChatReadError.prototype);
  }
}

export interface SharedChatDeps {
  store: SharedAccountsStore;
  log: (line: string) => void;
}

function liveSharedDeps(): SharedChatDeps {
  return {
    store: makeSharedAccountsStore(createAdminClient()),
    log: (line) => console.warn(line),
  };
}

const SHARED_ACCOUNTS_ONLY = { accounts: true, transactions: false, recurring: false };

/**
 * What other household members share with the user, and their first names.
 * Reads no bank. A failed call of the function throws SharedChatReadError; a
 * failed name read only leaves every name null.
 *
 * @param userId  The verified user's id (never a body value).
 */
export async function listSharedForChat(
  userId: string,
  deps: SharedChatDeps = liveSharedDeps()
): Promise<SharedChatList> {
  const rows = await deps.store.readSharedConnections(userId);
  if (!rows.ok) throw new SharedChatReadError("list", rows.code);
  const firstNames: Record<string, string | null> = {};
  const owners: string[] = [];
  for (const c of rows.value) {
    if (owners.indexOf(c.ownerUserId) === -1) owners.push(c.ownerUserId);
  }
  for (const owner of owners) firstNames[owner] = null;
  if (owners.length > 0) {
    const names = await deps.store.readFirstNames(owners);
    if (names.ok) {
      for (const owner of owners) firstNames[owner] = names.value[owner] ?? null;
    } else {
      deps.log(`[chat-shared] outcome=names_failed code=${logSafeCode(names.code)}`);
    }
  }
  return { connections: rows.value, firstNames };
}

type OwnerGroup = { ownerUserId: string; connections: SharedConnection[] };

function groupSharedByOwner(rows: SharedConnection[]): OwnerGroup[] {
  const groups: OwnerGroup[] = [];
  const index: Record<string, number> = {};
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(index, row.ownerUserId)) {
      index[row.ownerUserId] = groups.length;
      groups.push({ ownerUserId: row.ownerUserId, connections: [] });
    }
    groups[index[row.ownerUserId]].connections.push(row);
  }
  return groups;
}

/** One shared connection as this turn read it. */
type ReadConnection = {
  source: SharedConnection;
  connection: PlaidChatConnection;
  accounts: PlaidChatAccount[];
};

function notRead(rows: SharedConnection[]): ReadConnection[] {
  return rows.map((source) => ({
    source,
    connection: {
      institution: source.row.institution_name ?? "",
      status: "active",
      read: "not_read",
    },
    accounts: [],
  }));
}

async function readOwnerForChat(
  group: OwnerGroup,
  canRead: boolean,
  signal: AbortSignal | undefined,
  log: (line: string) => void
): Promise<ReadConnection[]> {
  if (!canRead) return notRead(group.connections);
  const today = new Date().toISOString().slice(0, 10);
  let read: BankRead;
  try {
    read = await readBankData(
      group.ownerUserId,
      group.connections.map((c) => c.row),
      SHARED_ACCOUNTS_ONLY,
      bankWindow(today, 1),
      liveAdapterDeps(),
      { itemStatus: false, signal, logOrigin: "chat-shared" }
    );
  } catch (error) {
    const reason = isPlaidTokenCryptoError(error) ? error.reason : "unknown";
    log(`[chat-shared] outcome=owner_read_failed reason=${logSafeCode(reason)}`);
    return notRead(group.connections);
  }
  return group.connections.map((source, k) => {
    const status = read.connections[k];
    const matches = status !== undefined && status.itemId === source.row.item_id;
    const connectionRead: PlaidChatConnectionRead = matches ? readOf(status.status) : "not_read";
    return {
      source,
      connection: {
        institution: source.row.institution_name ?? "",
        status: "active",
        read: connectionRead,
      },
      accounts:
        connectionRead === "read"
          ? read.accounts.filter((a) => a.itemId === source.row.item_id).map(toChatAccount)
          : [],
    };
  });
}

/**
 * Reads the accounts of every connection in `list`, one read per owner with
 * that owner's id, then calls the function again and keeps only the
 * connections it still returns. A connection that could not be read stays,
 * marked not read and with no account, and is still a source: its bank's name
 * is in the block. When the second call fails, SharedChatReadError is thrown
 * and nothing read may be used.
 *
 * The reads and the second call together are limited to `opts.timeoutMs`
 * (SHARED_ACCOUNTS_READ_TIMEOUT_MS, the limit of the same read on the
 * household card, by default). When it passes first, the bank calls are
 * cancelled and SharedChatReadError with stage "timeout" is thrown, so the
 * turn goes on without the other member's data instead of waiting for a slow
 * bank until the request's own deadline.
 *
 * @param opts.signal  Passed to every bank call; a caller that cancels must
 *   not use the result.
 */
export async function readSharedForChat(
  userId: string,
  list: SharedChatList,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  deps: SharedChatDeps = liveSharedDeps()
): Promise<SharedChatRead> {
  const timeoutMs = opts.timeoutMs ?? SHARED_ACCOUNTS_READ_TIMEOUT_MS;
  const controller = new AbortController();
  const outer = opts.signal;
  const onOuterAbort = (): void => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onOuterAbort);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = readAndRecheck(userId, list, controller.signal, deps);
    work.then(undefined, () => undefined);
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Reject first, so nothing the abort triggers can settle the race.
        reject(new SharedChatReadError("timeout", "timeout"));
        controller.abort();
      }, timeoutMs);
    });
    return await Promise.race([work, limit]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (outer) outer.removeEventListener("abort", onOuterAbort);
  }
}

async function readAndRecheck(
  userId: string,
  list: SharedChatList,
  signal: AbortSignal,
  deps: SharedChatDeps
): Promise<SharedChatRead> {
  const canRead = isPlaidConfigured() && isPlaidTokenCryptoConfigured();
  const groups = groupSharedByOwner(list.connections);
  const reads = await Promise.all(
    groups.map((g) => readOwnerForChat(g, canRead, signal, deps.log))
  );

  const again = await deps.store.readSharedConnections(userId);
  if (!again.ok) throw new SharedChatReadError("recheck", again.code);
  const still: Record<string, true> = {};
  for (const c of again.value) still[`${c.ownerUserId}:${c.connectionId}`] = true;

  const owners: SharedChatOwner[] = [];
  const sources: SharedChatSource[] = [];
  groups.forEach((group, g) => {
    const kept = reads[g].filter(
      (r) => still[`${r.source.ownerUserId}:${r.source.connectionId}`] === true
    );
    if (kept.length === 0) return;
    owners.push({
      firstName: list.firstNames[group.ownerUserId] ?? null,
      connections: kept.map((r) => r.connection),
      accounts: kept.reduce<PlaidChatAccount[]>((all, r) => all.concat(r.accounts), []),
    });
    for (const r of kept) {
      sources.push({ ownerUserId: r.source.ownerUserId, connectionId: r.source.connectionId });
    }
  });
  return { state: { owners }, sources };
}
