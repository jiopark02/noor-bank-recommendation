import type {
  EngineAccount,
  EngineConnection,
  EngineInput,
  EngineRecurringStream,
} from "./types";
import { parseTimestampMs } from "./dates";

/** How many copies of each kind were left out because their account was a duplicate. */
export interface DuplicateCopiesDropped {
  accounts: number;
  transactions: number;
  streams: number;
}

function hasKey(a: EngineAccount | null | undefined): a is EngineAccount {
  return (
    !!a &&
    typeof a.duplicateKey === "string" &&
    a.duplicateKey !== "" &&
    typeof a.connectionKey === "string" &&
    typeof a.accountId === "string" &&
    a.accountId !== ""
  );
}

/** A newer valid timestamp ranks first; an invalid or missing one ranks last. */
function compareNewest(a: string | null, b: string | null): number {
  const ta = parseTimestampMs(a);
  const tb = parseTimestampMs(b);
  if (ta === tb) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
}

/**
 * Each connection's last successful update, by connection key. An entry that
 * is not a connection is skipped. A key listed more than once is recorded as
 * unknown: taking the first would make the answer depend on list order.
 */
function lastUpdateByConnection(
  connections: ReadonlyArray<EngineConnection | null | undefined>
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const repeated = new Set<string>();
  for (let i = 0; i < connections.length; i++) {
    const c = connections[i];
    if (!c || typeof c.connectionKey !== "string") continue;
    if (out.has(c.connectionKey)) {
      repeated.add(c.connectionKey);
      continue;
    }
    out.set(c.connectionKey, typeof c.lastSuccessfulUpdate === "string" ? c.lastSuccessfulUpdate : null);
  }
  repeated.forEach((key) => out.set(key, null));
  return out;
}

/**
 * Which copy of one bank account to keep: the one whose balance the
 * institution measured most recently, then the one whose connection the
 * institution last updated most recently, then the smaller account id, so the
 * choice never depends on the order the connections were read in. A missing
 * or invalid time, or a connection that cannot be found, ranks last.
 *
 * When our server received each copy (fetchedAt) is not compared: the
 * connections are read in parallel, so it records which answer arrived
 * first, not which data is fresher.
 */
function compareCopies(
  a: EngineAccount,
  b: EngineAccount,
  lastUpdate: ReadonlyMap<string, string | null>
): number {
  const byAsOf = compareNewest(a.balanceAsOf, b.balanceAsOf);
  if (byAsOf !== 0) return byAsOf;
  const byConnection = compareNewest(
    lastUpdate.get(a.connectionKey) ?? null,
    lastUpdate.get(b.connectionKey) ?? null
  );
  if (byConnection !== 0) return byConnection;
  return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
}

function keepStream(s: EngineRecurringStream | null | undefined, dropped: Set<string>): boolean {
  return !(s && typeof s.accountId === "string" && dropped.has(s.accountId));
}

/**
 * The same bank account reached through two connections (the same bank
 * linked twice) appears twice, with the same duplicate key. One copy is kept
 * and the others are left out, together with their transactions and
 * recurring streams, so nothing is counted twice.
 *
 * Only copies on different connections are merged. An account with no key
 * is never merged, and neither is a key that appears more than once on one
 * connection: two accounts that look alike inside one Item are taken to be
 * two accounts. Pure: the input is not changed.
 */
export function dropDuplicateAccountCopies(input: EngineInput): {
  input: EngineInput;
  dropped: DuplicateCopiesDropped;
} {
  // key -> connection -> accounts with that key on that connection
  const byKey = new Map<string, Map<string, EngineAccount[]>>();
  for (let i = 0; i < input.accounts.length; i++) {
    const a = input.accounts[i];
    if (!hasKey(a)) continue;
    let perConnection = byKey.get(a.duplicateKey as string);
    if (!perConnection) {
      perConnection = new Map<string, EngineAccount[]>();
      byKey.set(a.duplicateKey as string, perConnection);
    }
    const list = perConnection.get(a.connectionKey);
    if (list) list.push(a);
    else perConnection.set(a.connectionKey, [a]);
  }

  const lastUpdate = lastUpdateByConnection(input.connections);
  const droppedIds = new Set<string>();
  byKey.forEach((perConnection) => {
    if (perConnection.size < 2) return;
    const copies: EngineAccount[] = [];
    let ambiguous = false;
    perConnection.forEach((list) => {
      if (list.length > 1) ambiguous = true;
      copies.push(list[0]);
    });
    if (ambiguous) return;
    copies.sort((x, y) => compareCopies(x, y, lastUpdate));
    for (let i = 1; i < copies.length; i++) {
      // A copy sharing the kept copy's id is the same account, not a duplicate.
      if (copies[i].accountId !== copies[0].accountId) droppedIds.add(copies[i].accountId);
    }
  });

  if (droppedIds.size === 0) {
    return { input, dropped: { accounts: 0, transactions: 0, streams: 0 } };
  }

  const accounts = input.accounts.filter((a) => !(a && droppedIds.has(a.accountId)));
  const transactions = input.transactions.filter(
    (t) => !(t && typeof t.accountId === "string" && droppedIds.has(t.accountId))
  );
  const streams = input.recurring.streams.filter((s) => keepStream(s, droppedIds));
  const incomeStreams = input.recurring.incomeStreams.filter((s) => keepStream(s, droppedIds));

  return {
    input: {
      ...input,
      accounts,
      transactions,
      recurring: { streams, incomeStreams },
    },
    dropped: {
      accounts: input.accounts.length - accounts.length,
      transactions: input.transactions.length - transactions.length,
      streams:
        input.recurring.streams.length -
        streams.length +
        (input.recurring.incomeStreams.length - incomeStreams.length),
    },
  };
}
