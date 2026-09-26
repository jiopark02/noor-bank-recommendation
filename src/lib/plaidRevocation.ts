import {
  plaidClient,
  PLAID_ENVIRONMENT,
  type PlaidEnvironmentName,
} from "./plaid";
import { deletePlaidConnection, type PlaidRowDeletion } from "./plaidApiUtils";
import { getPlaidErrorCode, getPlaidErrorType } from "./plaidErrorRedaction";
import {
  decryptPlaidAccessToken,
  isPlaidTokenCryptoError,
} from "./plaidTokenCrypto";

/**
 * Pairing a Plaid Item revocation with the deletion of the row that holds its
 * token.
 *
 * WHY THIS MODULE EXISTS
 * The two operations used to be independent. /api/plaid/disconnect deleted the
 * row and never called itemRemove at all; /api/account/delete called itemRemove
 * best-effort and then deleted every row regardless of the outcome. Because the
 * row holds the ONLY copy of the access token, deleting it after a failed
 * revocation leaves the Plaid Item live and permanently unrevokable — the user
 * has closed their account and their bank connection is still open.
 *
 * The rule this module enforces is therefore: a row is deleted ONLY after its
 * Item has actually been revoked. Every failure leaves the row in place, which
 * is the state a retry (or a human) can still act on.
 *
 * "Actually been revoked" now includes "confirmed to be already gone", under the
 * three conditions named below — and nothing looser.
 *
 * ⚠️ EXACTLY ONE PLAID REJECTION IS FOLDED INTO SUCCESS, UNDER THREE CONDITIONS
 * THAT MUST ALL HOLD: error_code ITEM_NOT_FOUND, error_type ITEM_ERROR, and a
 * token whose environment segment matches the environment this deployment is
 * configured for. classifyItemRemoveRejection below is the whole decision and the
 * only place it is made.
 *
 * Nothing else is folded. Not INVALID_ACCESS_TOKEN, not anything else that reads
 * like "it was already gone", not a decrypt failure, and not a rejection whose
 * code matches while its type or its environment does not. Widening this would
 * delete a row whose Item may still be live — the exact failure this module
 * exists to prevent — and the row holds the only copy of the token that could
 * revoke it.
 *
 * WHY THIS ONE. Without it the module could not converge. When itemRemove has
 * SUCCEEDED and the row delete then fails, the Item is gone and every later
 * attempt is aimed at an Item that no longer exists, so refusing every code meant
 * that row could never be deleted and the user could never complete an account
 * deletion. The two halves of this operation are now each idempotent: "already
 * revoked" and "row already absent" are both success.
 *
 * PROVENANCE, STATED PRECISELY BECAUSE THE TWO HALVES DIFFER. The error_code was
 * observed live on sandbox on 2026-09-13: a re-issued /item/remove on an
 * already-removed Item returned ITEM_NOT_FOUND, through this module's own
 * `failure=plaid error_code=` log line. The error_type ITEM_ERROR comes from
 * Plaid's published error reference and had NOT been observed when this was
 * written; the failure log line's `error_type=` field is what will confirm or
 * refute it. If the type is in fact something else, this fold never fires and the
 * convergence above does not exist — the tests cannot tell you that, because
 * their fixtures supply the type.
 *
 * Note what the environment condition does NOT cover: it compares environments,
 * not Plaid ACCOUNTS, so a token issued to a different client_id in the same
 * environment passes it. What keeps that case from being folded is Plaid's
 * documented classification — such a token is INVALID_ACCESS_TOKEN, which is
 * never folded — and that too is unobserved here. The defense for a
 * rotated-credentials deployment therefore rests on the docs, not on this guard.
 *
 * Logging both is safe: every Plaid rejection reaches this module through the
 * plaidHttp interceptor in plaid.ts, which has already run
 * redactPlaidAxiosError over it, and both readers take one allow-listed string
 * and cannot throw.
 *
 * WHY THE DEPENDENCIES ARE INJECTED
 * So the ordering guarantee above can be tested by executing it, rather than by
 * reading the source. A test passes an itemRemove that rejects and asserts that
 * deleteRow was never called for that connection — see plaidRevocation.test.ts,
 * which measures that assertion going red when the two calls are swapped. This
 * follows the preference plaidConnectionReadSeam.test.ts states in its header:
 * pull the decision out so it needs no mock, rather than faking its
 * surroundings. liveRevocationDeps() below is the production wiring.
 */

/**
 * The minimum a connection row must carry to be revoked.
 *
 * Deliberately structural rather than a full row type: the rows come from
 * getAllPlaidConnections / getPlaidConnectionByItemId, which use select("*"),
 * and the migrations directory is not the source of truth for that table. This
 * names only what is read here.
 *
 * `access_token` holds CIPHERTEXT (PL1). It is never usable as-is; it must go
 * through `decrypt` below, with a userId taken verbatim from the verified token
 * because that userId is the additional authenticated data the ciphertext is
 * bound to.
 */
export type RevocableConnection = {
  item_id: string;
  access_token: string;
};

/**
 * Which step failed, named by the condition that was evaluated rather than by
 * its downstream effect (the convention plaidTokenCrypto.ts uses for its own
 * reasons).
 *
 * The crypto split is load-bearing: "this deployment cannot decrypt anything"
 * and "this one row will not decrypt" need different answers to the user. The
 * first is a configuration fault that no amount of retrying fixes; the second
 * is one connection out of several.
 */
export type RevokeFailureKind =
  | "crypto_config"
  | "crypto_row"
  | "plaid"
  | "row_delete";

export type ConnectionRevocationOutcome = {
  itemId: string;
  /**
   * True only when the Item is gone — revoked by this call, or confirmed already
   * absent — AND its row is gone, deleted by this call or already absent.
   */
  ok: boolean;
  failure?: RevokeFailureKind;
};

export type RevocationSummary = {
  outcomes: ConnectionRevocationOutcome[];
  /**
   * Connections whose row was deliberately left in place.
   *
   * ⚠️ This does NOT shrink to 0 on its own for every kind of failure. See the
   * non-converging case named on revokeAndDeleteConnections below.
   */
  remaining: number;
  /**
   * At least one failure was key-level rather than row-level. The caller uses
   * this to answer "our configuration is broken" instead of "we could not
   * remove your data", which are different problems with different fixes.
   */
  sawCryptoConfigFailure: boolean;
};

export type RevocationDeps = {
  /** Plaintext out, ciphertext in. Throws on any failure — no fallback. */
  decrypt: (stored: string, userId: string) => string;
  /**
   * Revokes the Item. Rejects on any failure.
   *
   * Resolves with Plaid's `request_id` when the response carried one, and null
   * when it did not. The SDK types it as required on ItemRemoveResponse
   * (dist/api.d.ts, ItemRemoveResponse.request_id: string) and it is the only
   * field that response has, so null means the response did not match its own
   * type — never a reason to treat the revocation as anything but done.
   *
   * It is returned rather than logged here because this is the injected seam: the
   * value has to cross it to reach the log line that records the one step of this
   * operation that cannot be undone.
   */
  itemRemove: (accessToken: string) => Promise<string | null>;
  /**
   * Deletes the row and reports HOW MANY rows that removed.
   *
   * The count is load-bearing and the previous boolean could not carry it. A
   * PostgREST delete that matches no rows reports neither an error nor a count,
   * so "the row was removed" and "nothing matched the filter" arrived here as
   * the same `true`, and this module promoted it to ok: true — which is what the
   * account-deletion gate is computed from.
   *
   * `deleted: 0` is still success, because absence IS the target state, but it
   * is now a DECISION made here with the number in hand and in the log, rather
   * than a case that was indistinguishable.
   */
  deleteRow: (userId: string, itemId: string) => Promise<PlaidRowDeletion>;
  /**
   * The Plaid environment this deployment talks to — the PLAID_ENVIRONMENT
   * constant from plaid.ts, which is also what the client's basePath is built
   * from, so this is the same value the call actually goes to.
   *
   * Injected rather than read from process.env here so that a decision made
   * against it can be executed in a test without touching the environment.
   */
  plaidEnvironment: PlaidEnvironmentName;
  /** Defaults to console.error. Injected so tests stay quiet. */
  log?: (line: string) => void;
};

/** The reasons loadKey() raises. Everything else is a property of one row. */
function isKeyLevelReason(reason: string): boolean {
  switch (reason) {
    case "key_missing":
    case "key_format":
    case "key_length":
      return true;
    default:
      return false;
  }
}

/**
 * Key-level fault or row-level fault.
 *
 * ⚠️ This cannot separate every case, and the gap is worth knowing about.
 * `auth_failed` is raised both when the configured key is the WRONG VALUE (a
 * deployment-wide fault, every row fails) and when a single row is corrupt or
 * was written under a different key. Those are indistinguishable from the
 * error alone, so both are reported as `crypto_row`. A wrong key value
 * therefore surfaces as every connection failing at the row level, not as a
 * configuration failure.
 *
 * What separates them is the SHAPE OF THE LOG, which is why the failure line
 * carries `reason=` and not just the classification: every connection logging
 * `failure=crypto_row reason=auth_failed` is a wrong key value; one row doing
 * it while others succeed is that row. The response cannot show this — it
 * reports one verdict for the whole request — so read the log lines, plural.
 * (Before those lines carried `reason=`, this paragraph told a reader to
 * consult evidence that was not being written down. It is now.)
 *
 * The gate that DOES catch a key-level fault cleanly is
 * isPlaidTokenCryptoConfigured(), which the callers check before entering the
 * loop. This function covers what that gate cannot see.
 */
export function classifyCryptoFailure(error: unknown): RevokeFailureKind {
  if (isPlaidTokenCryptoError(error) && isKeyLevelReason(error.reason)) {
    return "crypto_config";
  }
  return "crypto_row";
}

/**
 * The crypto failure's own reason, for the log line only.
 *
 * This is the detail classifyCryptoFailure deliberately throws away: every
 * row-level cause collapses to `crypto_row`, and telling `auth_failed` from
 * `malformed` from `unknown_version` is exactly what the wrong-key diagnosis
 * documented above depends on. It never reaches a response body.
 */
function cryptoReasonOf(error: unknown): string {
  return isPlaidTokenCryptoError(error) ? error.reason : "unknown";
}

/**
 * One field of one log line, bounded.
 *
 * Every value this module interpolates is allow-listed by shape — a Plaid
 * error_code, an error_type, a request_id — so none of them is a credential. That
 * is a statement about the KEY and the value TYPE, not about the contents: the
 * strings come from Plaid's response body, and nothing in the redaction layer
 * bounds their length or forbids a newline. An unbounded value would push the
 * rest of the line out of a log viewer, and a newline would split one decision
 * record into two, which is worse than losing the value — a half-line reads as a
 * complete one.
 *
 * So: whitespace runs collapse to a single space, the result is trimmed, and it is
 * capped at 32 characters. Every real Plaid code and type is well under that, and
 * a request_id truncated to its first 32 characters is still enough to hand to
 * Plaid support. `undefined`, `null`, a non-string, and a value that is nothing
 * but whitespace all become "none", which is what these fields already printed
 * when unreadable.
 *
 * Deliberately local, and NOT a change to plaidErrorRedaction's readString: that
 * function feeds response bodies and mapping decisions too, where truncating a
 * value would corrupt a comparison rather than tidy a log line. The bound belongs
 * at the log site.
 */
function logField(value: unknown): string {
  if (typeof value !== "string") return "none";
  const flattened = value.replace(/\s+/g, " ").trim().slice(0, 32);
  return flattened === "" ? "none" : flattened;
}

function emit(deps: RevocationDeps, line: string): void {
  if (deps.log) {
    deps.log(line);
    return;
  }
  console.error(line);
}

/**
 * The environment segment of a PLAINTEXT Plaid access token.
 *
 * Plaid issues `access-<environment>-<identifier>` (see the note on
 * decryptPlaidAccessToken, which rejects exactly this shape as a legacy
 * plaintext value, and the fixture in plaidTokenCrypto.test.ts).
 *
 * TOTAL, AND IT NEVER THROWS. Every input that is not that shape — a non-string,
 * a future format, an empty string — returns the fixed string "unparseable",
 * which equals no environment name, so an unreadable token can only ever be a
 * MISMATCH. That direction is the point: this value decides whether a row may be
 * deleted, and "I could not read it" must never become "it matched".
 *
 * ⚠️ IT RETURNS THE CAPTURED SEGMENT AND NOTHING ELSE. The identifier half of
 * the token never leaves this function, which is what makes the result safe to
 * put in a log line, and the capture is length-bounded for the same reason.
 */
export function plaidTokenEnvironment(plaintextToken: string): string {
  if (typeof plaintextToken !== "string") return "unparseable";
  const match = /^access-([a-z]{1,32})-/.exec(plaintextToken);
  return match ? match[1] : "unparseable";
}

/**
 * What a rejected itemRemove means for the row.
 *
 * `itemAlreadyGone` is the only verdict that lets the row be deleted.
 * `envMismatch` exists so the log line can say WHICH condition refused, because
 * the two refusals need different responses from a human: an ordinary Plaid
 * failure is retried, while a token from the other environment is a
 * configuration story no retry resolves.
 */
export type ItemRemoveVerdict =
  | { itemAlreadyGone: true }
  | { itemAlreadyGone: false; envMismatch: false }
  | { itemAlreadyGone: false; envMismatch: true; tokenEnvironment: string };

/**
 * Whether a rejected itemRemove may be treated as "the Item is already gone".
 *
 * ALL THREE CONDITIONS MUST HOLD. Any one of them failing leaves the row alone:
 *
 *   1. error_code === "ITEM_NOT_FOUND"
 *   2. error_type === "ITEM_ERROR" — the code alone could appear under a type we
 *      have never observed, and requiring both keeps the accepted shape the one
 *      that was actually described. See the provenance note in the module header
 *      for which of the two was observed and which was not.
 *   3. the token's environment segment equals the environment this deployment is
 *      configured for. A token from another environment can be reported as not
 *      found HERE while its Item is alive THERE, and deleting that row would
 *      destroy the only copy of the token that could ever revoke it.
 *
 * INVALID_ACCESS_TOKEN is NOT accepted under any condition, and neither is any
 * other code. A decrypt failure never reaches this function — it returns before
 * itemRemove is called.
 *
 * Pure and exported so the matrix above is executed by a test rather than read
 * from source, the same split plaidChatContext.ts and connectionRowsOrNull use.
 * It takes the already-extracted environment segment rather than the token, so
 * no plaintext credential is passed across this boundary at all.
 */
export function classifyItemRemoveRejection(
  error: unknown,
  tokenEnvironment: string,
  serverEnvironment: string
): ItemRemoveVerdict {
  if (
    getPlaidErrorCode(error) !== "ITEM_NOT_FOUND" ||
    getPlaidErrorType(error) !== "ITEM_ERROR"
  ) {
    return { itemAlreadyGone: false, envMismatch: false };
  }
  if (tokenEnvironment !== serverEnvironment) {
    return { itemAlreadyGone: false, envMismatch: true, tokenEnvironment };
  }
  return { itemAlreadyGone: true };
}

/**
 * Revoke one Item, then delete its row — in that order, and only in that order.
 *
 * Every failure returns early WITHOUT touching the row. For a decrypt failure
 * and an itemRemove failure nothing has been consumed either. For a row_delete
 * failure the Item HAS been consumed — itemRemove succeeded first — and what
 * makes a retry safe there is not that nothing happened but that both halves are
 * idempotent (below).
 *
 * BOTH HALVES ARE IDEMPOTENT, WHICH IS WHAT MAKES A RETRY CONVERGE.
 *  - The remote half: an itemRemove that rejects with ITEM_NOT_FOUND /
 *    ITEM_ERROR for a token from this environment means the Item is already in
 *    the state this call was asking for, and is treated as success.
 *  - The local half: a delete that matched 0 rows means the row is already in
 *    the state this call was asking for, and is treated as success.
 *
 * So the case this docblock used to name as permanent — itemRemove succeeded and
 * the delete failed twice — now clears on a retry (provided Plaid sends
 * ITEM_ERROR with that code — see the provenance note in this file's header):
 * the second attempt's itemRemove is folded and the delete runs again. What does NOT clear is a row
 * whose ciphertext will not decrypt under a working key; that one fails
 * crypto_row on every attempt, by definition, and is named on
 * revokeAndDeleteConnections below.
 *
 * @param userId The authenticated user id, verbatim. It is both the row's owner
 *               and the AAD the ciphertext is bound to; a normalized or
 *               substituted value fails to decrypt.
 */
export async function revokeAndDeleteConnection(
  userId: string,
  connection: RevocableConnection,
  deps: RevocationDeps
): Promise<ConnectionRevocationOutcome> {
  const itemId = connection.item_id;

  let plaintextToken: string;
  try {
    plaintextToken = deps.decrypt(connection.access_token, userId);
  } catch (error) {
    const failure = classifyCryptoFailure(error);
    emit(
      deps,
      `[plaid-revoke] user_id=${userId} item_id=${itemId} failure=${failure} ` +
        `reason=${cryptoReasonOf(error)}`
    );
    return { itemId, ok: false, failure };
  }

  let requestId: string | null = null;
  let resolvedByAbsence = false;
  try {
    requestId = await deps.itemRemove(plaintextToken);
  } catch (error) {
    // ONE rejection is folded into success, and only when all three of its
    // conditions hold — classifyItemRemoveRejection is the whole decision. Every
    // other rejection leaves the row exactly where it was.
    const verdict = classifyItemRemoveRejection(
      error,
      plaidTokenEnvironment(plaintextToken),
      deps.plaidEnvironment
    );

    if (!verdict.itemAlreadyGone) {
      // error_type is logged beside error_code because without it a refusal is
      // undiagnosable: "the code did not match" and "the code matched under a
      // type we do not accept" are different facts with different fixes, and the
      // second one is how this fold would silently never fire.
      const mismatch = verdict.envMismatch
        ? ` reason=env_mismatch token_env=${verdict.tokenEnvironment} ` +
          `server_env=${deps.plaidEnvironment}`
        : "";
      emit(
        deps,
        `[plaid-revoke] user_id=${userId} item_id=${itemId} failure=plaid ` +
          `error_code=${logField(getPlaidErrorCode(error))} ` +
          `error_type=${logField(getPlaidErrorType(error))}` +
          mismatch
      );
      return { itemId, ok: false, failure: "plaid" };
    }

    resolvedByAbsence = true;
  }

  // THE IRREVERSIBLE STEP, RECORDED — or the confirmation that it had already
  // happened. Everything above this line can be retried with nothing spent; past
  // it, the Item is gone from Plaid's side and no part of this codebase can bring
  // it back. Until now the only trace of it was the row disappearing, which says
  // nothing when the row does NOT disappear — the failure this module's retry
  // exists for.
  //
  // The two values of `resolved=` are not interchangeable and the log must not
  // merge them: `revoked` means this call removed the Item and carries the
  // request_id a Plaid support conversation is keyed on, while `item_not_found`
  // means the Item was already absent and no revocation happened here at all. A
  // deleted row is no longer evidence that WE revoked it, and this line is the
  // only place that distinction is recorded.
  emit(
    deps,
    resolvedByAbsence
      ? `[plaid-revoke] user_id=${userId} item_id=${itemId} ` +
          `resolved=item_not_found`
      : `[plaid-revoke] user_id=${userId} item_id=${itemId} resolved=revoked ` +
          `request_id=${logField(requestId)}`
  );

  // One retry, because the delete is idempotent and filtered by user_id +
  // item_id, and a single transient query failure is the common case. It does not
  // close a sustained database failure — but that row is no longer stranded when
  // it happens: the Item is gone, so a later attempt's itemRemove is folded (see
  // classifyItemRemoveRejection) and the delete is reached again.
  let deletion = await deps.deleteRow(userId, itemId);
  if (!deletion.ok) {
    // The first attempt's database code is logged HERE rather than only on the
    // final failure, because a retry that then succeeds would otherwise discard
    // it — and an intermittent code is exactly what diagnoses a flaky delete.
    // Deliberately not `failure=`: this connection may still succeed, and a
    // failure line for a successful operation misleads anything watching the
    // logs.
    emit(
      deps,
      `[plaid-revoke] user_id=${userId} item_id=${itemId} ` +
        `retrying=row_delete db_error=${deletion.dbErrorCode ?? "none"}`
    );
    deletion = await deps.deleteRow(userId, itemId);
  }
  if (!deletion.ok) {
    emit(
      deps,
      `[plaid-revoke] user_id=${userId} item_id=${itemId} ` +
        `failure=row_delete db_error=${deletion.dbErrorCode ?? "none"}`
    );
    return { itemId, ok: false, failure: "row_delete" };
  }

  // A count of 0 is success: the row is in the state this call was asking for.
  // It is not silently equivalent to 1 — the number is in the log, because the
  // two mean different things about what happened. Reaching 0 here means the row
  // was already gone, which on this path can only be a concurrent request: the
  // row was read moments earlier through the same filter AND the same client
  // construction the delete uses — both go through createServerClient with
  // `.eq("user_id", userId)` — so anything the read could see, the delete can
  // address. That is the load-bearing half; the decrypt that just succeeded adds
  // that the userId is byte-identical to the one the row was written with.
  emit(
    deps,
    `[plaid-revoke] user_id=${userId} item_id=${itemId} ` +
      `deleted=${deletion.deleted}`
  );
  return { itemId, ok: true };
}

/**
 * The same, across every connection. Sequential on purpose: these are writes to
 * an external system plus a database, and there is nothing to gain from racing
 * them.
 *
 * `remaining` counts rows left behind, and it is the number the account
 * deletion path gates on. It never GROWS across calls — a successful connection
 * loses its row and drops out of the next read.
 *
 * ⚠️ NEVER GROWING IS NOT THE SAME AS REACHING 0. One failure is permanent under
 * the current code, and a retry repeats it forever:
 *
 *   A row whose ciphertext is genuinely corrupt while the key is fine. It fails
 *   `crypto_row` on every attempt, by definition, so `remaining` stays >= 1,
 *   /api/account/delete's gate refuses forever, and that user cannot complete an
 *   account deletion at all. There is NO recovery path in the code today — no
 *   operator route, no override, no way for the user to resolve it themselves.
 *   That is a known open item, deliberately not closed here: the only
 *   alternative is deleting a row whose Item was never confirmed revoked, which
 *   is what this module exists to refuse.
 *
 * The second permanent case this comment used to name — itemRemove succeeded and
 * both deleteRow attempts failed — is no longer permanent (provided Plaid sends
 * ITEM_ERROR with that code — see the provenance note in this file's header; if
 * it does not, the fold never fires and that case stays permanent too). Folding a
 * confirmed absent Item into success is what closed it; a retry now reaches the
 * delete again.
 */
export async function revokeAndDeleteConnections(
  userId: string,
  connections: RevocableConnection[],
  deps: RevocationDeps
): Promise<RevocationSummary> {
  const outcomes: ConnectionRevocationOutcome[] = [];

  for (const connection of connections) {
    outcomes.push(await revokeAndDeleteConnection(userId, connection, deps));
  }

  return {
    outcomes,
    remaining: outcomes.filter((outcome) => !outcome.ok).length,
    sawCryptoConfigFailure: outcomes.some(
      (outcome) => outcome.failure === "crypto_config"
    ),
  };
}

/**
 * The production wiring.
 *
 * This function is why plaidRevocation.ts is registered in CONSUMING_SITES in
 * plaidTokenReadSites.test.ts: the decrypt below is a real read of the stored
 * column, and the plaintext it produces is handed to the Plaid SDK on the next
 * line. Keeping that pair in one small named function means the probe has one
 * file to point at, and the routes above it never touch a token at all.
 *
 * decryptPlaidAccessToken is called rather than referenced (`decrypt:
 * decryptPlaidAccessToken` would type-check identically) so the probe's second
 * assertion — which searches for the literal text `decryptPlaidAccessToken(` —
 * keeps seeing it. Do not "simplify" it to a bare reference: the guard would go
 * quiet without anything failing.
 */
export function liveRevocationDeps(): RevocationDeps {
  return {
    decrypt: (stored, userId) => decryptPlaidAccessToken(stored, userId),
    itemRemove: async (accessToken) => {
      const response = await plaidClient.itemRemove({
        access_token: accessToken,
      });
      // Read as if request_id were optional, though the SDK types it as required
      // and as the only field on the response. A response that does not match
      // its own type is not a reason to report a completed revocation as a
      // failure — the log line says "none" and the row still gets deleted.
      const requestId: unknown = response?.data?.request_id;
      return typeof requestId === "string" && requestId !== ""
        ? requestId
        : null;
    },
    deleteRow: (userId, itemId) => deletePlaidConnection(userId, itemId),
    // The same constant the client's basePath was built from, so the value any
    // environment check compares against is the environment the call above
    // actually goes to. Not re-derived here: two derivations of one fact are two
    // things that can disagree.
    plaidEnvironment: PLAID_ENVIRONMENT,
  };
}
