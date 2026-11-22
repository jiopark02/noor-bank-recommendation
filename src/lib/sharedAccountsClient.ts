import type { SessionReadResult } from "./supabase-browser";
import { HOUSEHOLD_UI } from "./householdCopy";
import { formatCentsOrDash } from "./bankSummaryView";
import { householdCall, isOk, type HouseholdHttp } from "./householdClient";

/**
 * The browser side of GET /api/household/shared-accounts: reading the answer
 * and deciding what the dashboard's shared-accounts list shows. Decisions
 * only; SharedAccounts.tsx renders them.
 *
 * An answer is used only when every part of it has the expected shape;
 * anything else shows the list as unavailable, never as empty. A connection
 * that could not be read shows a sentence where its amounts would be; one
 * that was read and has no account says so. An amount is shown in dollars
 * only when its currency is USD; otherwise a dash and the currency code (or,
 * when the code is not given or blank, that the currency is unknown) stand
 * in its place, so no figure is shown in a unit it is not in. A blank
 * subtype, type or mask counts as not given. An amount the answer does not give shows as a
 * dash, never as zero. An account with an empty name shows a stand-in name.
 * No total is computed. Nothing is written to browser storage.
 */

/**
 * How long the list waits for its answer, session read included. The route
 * calls Plaid and cancels its reads after SHARED_ACCOUNTS_READ_TIMEOUT_MS
 * (householdSharedAccounts.ts); before and after them it authenticates and
 * reads the database, which nothing in code bounds. This adds a margin over
 * the read limit for those, so the list does not give up on an answer the
 * route is about to send. A test holds the margin. The list renders nothing
 * while it waits, so a longer wait shows nothing more on the card.
 */
export const SHARED_ACCOUNTS_FETCH_TIMEOUT_MS = 20_000;

export type SharedAccount = {
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentCents: number | null;
  availableCents: number | null;
  currency: string | null;
};

export type SharedConnection = {
  institutionName: string | null;
  readable: boolean;
  accounts: SharedAccount[];
};

export type SharedOwner = {
  firstName: string | null;
  connections: SharedConnection[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCentsOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value));
}

function readAccount(raw: unknown): SharedAccount | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.name !== "string" ||
    !isStringOrNull(raw.mask) ||
    typeof raw.type !== "string" ||
    !isStringOrNull(raw.subtype) ||
    !isCentsOrNull(raw.currentCents) ||
    !isCentsOrNull(raw.availableCents) ||
    !isStringOrNull(raw.currency)
  ) {
    return null;
  }
  return {
    name: raw.name,
    mask: raw.mask,
    type: raw.type,
    subtype: raw.subtype,
    currentCents: raw.currentCents,
    availableCents: raw.availableCents,
    currency: raw.currency,
  };
}

function readConnection(raw: unknown): SharedConnection | null {
  if (!isRecord(raw)) return null;
  if (!isStringOrNull(raw.institutionName) || typeof raw.readable !== "boolean") return null;
  if (!Array.isArray(raw.accounts)) return null;
  // An unreadable connection carries no accounts; one that does is not trusted.
  if (!raw.readable && raw.accounts.length > 0) return null;
  const accounts: SharedAccount[] = [];
  for (let i = 0; i < raw.accounts.length; i++) {
    const account = readAccount(raw.accounts[i]);
    if (account === null) return null;
    accounts.push(account);
  }
  return { institutionName: raw.institutionName, readable: raw.readable, accounts };
}

/** The owners in the answer, or null when any part of it is not in shape. */
export function readSharedAccounts(body: Record<string, unknown>): SharedOwner[] | null {
  const s = body.sharedAccounts;
  if (!isRecord(s) || !Array.isArray(s.owners)) return null;
  const owners: SharedOwner[] = [];
  for (let i = 0; i < s.owners.length; i++) {
    const raw: unknown = s.owners[i];
    if (!isRecord(raw) || !isStringOrNull(raw.firstName) || !Array.isArray(raw.connections)) {
      return null;
    }
    const connections: SharedConnection[] = [];
    for (let k = 0; k < raw.connections.length; k++) {
      const connection = readConnection(raw.connections[k]);
      if (connection === null) return null;
      connections.push(connection);
    }
    const name = raw.firstName;
    owners.push({
      firstName: typeof name === "string" && name.trim() !== "" ? name : null,
      connections,
    });
  }
  return owners;
}

/**
 * Reads the session and GET /api/household/shared-accounts under
 * SHARED_ACCOUNTS_FETCH_TIMEOUT_MS. Null for anything but a 2xx answer in
 * shape, for a passed limit (the request is aborted) and for a throw. Never
 * rejects.
 */
export function loadSharedAccounts(
  read: () => Promise<SessionReadResult>,
  http: HouseholdHttp,
  timeoutMs: number = SHARED_ACCOUNTS_FETCH_TIMEOUT_MS
): Promise<SharedOwner[] | null> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (data: SharedOwner[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(null);
    }, timeoutMs);
    (async () => {
      try {
        const session = await read();
        if (controller.signal.aborted) return;
        const outcome = await householdCall(
          session,
          http,
          "/api/household/shared-accounts",
          "GET",
          undefined,
          controller.signal
        );
        finish(isOk(outcome) ? readSharedAccounts(outcome.body) : null);
      } catch {
        finish(null);
      }
    })();
  });
}

export type SharedAccountLine = {
  key: string;
  name: string;
  /** Kind of account, and the last four digits when known. */
  detail: string;
  current: string;
  available: string;
};

export type SharedBankLine = {
  key: string;
  bank: string;
  /** The sentence shown instead of amounts; null when the bank was read. */
  unreadable: string | null;
  /** The sentence shown when the bank was read and has no account; null otherwise. */
  empty: string | null;
  accounts: SharedAccountLine[];
};

export type SharedOwnerLine = {
  key: string;
  owner: string;
  banks: SharedBankLine[];
};

export type SharedAccountsView =
  | { kind: "loading" }
  | { kind: "nothing" }
  | { kind: "unavailable"; text: string }
  | { kind: "list"; title: string; owners: SharedOwnerLine[] };

function nonBlank(value: string | null): string | null {
  return value !== null && value.trim() !== "" ? value.trim() : null;
}

/** The subtype when given, else the type, else "Account"; blanks count as not given. */
function kindLabel(account: SharedAccount): string {
  const raw = nonBlank(account.subtype) ?? nonBlank(account.type);
  if (raw === null) return "Account";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** The kind, and the last four digits when a non-blank mask is given. */
function detailText(account: SharedAccount): string {
  const mask = nonBlank(account.mask);
  return mask === null ? kindLabel(account) : `${kindLabel(account)} · ****${mask}`;
}

/**
 * An amount in dollars only when its currency is USD. In any other currency
 * a dash and the code stand in for it; when the code is not given or is
 * blank, a dash and that the currency is unknown. No dollar sign is put on a
 * figure in another unit, and a dash never stands alone for the unit.
 */
function amountText(cents: number | null, currency: string | null): string {
  if (currency === "USD") return formatCentsOrDash(cents);
  return `— ${nonBlank(currency) ?? HOUSEHOLD_UI.sharedAccountsUnknownCurrency}`;
}

function accountName(name: string): string {
  return name.trim() === "" ? HOUSEHOLD_UI.sharedAccountsUnnamedAccount : name;
}

/** What the list shows for a load's result: null is a failed load. */
export function sharedAccountsView(owners: SharedOwner[] | null): SharedAccountsView {
  if (owners === null) {
    return { kind: "unavailable", text: HOUSEHOLD_UI.sharedAccountsUnavailable };
  }
  if (owners.length === 0) return { kind: "nothing" };
  return {
    kind: "list",
    title: HOUSEHOLD_UI.sharedAccountsTitle,
    owners: owners.map((owner, o) => ({
      key: `o${o}`,
      owner: HOUSEHOLD_UI.sharedAccountsFrom(owner.firstName),
      banks: owner.connections.map((connection, b) => ({
        key: `o${o}-b${b}`,
        bank:
          connection.institutionName && connection.institutionName.trim() !== ""
            ? connection.institutionName
            : HOUSEHOLD_UI.sharedAccountsUnnamedBank,
        unreadable: connection.readable ? null : HOUSEHOLD_UI.sharedAccountsUnreadable,
        empty:
          connection.readable && connection.accounts.length === 0
            ? HOUSEHOLD_UI.sharedAccountsNoAccounts
            : null,
        accounts: connection.readable
          ? connection.accounts.map((account, a) => ({
              key: `o${o}-b${b}-a${a}`,
              name: accountName(account.name),
              detail: detailText(account),
              current: amountText(account.currentCents, account.currency),
              available: `${HOUSEHOLD_UI.sharedAccountsAvailable} ${amountText(account.availableCents, account.currency)}`,
            }))
          : [],
      })),
    })),
  };
}
