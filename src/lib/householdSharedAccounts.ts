import type { BankRead, StoredConnectionRow } from "@/lib/plaidEngineAdapter";
import { isPlaidTokenCryptoError } from "@/lib/plaidTokenCrypto";
import { HOUSEHOLD_CODES, HOUSEHOLD_MESSAGES } from "./householdCopy";
import { logSafeCode, type HouseholdLog, type HouseholdResult } from "./householdInvite";

/**
 * GET /api/household/shared-accounts: the accounts and balances of the bank
 * connections other household members share with the caller.
 *
 * Which connections those are is decided by one database function,
 * household_shared_connections, called through the store with the verified
 * caller's id only. This module never decides it.
 *
 * Reads are made per owner: each owner's rows go to one read, with that
 * owner's id, which the stored token is bound to. Rows of two owners are
 * never read together. Accounts only: no transactions, no engine.
 *
 * After the reads, the function is called again, and only a connection it
 * still returns is answered, so sharing that ended while the bank was being
 * read is not shown.
 *
 * Nothing is written: no database row, no cache. The answer carries no
 * owner id, no connection id, no item id and no Plaid account id. Each
 * account carries the currency code the bank read gave, or null. A
 * connection that could not be read answers `readable: false` with no
 * accounts, never an amount of zero. An account name that is not a string
 * is answered as an empty string. Log lines carry route, outcome, an error
 * code or the crypto module's reason, and counts only.
 */

export type SharedAccountsMode = "off" | "on";

/**
 * Exactly "off" turns the read off: the answer is an empty list and nothing
 * is read. Any other value, unset included, leaves it on. No trimming or case
 * folding.
 */
export function resolveSharedAccountsMode(raw: string | undefined): SharedAccountsMode {
  return raw === "off" ? "off" : "on";
}

/** One connection shared with the caller, as the store read it. */
export type SharedConnection = {
  ownerUserId: string;
  connectionId: number;
  /** Handed unchanged to the owner's read. */
  row: StoredConnectionRow;
};

export type StoreRead<T> = { ok: true; value: T } | { ok: false; code: string };

export interface SharedAccountsStore {
  /** The function's rows for this caller, in the order it returns them. */
  readSharedConnections(userId: string): Promise<StoreRead<SharedConnection[]>>;
  /** First names for display, by user id. A missing id has no name. */
  readFirstNames(userIds: string[]): Promise<StoreRead<Record<string, string | null>>>;
}

/** Reads one owner's rows, with that owner's id. Accounts only. */
export type OwnerRead = (
  ownerUserId: string,
  rows: StoredConnectionRow[],
  signal: AbortSignal
) => Promise<Pick<BankRead, "connections" | "accounts">>;

export type SharedAccountsDeps = {
  mode: SharedAccountsMode;
  store: SharedAccountsStore;
  /** null when the bank read cannot be made here: every connection is then unreadable. */
  readOwner: OwnerRead | null;
  log: HouseholdLog;
  /** When the reads are cancelled; a read not finished by then is unreadable. */
  timeoutMs?: number;
};

export const SHARED_ACCOUNTS_READ_TIMEOUT_MS = 12_000;

export type SharedAccountView = {
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentCents: number | null;
  availableCents: number | null;
  /** The currency code the bank read gave with the balances, or null. */
  currency: string | null;
};

export type SharedConnectionView = {
  institutionName: string | null;
  readable: boolean;
  accounts: SharedAccountView[];
};

export type SharedOwnerView = {
  firstName: string | null;
  connections: SharedConnectionView[];
};

const ROUTE = "shared-accounts";

function logLine(log: HouseholdLog, outcome: string, extra = ""): void {
  log(`[household] route=${ROUTE} outcome=${outcome}${extra}`);
}

function ok(owners: SharedOwnerView[]): HouseholdResult {
  return { status: 200, body: { sharedAccounts: { owners } } };
}

function serverError(): HouseholdResult {
  return {
    status: 500,
    body: {
      error: HOUSEHOLD_MESSAGES[HOUSEHOLD_CODES.SERVER_ERROR],
      code: HOUSEHOLD_CODES.SERVER_ERROR,
    },
  };
}

type OwnerGroup = { ownerUserId: string; connections: SharedConnection[] };

/** Groups rows by owner, keeping the order in which each owner first appears. */
function groupByOwner(rows: SharedConnection[]): OwnerGroup[] {
  const groups: OwnerGroup[] = [];
  const index: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) {
    const owner = rows[i].ownerUserId;
    if (!Object.prototype.hasOwnProperty.call(index, owner)) {
      index[owner] = groups.length;
      groups.push({ ownerUserId: owner, connections: [] });
    }
    groups[index[owner]].connections.push(rows[i]);
  }
  return groups;
}

function unreadable(connections: SharedConnection[]): SharedConnectionView[] {
  return connections.map((c) => ({
    institutionName: c.row.institution_name,
    readable: false,
    accounts: [],
  }));
}

function accountView(account: BankRead["accounts"][number]): SharedAccountView {
  // The read passes Plaid's name through unchecked; the screen trusts an
  // answer only when every name is a string, so one that is not is sent
  // empty rather than dropping the whole list.
  const name: unknown = account.name;
  return {
    name: typeof name === "string" ? name : "",
    mask: account.mask,
    type: account.type,
    subtype: account.subtype,
    currentCents: account.currentCents,
    availableCents: account.availableCents,
    currency: typeof account.currency === "string" ? account.currency : null,
  };
}

/**
 * Why an owner's read threw, from the crypto module's reason when the error
 * is its own: the same source the read's per-connection log line uses.
 * Never the error's message.
 */
function readFailureReason(error: unknown): string {
  return isPlaidTokenCryptoError(error) ? error.reason : "unknown";
}

/**
 * One owner's connections, read together with that owner's id. A read that
 * throws, or one that had not finished when the reads were cancelled, makes
 * every connection of that owner unreadable.
 */
async function readGroup(
  group: OwnerGroup,
  readOwner: OwnerRead | null,
  signal: AbortSignal,
  log: HouseholdLog
): Promise<SharedConnectionView[]> {
  if (readOwner === null) return unreadable(group.connections);
  let read: Pick<BankRead, "connections" | "accounts">;
  try {
    read = await readOwner(
      group.ownerUserId,
      group.connections.map((c) => c.row),
      signal
    );
  } catch (error: unknown) {
    logLine(log, "owner_read_failed", ` reason=${logSafeCode(readFailureReason(error))}`);
    return unreadable(group.connections);
  }
  if (signal.aborted) {
    logLine(log, "owner_read_cancelled");
    return unreadable(group.connections);
  }
  return group.connections.map((c, k) => {
    const status = read.connections[k];
    const readable =
      status !== undefined && status.itemId === c.row.item_id && status.status === "ok";
    return {
      institutionName: c.row.institution_name,
      readable,
      accounts: readable
        ? read.accounts.filter((a) => a.itemId === c.row.item_id).map(accountView)
        : [],
    };
  });
}

function stillShared(rows: SharedConnection[]): Record<string, true> {
  const keys: Record<string, true> = {};
  for (let i = 0; i < rows.length; i++) {
    keys[`${rows[i].ownerUserId}:${rows[i].connectionId}`] = true;
  }
  return keys;
}

export async function viewSharedAccounts(
  userId: string,
  deps: SharedAccountsDeps
): Promise<HouseholdResult> {
  const { store, readOwner, log } = deps;
  if (deps.mode === "off") return ok([]);

  const first = await store.readSharedConnections(userId);
  if (!first.ok) {
    logLine(log, "read_failed", ` code=${logSafeCode(first.code)}`);
    return serverError();
  }
  if (first.value.length === 0) return ok([]);

  const groups = groupByOwner(first.value);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? SHARED_ACCOUNTS_READ_TIMEOUT_MS
  );
  let views: SharedConnectionView[][];
  try {
    views = await Promise.all(
      groups.map((g) => readGroup(g, readOwner, controller.signal, log))
    );
  } finally {
    clearTimeout(timer);
  }

  // Sharing can end while the banks are read. Answer only what the function
  // still returns, by owner and connection id.
  const again = await store.readSharedConnections(userId);
  if (!again.ok) {
    logLine(log, "recheck_failed", ` code=${logSafeCode(again.code)}`);
    return serverError();
  }
  const kept = stillShared(again.value);

  const answered: Array<{ ownerUserId: string; connections: SharedConnectionView[] }> = [];
  let dropped = 0;
  for (let g = 0; g < groups.length; g++) {
    const connections: SharedConnectionView[] = [];
    for (let k = 0; k < groups[g].connections.length; k++) {
      const c = groups[g].connections[k];
      if (kept[`${c.ownerUserId}:${c.connectionId}`] === true) {
        connections.push(views[g][k]);
      } else {
        dropped += 1;
      }
    }
    if (connections.length > 0) {
      answered.push({ ownerUserId: groups[g].ownerUserId, connections });
    }
  }

  let names: Record<string, string | null> = {};
  if (answered.length > 0) {
    const read = await store.readFirstNames(answered.map((o) => o.ownerUserId));
    if (read.ok) {
      names = read.value;
    } else {
      // The list is still answered; each owner shows without a name.
      logLine(log, "names_failed", ` code=${logSafeCode(read.code)}`);
    }
  }

  const owners: SharedOwnerView[] = answered.map((o) => ({
    firstName: Object.prototype.hasOwnProperty.call(names, o.ownerUserId)
      ? names[o.ownerUserId]
      : null,
    connections: o.connections,
  }));

  let connectionCount = 0;
  let unreadableCount = 0;
  for (let i = 0; i < owners.length; i++) {
    for (let k = 0; k < owners[i].connections.length; k++) {
      connectionCount += 1;
      if (!owners[i].connections[k].readable) unreadableCount += 1;
    }
  }
  logLine(
    log,
    "read",
    ` owners=${owners.length} connections=${connectionCount} unreadable=${unreadableCount} dropped=${dropped}`
  );
  return ok(owners);
}
