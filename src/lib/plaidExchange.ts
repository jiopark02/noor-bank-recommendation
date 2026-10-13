import type { ConnectionLookup, PlaidConnectionStore } from "./plaidApiUtils";
import { getPlaidErrorCode, getPlaidErrorType } from "./plaidErrorRedaction";
import {
  classifyItemRemoveRejection,
  logField,
  plaidTokenEnvironment,
} from "./plaidRevocation";

/**
 * The decision half of POST /api/plaid/exchange-token — every branch, none of
 * the IO.
 *
 * WHY THIS IS NOT IN THE ROUTE
 * The exchange mints a real Plaid Item, and its access token exists only in this
 * request until a row holds it. If anything after the exchange fails and the
 * Item is simply abandoned, it stays live at Plaid with nothing in our database
 * able to revoke it. The guarantees that close that gap are about calls that DO
 * or DO NOT happen — "itemRemove ran after a failed save", "itemRemove never ran
 * for an Item this user already had" — so they are executed by
 * plaidExchange.test.ts with injected fakes, the way accountDeletion.ts and
 * plaidRevocation.ts are tested. The route only builds the real dependencies.
 *
 * THE ORDER, FROM RECOVERABLE TO IRREVERSIBLE
 *   1. Connection limit      — read fails closed; nothing has been minted yet
 *   2. Duplicate (client id) — read fails open; step 6 backs it up
 *   3. Exchange              — mints the Item
 *   4. Ownership             — does this user already have a row for the Item?
 *   5. itemGet               — Plaid's own institution id and name
 *   6. Duplicate (server id) — read fails closed
 *   7. Store                 — encrypt + insert
 *
 * ⚠️ AN ITEM THIS USER ALREADY HAS IS NEVER REVOKED HERE. An older client that
 * exchanges the public token from an update-mode Link session gets back an
 * item_id that is already in one of this user's rows, and revoking it would
 * destroy a working connection while its row stays behind. So the compensating
 * revocation is only constructed after step 4 has CONFIRMED that no row for this
 * Item exists; when that read fails, nothing is revoked and the request stops.
 * The cost of that direction is a possible orphaned Item, which the log line
 * names so it can be cleaned up by hand.
 *
 * Plaintext tokens pass through this module but are never logged and never put
 * in a response body. It does not read the stored token column, which is why it
 * is not on plaidTokenReadSites.test.ts' list; the Plaid SDK calls themselves
 * live in the route.
 */

/** The most plaid_connections rows one user may hold, whatever their status. */
export const CONNECTION_LIMIT = 5;

export type ExchangeInput = {
  publicToken: string;
  /** From the client's Link metadata. Used only for the pre-exchange check. */
  institutionId?: string;
  /** From the client's Link metadata. A fallback when Plaid reports no name. */
  institutionName?: string;
};

/** The subset of a stored row this module reads. */
export type StoredConnectionView = {
  institution_name?: unknown;
  institution_id?: unknown;
};

export type ExchangeDeps = {
  /** null means the count could not be read. */
  countConnections: (userId: string) => Promise<number | null>;
  /** Throws when the read fails; null when there is no such active row. */
  findActiveByInstitution: (
    userId: string,
    institutionId: string,
    excludeItemId?: string
  ) => Promise<StoredConnectionView | null>;
  /** Rejects with the Plaid error when the exchange is refused. */
  exchange: (
    publicToken: string
  ) => Promise<{ accessToken: string; itemId: string }>;
  itemGet: (
    accessToken: string
  ) => Promise<{ institutionId: string | null; institutionName: string | null }>;
  /** The user's row for this item_id; `{ ok: false }` when the read failed. */
  findOwnItem: (
    userId: string,
    itemId: string
  ) => Promise<ConnectionLookup<StoredConnectionView>>;
  /** Encrypts and inserts. Reports every failure by kind; never throws. */
  store: (
    userId: string,
    accessToken: string,
    itemId: string,
    institutionName: string,
    institutionId: string | null
  ) => Promise<PlaidConnectionStore>;
  /** Revokes the Item. Resolves with Plaid's request_id or null. */
  itemRemove: (accessToken: string) => Promise<string | null>;
  /** The environment this deployment talks to (PLAID_ENVIRONMENT). */
  plaidEnvironment: string;
  /** Defaults to console.error. Injected so tests can read the lines. */
  log?: (line: string) => void;
};

export type ExchangeOutcome =
  | { kind: "response"; status: number; body: Record<string, unknown> }
  /** The exchange itself was refused; the route maps it with handlePlaidError. */
  | { kind: "plaid_error"; error: unknown };

const RETRY_MESSAGE =
  "We couldn't add your bank right now. Please try again in a moment.";
const SAVE_FAILED_MESSAGE = "Failed to save connection. Please try again.";
const DUPLICATE_MESSAGE = "This bank is already connected to your account.";
const UNKNOWN_INSTITUTION = "Unknown Institution";

function emit(deps: ExchangeDeps, line: string): void {
  if (deps.log) {
    deps.log(line);
    return;
  }
  console.error(line);
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function respond(
  status: number,
  body: Record<string, unknown>
): ExchangeOutcome {
  return { kind: "response", status, body };
}

function failure(status: number, code: string, message: string): ExchangeOutcome {
  return respond(status, { error: message, code });
}

/**
 * 409 ALREADY_CONNECTED, in the shape the money screen already reads (it keys on
 * the status or the code and shows `institutionName`). `error` carries the same
 * sentence for callers that only read that key.
 */
function duplicate(institutionName: string): ExchangeOutcome {
  return respond(409, {
    duplicate: true,
    code: "ALREADY_CONNECTED",
    institutionName,
    message: DUPLICATE_MESSAGE,
    error: DUPLICATE_MESSAGE,
  });
}

function connected(
  itemId: string,
  institutionId: string | null,
  institutionName: string
): ExchangeOutcome {
  return respond(200, {
    success: true,
    itemId,
    institutionId,
    institutionName,
    message: "Bank account connected successfully",
  });
}

async function readOwnItem(
  deps: ExchangeDeps,
  userId: string,
  itemId: string
): Promise<ConnectionLookup<StoredConnectionView>> {
  try {
    return await deps.findOwnItem(userId, itemId);
  } catch {
    return { ok: false };
  }
}

/**
 * Revoke an Item that was minted by this request and never stored.
 *
 * There is no row, so revokeAndDeleteConnection does not fit: it decrypts a
 * stored token and deletes a row. What is shared with it is the decision about
 * a rejection — classifyItemRemoveRejection, so "already gone" means exactly
 * what it means there — and the log-field bounding.
 *
 * A failure here is logged and NOT surfaced differently to the user: the
 * request is already being refused, the bank is not connected either way, and
 * nothing the user does can revoke the Item. The `compensate=failed` line is the
 * only record of a live Item that no row points at.
 */
async function compensateRevoke(
  deps: ExchangeDeps,
  prefix: string,
  accessToken: string
): Promise<void> {
  try {
    const requestId = await deps.itemRemove(accessToken);
    emit(deps, `${prefix} compensate=revoked request_id=${logField(requestId)}`);
  } catch (error) {
    const verdict = classifyItemRemoveRejection(
      error,
      plaidTokenEnvironment(accessToken),
      deps.plaidEnvironment
    );
    if (verdict.itemAlreadyGone) {
      emit(deps, `${prefix} compensate=item_not_found`);
      return;
    }
    const mismatch = verdict.envMismatch
      ? ` reason=env_mismatch token_env=${verdict.tokenEnvironment} ` +
        `server_env=${deps.plaidEnvironment}`
      : "";
    emit(
      deps,
      `${prefix} compensate=failed ` +
        `error_code=${logField(getPlaidErrorCode(error))} ` +
        `error_type=${logField(getPlaidErrorType(error))}` +
        mismatch
    );
  }
}

export async function exchangeForUser(
  userId: string,
  input: ExchangeInput,
  deps: ExchangeDeps
): Promise<ExchangeOutcome> {
  const userPrefix = `[plaid-exchange] user_id=${userId}`;

  // 1. Connection limit. Before anything is minted, so refusing costs nothing.
  // A failed count is a refusal: read as 0 it would wave the limit through.
  let count: number | null;
  try {
    count = await deps.countConnections(userId);
  } catch {
    count = null;
  }
  if (count === null) {
    emit(deps, `${userPrefix} refused=limit_read`);
    return failure(503, "CONNECTION_CHECK_FAILED", RETRY_MESSAGE);
  }
  if (count >= CONNECTION_LIMIT) {
    emit(deps, `${userPrefix} refused=limit count=${count}`);
    return failure(
      422,
      "CONNECTION_LIMIT_REACHED",
      `You can connect up to ${CONNECTION_LIMIT} banks. Remove one to add another.`
    );
  }

  // 2. Duplicate check on the client's institution id. Fails open: step 6
  // repeats it with Plaid's own value and fails closed.
  const clientInstitutionId = nonEmpty(input.institutionId);
  const clientInstitutionName = nonEmpty(input.institutionName);
  if (clientInstitutionId) {
    try {
      const existing = await deps.findActiveByInstitution(
        userId,
        clientInstitutionId
      );
      if (existing) {
        return duplicate(
          nonEmpty(existing.institution_name) ??
            clientInstitutionName ??
            "This bank"
        );
      }
    } catch {
      emit(deps, `${userPrefix} dedupe_read=failed stage=pre proceeding=true`);
    }
  }

  // 3. Exchange. A refusal here minted nothing, so there is nothing to revoke.
  let minted: { accessToken: string; itemId: string };
  try {
    minted = await deps.exchange(input.publicToken);
  } catch (error) {
    return { kind: "plaid_error", error };
  }
  const { accessToken, itemId } = minted;
  const prefix = `${userPrefix} item_id=${itemId}`;

  // 4. Ownership. One retry: the read is idempotent and a single transient
  // failure is the common case.
  let own = await readOwnItem(deps, userId, itemId);
  if (!own.ok) {
    own = await readOwnItem(deps, userId, itemId);
  }
  if (!own.ok) {
    emit(deps, `${prefix} failure=ownership_read revoke=skipped`);
    return failure(503, "CONNECTION_CHECK_FAILED", RETRY_MESSAGE);
  }
  if (own.connection) {
    // Already stored for this user — an update-mode token from an older
    // client. Nothing to save and nothing to revoke.
    emit(deps, `${prefix} resolved=already_stored`);
    return connected(
      itemId,
      nonEmpty(own.connection.institution_id),
      nonEmpty(own.connection.institution_name) ??
        clientInstitutionName ??
        UNKNOWN_INSTITUTION
    );
  }

  // From here on the Item is known to be new to this user, so revoking it on a
  // refusal is safe. This closure is the only way this function revokes.
  const refuse = async (
    reason: string,
    outcome: ExchangeOutcome
  ): Promise<ExchangeOutcome> => {
    emit(deps, `${prefix} refused=${reason}`);
    await compensateRevoke(deps, prefix, accessToken);
    return outcome;
  };

  // 5. Plaid's own institution id and name.
  let item: { institutionId: string | null; institutionName: string | null };
  try {
    item = await deps.itemGet(accessToken);
  } catch {
    return refuse(
      "item_get",
      failure(503, "INSTITUTION_LOOKUP_FAILED", RETRY_MESSAGE)
    );
  }
  const serverInstitutionId = nonEmpty(item.institutionId);
  const serverInstitutionName = nonEmpty(item.institutionName);
  const institutionName =
    serverInstitutionName ?? clientInstitutionName ?? UNKNOWN_INSTITUTION;

  // 6. Duplicate check on Plaid's institution id. Fails closed. Skipped when
  // Plaid reports no institution: the row is then stored with a NULL id, and
  // the client's id is never stored in its place.
  if (serverInstitutionId) {
    let existing: StoredConnectionView | null;
    try {
      existing = await deps.findActiveByInstitution(
        userId,
        serverInstitutionId,
        itemId
      );
    } catch {
      return refuse(
        "dedupe_read",
        failure(503, "CONNECTION_CHECK_FAILED", RETRY_MESSAGE)
      );
    }
    if (existing) {
      return refuse(
        "post_duplicate",
        duplicate(
          nonEmpty(existing.institution_name) ??
            serverInstitutionName ??
            "This bank"
        )
      );
    }
  }

  // 7. Store.
  let stored: PlaidConnectionStore;
  try {
    stored = await deps.store(
      userId,
      accessToken,
      itemId,
      institutionName,
      serverInstitutionId
    );
  } catch {
    stored = { ok: false, kind: "db", dbErrorCode: null };
  }

  if (stored.ok) {
    emit(deps, `${prefix} resolved=stored`);
    return connected(itemId, serverInstitutionId, institutionName);
  }

  if (stored.kind === "duplicate_item") {
    // A row for this Item appeared between step 4 and the insert. It is this
    // user's Item now, so it is not revoked — but success is reported only once
    // the row is actually seen.
    const confirm = await readOwnItem(deps, userId, itemId);
    if (confirm.ok && confirm.connection) {
      emit(deps, `${prefix} resolved=already_stored stage=insert`);
      return connected(
        itemId,
        nonEmpty(confirm.connection.institution_id),
        nonEmpty(confirm.connection.institution_name) ?? institutionName
      );
    }
    emit(
      deps,
      `${prefix} refused=store_conflict db_error=${logField(stored.dbErrorCode)} ` +
        `revoke=skipped`
    );
    return failure(500, "CONNECTION_SAVE_FAILED", SAVE_FAILED_MESSAGE);
  }

  return refuse(
    stored.kind === "crypto"
      ? "store_crypto"
      : `store_db db_error=${logField(stored.dbErrorCode)}`,
    failure(500, "CONNECTION_SAVE_FAILED", SAVE_FAILED_MESSAGE)
  );
}
