import type { ConnectionLookup, PlaidConnectionStore } from "./plaidApiUtils";
import { getPlaidErrorCode, getPlaidErrorType } from "./plaidErrorRedaction";
import {
  classifyItemRemoveRejection,
  logField,
  plaidTokenEnvironment,
  writeLogLine,
  type LogLevel,
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
 * ⚠️ AN ITEM THIS USER ALREADY HAS IS NEVER REVOKED HERE. Revoking an Item that
 * a row points at would destroy a working connection while its row stays
 * behind. Step 4 reads the user's row for the Item, and the compensating
 * revocation is reachable only after that read found none; when it fails,
 * nothing is revoked and the request stops.
 *
 * WHEN STEP 4'S ANSWER CAN GO STALE
 * A Plaid public token can be exchanged only once, so no other request can be
 * holding this Item: between step 4 and the insert, nothing else can create its
 * row. Every refusal before the insert (steps 5 and 6) therefore revokes on
 * step 4's answer, as does a store that failed before inserting (`crypto`) or
 * one the server rejected with a SQLSTATE (isDefiniteDbRejection). The one case
 * that can have committed anyway is a store failure without such a code — a
 * transport error, a throw, a PostgREST code of its own, or one of the
 * SQLSTATEs isDefiniteDbRejection leaves ambiguous (08, 40003, 57P, 58, XX).
 * For that case only, the row is read again (one retry): a row means the bank
 * is connected and the answer is 200 with the row's values; no row means
 * revoke and 500; two failed reads mean no revocation, 500, and
 * `revoke=skipped reason=recheck_read_failed`. The cost of that direction is a
 * possible orphaned Item, which the log line names so it can be cleaned up by
 * hand.
 *
 * Remaining risk: if the re-read finds no row and the Item is revoked, and the
 * original insert commits only after that, a row is left pointing at a revoked
 * Item. Without a lock spanning the insert and the re-read this cannot be
 * prevented here.
 *
 * Older clients that still exchange the public token after a re-link: the
 * update-mode token is normally never exchanged, because the pre-exchange
 * duplicate check answers 409 (or the limit check, which runs first, 422), and
 * nothing is revoked. That is still the false "failed" message the client fix
 * removed, not a tolerated path. Only when the pre-exchange check cannot match
 * does the exchange run, and step 4 then finds the row (that read does not
 * filter on status). It cannot match when the metadata carries no institution
 * id, when the stored row's id is NULL, when the stored row's status is not
 * `active`, or when the pre-exchange read itself failed (it fails open).
 *
 * LOG PAIRING
 * Every successful exchange logs `[plaid-exchange] user_id=… item_id=… minted`
 * before anything else is decided. `minted` means the exchange succeeded, not
 * that the Item is new: an Item this user already has is minted too. Each
 * minted line is followed, for the same item_id, by at least one line carrying
 * `resolved=`, `compensate=`, `revoke=skipped` or `refused=`. A minted line with
 * none of these after it means the request died between the exchange and its
 * outcome, and the Item may be live with no row. `refused=` appears only when
 * the final answer is a refusal; an ambiguous store failure first logs
 * `store_failed db_error=…` and ends with `resolved=already_stored
 * stage=recheck`, with `refused=store_db …` and a `compensate=` line, or with
 * `refused=store_db … revoke=skipped reason=recheck_read_failed`.
 *
 * Institution names are capped at INSTITUTION_NAME_MAX code points: the
 * client's name when it is read, the chosen name again before it is stored,
 * and every name in a response, inside duplicate() and connected(). The last
 * covers names that come from Plaid in the post-exchange 409 and from stored
 * rows. A name already stored longer than the cap stays as it is in the
 * database; only the response is cut. The number matches sanitizePlaidLabel
 * (plaidChatContext.ts), which counts UTF-16 code units instead, so a name with
 * characters outside the BMP can be cut shorter there.
 *
 * Plaintext tokens pass through this module but are never logged and never put
 * in a response body. It does not read the stored token column, which is why it
 * is not on plaidTokenReadSites.test.ts' list; the Plaid SDK calls themselves
 * live in the route.
 */

/** The most plaid_connections rows one user may hold, whatever their status. */
export const CONNECTION_LIMIT = 5;

export const CONNECTION_LIMIT_CODE = "CONNECTION_LIMIT_REACHED";
const CONNECTION_LIMIT_MESSAGE = `You can connect up to ${CONNECTION_LIMIT} banks. Remove one to add another.`;

/**
 * The same limit, checked by create-link-token before Link opens, so a user at
 * the limit is not walked through their bank's login only to be refused.
 *
 * FAILS OPEN, unlike the check in exchangeForUser: a count that could not be
 * read (null) lets Link open. This check only spares the user a wasted Link
 * session; the fail-closed check before the exchange is the one that holds the
 * limit.
 *
 * Re-link link tokens come from /api/plaid/relink, which does not call this, so
 * a user at the limit can still repair an existing connection.
 */
export function linkLimitRefusal(
  count: number | null
): { status: 422; body: { error: string; code: string } } | null {
  if (count === null || count < CONNECTION_LIMIT) {
    return null;
  }
  return {
    status: 422,
    body: { error: CONNECTION_LIMIT_MESSAGE, code: CONNECTION_LIMIT_CODE },
  };
}

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
  /**
   * Defaults to console.error, console.warn or console.info by the line's
   * level (writeLogLine). Injected so tests can read the lines; an injected
   * log gets the line only.
   */
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

/** The institution name's cap in code points; the number sanitizePlaidLabel uses. */
export const INSTITUTION_NAME_MAX = 80;

/** Cut by code point, so a character outside the BMP is never split in half. */
function capName(value: string): string;
function capName(value: string | null): string | null;
function capName(value: string | null): string | null {
  if (value === null) return null;
  return Array.from(value).slice(0, INSTITUTION_NAME_MAX).join("");
}

/**
 * Whether a failed insert's code proves the row was NOT committed.
 *
 * True only for a PostgreSQL SQLSTATE the server sent while rejecting the
 * statement: five characters of 0-9/A-Z, in a class that starts with a digit or
 * is F0, HV or P0. That shape excludes node errno codes ("EPIPE" is five
 * letters too) and PostgREST's own codes ("PGRST…"); nothing in this repo or in
 * its types says what a PGRST code implies about the commit, so it stays
 * ambiguous.
 *
 * Also ambiguous, though they are SQLSTATEs: codes where the error can arrive
 * after the commit already happened, or where the server itself says it does
 * not know — 08 (connection exception), 40003 (statement_completion_unknown),
 * 57P (the session was terminated), 58 (system error) and XX (internal error).
 * The rest of class 40 (40001 serialization failure, 40P01 deadlock) rolls the
 * transaction back and stays definite. Calling one of those ambiguous costs a
 * re-read; calling it definite could revoke an Item whose row exists.
 */
export function isDefiniteDbRejection(code: string | null): boolean {
  if (code === null || !/^[0-9A-Z]{5}$/.test(code)) return false;
  const sqlClass = code.slice(0, 2);
  if (
    sqlClass === "08" ||
    sqlClass === "58" ||
    code === "40003" ||
    code.slice(0, 3) === "57P"
  ) {
    return false;
  }
  return /^[0-9]/.test(sqlClass) || sqlClass === "F0" || sqlClass === "HV" || sqlClass === "P0";
}

function emit(deps: ExchangeDeps, line: string, level: LogLevel): void {
  if (deps.log) {
    deps.log(line);
    return;
  }
  writeLogLine(line, level);
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
    institutionName: capName(institutionName),
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
    institutionName: capName(institutionName),
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
    emit(
      deps,
      `${prefix} compensate=revoked request_id=${logField(requestId)}`,
      "info"
    );
  } catch (error) {
    const verdict = classifyItemRemoveRejection(
      error,
      plaidTokenEnvironment(accessToken),
      deps.plaidEnvironment
    );
    if (verdict.itemAlreadyGone) {
      emit(deps, `${prefix} compensate=item_not_found`, "info");
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
        mismatch,
      "error"
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
    emit(deps, `${userPrefix} refused=limit_read`, "error");
    return failure(503, "CONNECTION_CHECK_FAILED", RETRY_MESSAGE);
  }
  if (count >= CONNECTION_LIMIT) {
    emit(deps, `${userPrefix} refused=limit count=${count}`, "info");
    return failure(422, CONNECTION_LIMIT_CODE, CONNECTION_LIMIT_MESSAGE);
  }

  // 2. Duplicate check on the client's institution id. Fails open: step 6
  // repeats it with Plaid's own value and fails closed.
  const clientInstitutionId = nonEmpty(input.institutionId);
  // Capped here, once, so every answer that falls back to it is capped too.
  const clientInstitutionName = capName(nonEmpty(input.institutionName));
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
      emit(
        deps,
        `${userPrefix} dedupe_read=failed stage=pre proceeding=true`,
        "warn"
      );
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
  emit(deps, `${prefix} minted`, "info");

  // 4. Ownership. One retry: the read is idempotent and a single transient
  // failure is the common case.
  let own = await readOwnItem(deps, userId, itemId);
  if (!own.ok) {
    own = await readOwnItem(deps, userId, itemId);
  }
  if (!own.ok) {
    emit(deps, `${prefix} failure=ownership_read revoke=skipped`, "error");
    return failure(503, "CONNECTION_CHECK_FAILED", RETRY_MESSAGE);
  }
  if (own.connection) {
    // Already stored for this user — an update-mode token from an older
    // client. Nothing to save and nothing to revoke.
    emit(deps, `${prefix} resolved=already_stored`, "info");
    return connected(
      itemId,
      nonEmpty(own.connection.institution_id),
      nonEmpty(own.connection.institution_name) ??
        clientInstitutionName ??
        UNKNOWN_INSTITUTION
    );
  }

  // From here on the Item is known to be new to this user, and no other
  // request can store it (its public token is spent), so revoking it on a
  // refusal is safe. The one exception — a store that may have committed — is
  // re-read before it reaches this. This closure is the only way this function
  // revokes.
  // `level` is the refusal's own: a duplicate is an outcome, a failed read or
  // save is a failure. The compensating revocation logs its own level.
  const refuse = async (
    reason: string,
    outcome: ExchangeOutcome,
    level: LogLevel
  ): Promise<ExchangeOutcome> => {
    emit(deps, `${prefix} refused=${reason}`, level);
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
      failure(503, "INSTITUTION_LOOKUP_FAILED", RETRY_MESSAGE),
      "error"
    );
  }
  const serverInstitutionId = nonEmpty(item.institutionId);
  const serverInstitutionName = nonEmpty(item.institutionName);
  const institutionName = capName(
    serverInstitutionName ?? clientInstitutionName ?? UNKNOWN_INSTITUTION
  );

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
        failure(503, "CONNECTION_CHECK_FAILED", RETRY_MESSAGE),
        "error"
      );
    }
    if (existing) {
      return refuse(
        "post_duplicate",
        duplicate(
          nonEmpty(existing.institution_name) ??
            serverInstitutionName ??
            "This bank"
        ),
        "info"
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
    emit(deps, `${prefix} resolved=stored`, "info");
    return connected(itemId, serverInstitutionId, institutionName);
  }

  if (stored.kind === "duplicate_item") {
    // 23505 arrives when this user already has a row with this item_id — not
    // from a race after step 4 (no other request holds this Item), but, for
    // example, when an earlier ambiguous store failure had in fact committed —
    // or on a primary-key collision. The code alone does not say which, so the
    // Item is not revoked, and success is reported only once the row is
    // actually read back.
    const confirm = await readOwnItem(deps, userId, itemId);
    if (confirm.ok && confirm.connection) {
      emit(deps, `${prefix} resolved=already_stored stage=insert`, "info");
      return connected(
        itemId,
        nonEmpty(confirm.connection.institution_id),
        nonEmpty(confirm.connection.institution_name) ?? institutionName
      );
    }
    emit(
      deps,
      `${prefix} refused=store_conflict db_error=${logField(stored.dbErrorCode)} ` +
        `revoke=skipped`,
      "error"
    );
    return failure(500, "CONNECTION_SAVE_FAILED", SAVE_FAILED_MESSAGE);
  }

  const saveFailed = failure(500, "CONNECTION_SAVE_FAILED", SAVE_FAILED_MESSAGE);
  const dbError = `db_error=${logField(stored.dbErrorCode)}`;

  // Nothing was inserted (crypto) or the server refused the insert: no row.
  if (stored.kind === "crypto") {
    return refuse("store_crypto", saveFailed, "error");
  }
  if (isDefiniteDbRejection(stored.dbErrorCode)) {
    return refuse(`store_db ${dbError}`, saveFailed, "error");
  }

  // The insert may have committed. Read the row before deciding; one retry,
  // as in step 4. A warning, not an error: this request may still end in
  // `resolved=already_stored`, and the line that ends it carries the verdict.
  emit(deps, `${prefix} store_failed ${dbError}`, "warn");
  let recheck = await readOwnItem(deps, userId, itemId);
  if (!recheck.ok) {
    recheck = await readOwnItem(deps, userId, itemId);
  }
  if (!recheck.ok) {
    emit(
      deps,
      `${prefix} refused=store_db ${dbError} revoke=skipped reason=recheck_read_failed`,
      "error"
    );
    return saveFailed;
  }
  if (recheck.connection) {
    emit(deps, `${prefix} revoke=skipped reason=row_present`, "info");
    emit(deps, `${prefix} resolved=already_stored stage=recheck`, "info");
    return connected(
      itemId,
      nonEmpty(recheck.connection.institution_id),
      nonEmpty(recheck.connection.institution_name) ?? institutionName
    );
  }
  return refuse(`store_db ${dbError}`, saveFailed, "error");
}
