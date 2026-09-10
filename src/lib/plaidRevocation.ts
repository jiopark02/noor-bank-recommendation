import { plaidClient } from "./plaid";
import { deletePlaidConnection } from "./plaidApiUtils";
import { getPlaidErrorCode } from "./plaidErrorRedaction";
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
 * ⚠️ NO PLAID ERROR CODE IS FOLDED INTO SUCCESS. Not ITEM_NOT_FOUND, not
 * anything that reads like "it was already gone". The SDK's ItemRemoveResponse
 * carries a request_id and nothing else, and `plaid`'s type definitions do not
 * enumerate error codes at all (PlaidError.error_code is a bare `string`), so
 * there is no code here whose meaning has been VERIFIED against the live API.
 * Treating a guess as success would delete a row whose Item may still be live —
 * the exact failure this module exists to prevent. Whether one specific
 * "already removed" code should eventually be accepted is a separate decision
 * that needs a live observation first; do not add it speculatively.
 *
 * That observation is what the `error_code=` field on the failure log line
 * below is for. An earlier version of this module discarded the rejection
 * entirely (`catch {}`, no binding), which left the decision above waiting on
 * evidence the same file made it impossible to collect. Logging it is safe:
 * every Plaid rejection reaches this module through the plaidHttp interceptor
 * in plaid.ts, which has already run redactPlaidAxiosError over it, and
 * getPlaidErrorCode reads one allow-listed string and cannot throw.
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
  /** True only when the Item was revoked AND its row was deleted. */
  ok: boolean;
  failure?: RevokeFailureKind;
};

export type RevocationSummary = {
  outcomes: ConnectionRevocationOutcome[];
  /**
   * Connections whose row was deliberately left in place.
   *
   * ⚠️ This does NOT shrink to 0 on its own for every kind of failure. See the
   * two non-converging cases named on revokeAndDeleteConnections below.
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
  /** Revokes the Item. Resolves on success, rejects on any failure. */
  itemRemove: (accessToken: string) => Promise<void>;
  /** True when the row is gone (including when it was already absent). */
  deleteRow: (userId: string, itemId: string) => Promise<boolean>;
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

function emit(deps: RevocationDeps, line: string): void {
  if (deps.log) {
    deps.log(line);
    return;
  }
  console.error(line);
}

/**
 * Revoke one Item, then delete its row — in that order, and only in that order.
 *
 * Every failure returns early WITHOUT touching the row. For a decrypt failure
 * and for an itemRemove failure that is the whole story: nothing has been
 * consumed, so calling this again on the same connection is equivalent to
 * calling it once.
 *
 * ⚠️ THE row_delete FAILURE IS THE EXCEPTION, and this docblock used to state
 * the safe case as though it covered all three. By the time deleteRow can fail,
 * itemRemove has already SUCCEEDED — the row is untouched but the Item is
 * consumed, and a second call cannot reproduce the first one's outcome: its
 * itemRemove is aimed at an Item that no longer exists, this module folds no
 * error code into success, and the result is `plaid` forever. So a retry is
 * safe in the sense that it destroys nothing, and NOT convergent. The inline
 * comment on the delete below and the two non-converging cases named on
 * revokeAndDeleteConnections are the same fact, stated where it happens.
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
      `[plaid-revoke] item_id=${itemId} failure=${failure} ` +
        `reason=${cryptoReasonOf(error)}`
    );
    return { itemId, ok: false, failure };
  }

  try {
    await deps.itemRemove(plaintextToken);
  } catch (error) {
    // The error code is RECORDED, never ACTED ON. No rejection is folded into
    // success regardless of what it says (see the module header) — the row stays
    // either way. It is logged so the open question of whether an "already
    // removed" code should eventually be accepted can be settled from live
    // evidence rather than from a guess.
    emit(
      deps,
      `[plaid-revoke] item_id=${itemId} failure=plaid ` +
        `error_code=${getPlaidErrorCode(error) ?? "none"}`
    );
    return { itemId, ok: false, failure: "plaid" };
  }

  // The Item is gone but the row is not, and this is the one window where a
  // retry of the whole operation cannot converge: the next attempt's itemRemove
  // would be aimed at an Item that no longer exists, and this module does not
  // fold that into success. One retry here is cheap and safe (the delete is
  // idempotent and filtered by user_id + item_id), and it closes the common
  // case of a single transient query failure. It does not close a sustained
  // database failure — but a sustained failure fails the surrounding account
  // deletion anyway.
  let deleted = await deps.deleteRow(userId, itemId);
  if (!deleted) {
    deleted = await deps.deleteRow(userId, itemId);
  }
  if (!deleted) {
    emit(deps, `[plaid-revoke] item_id=${itemId} failure=row_delete`);
    return { itemId, ok: false, failure: "row_delete" };
  }

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
 * ⚠️ NEVER GROWING IS NOT THE SAME AS REACHING 0, and an earlier version of
 * this comment claimed the stronger thing. Two failures are permanent under the
 * current code, and a retry repeats them forever:
 *
 *   1. itemRemove SUCCEEDED and both deleteRow attempts failed. The Item is
 *      already gone, so every later attempt calls itemRemove on an Item that no
 *      longer exists, and this module folds no error code into success — so the
 *      row can never be deleted by this path again.
 *   2. A row whose ciphertext is genuinely corrupt while the key is fine. It
 *      fails `crypto_row` on every attempt, by definition.
 *
 * In both cases `remaining` stays ≥ 1 and /api/account/delete's gate refuses
 * forever, so that user cannot complete an account deletion at all. There is NO
 * recovery path in the code today — no operator route, no override, no way for
 * the user to resolve it themselves. That is a known open item, deliberately
 * not closed here: the alternatives (accepting a Plaid error code as success,
 * or deleting a row whose Item was never confirmed revoked) are exactly what
 * this module exists to refuse, and choosing between them needs the live
 * evidence the failure log lines are now collecting.
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
      await plaidClient.itemRemove({ access_token: accessToken });
    },
    deleteRow: (userId, itemId) => deletePlaidConnection(userId, itemId),
  };
}
