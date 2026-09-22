import type { RevocableConnection, RevocationSummary } from "./plaidRevocation";

/**
 * The decision half of POST /api/account/delete — every branch, none of the IO.
 *
 * WHY THIS IS NOT IN THE ROUTE
 * The guarantee that matters here is a NEGATIVE one: when a Plaid connection
 * could not be revoked, the user's rows are not deleted. A negative guarantee
 * cannot be checked by reading source — the assertion has to observe that a
 * call did NOT happen — and the route could not be executed offline, because it
 * authenticates first and nothing in this suite fakes the auth boundary
 * (plaidConnectionReadWiring.test.ts explains at length why it declined to).
 *
 * So the auth boundary stays untouched and the decision moved out from under
 * it. The route is now: verify the token, build the real dependencies, call
 * this, serialize the result. Everything that decides anything is here, reached
 * by accountDeletion.test.ts with plain injected fakes and no vi.mock.
 *
 * ORDERING IS THE POINT, NOT AN IMPLEMENTATION DETAIL
 * This spans an external API (Plaid) and two internal systems (the public
 * schema and Supabase Auth) with no transaction across them, so the steps run
 * from recoverable to irreversible and each is individually idempotent:
 *
 *   1. Preconditions      — everything that can refuse BEFORE anything is spent
 *   2. Revoke + delete    — per connection, paired (see plaidRevocation.ts)
 *   3. Gate               — a single un-revoked connection stops the deletion
 *   4. DELETE public.users — FK ON DELETE CASCADE removes the child tables
 *   5. auth.admin.deleteUser — most irreversible, therefore last
 *
 * ⚠️ STEP 4'S CASCADE DOES NOT REACH plaid_connections. That table has no
 * foreign key to public.users and its user_id column is TEXT, not the uuid the
 * other child tables carry, so no ON DELETE CASCADE covers it. Its rows are
 * removed one at a time in step 2 and nowhere else. This is why step 3 can be a
 * gate at all: if the cascade did clean the table up, deleting the users row
 * would destroy the rows for un-revoked connections as a side effect, and
 * refusing at step 3 would be the only thing standing between a failed
 * revocation and a permanently unrevokable Item. It is also why step 2 cannot
 * be skipped as redundant — an earlier single-statement helper that deleted
 * every row for the user carried this same note, and it was deleted along with
 * the unconditional-delete behaviour it justified.
 *
 * Step 1 is new and it is a fix, not a tidy-up. The admin client used to be
 * constructed AFTER the Plaid loop, with no try around it; createAdminClient()
 * throws when SUPABASE_SERVICE_ROLE_KEY is missing, so a misconfigured
 * deployment revoked every one of the user's bank connections and then died
 * with an unhandled throw — the external, irreversible half done and the
 * internal half not started.
 *
 * A partial failure MUST surface as an explicit non-2xx. Never report success
 * for a deletion that did not finish.
 */

/** Retryable by the user: something transient failed and trying again may work. */
const RETRYABLE_MESSAGE =
  "We couldn't delete your account. Please try again in a moment. " +
  "If this keeps happening, please contact support.";

/**
 * A fault in OUR configuration. Deliberately worded WITHOUT "try again": the
 * user pressing the button ten more times changes nothing, and telling them to
 * retry presents our own misconfiguration as something they failed to do.
 */
const SERVER_FAULT_MESSAGE =
  "Something went wrong on our end. Please check back in a moment.";

/** Unchanged from before this module existed — see the two call sites below. */
const USERS_DELETE_FAILED_MESSAGE =
  "Failed to delete account data. Please retry.";
const AUTH_DELETE_FAILED_MESSAGE =
  "Your account data was deleted, but the login record could not be removed. " +
  "Please contact support to finish deletion.";

export type AccountDeletionDeps = {
  /** PLAID_CLIENT_ID + PLAID_SECRET are present. */
  isPlaidConfigured: () => boolean;
  /** PLAID_TOKEN_ENCRYPTION_KEY is present and well-formed. */
  isCryptoConfigured: () => boolean;
  /** The service-role key needed by steps 4 and 5 is present. */
  isAdminConfigured: () => boolean;
  /** null means the read FAILED; [] means the user genuinely has no rows. */
  listConnections: (userId: string) => Promise<RevocableConnection[] | null>;
  revokeAll: (
    userId: string,
    connections: RevocableConnection[]
  ) => Promise<RevocationSummary>;
  /** deletedCount 0 is not an error — see step 4. */
  deleteUsersRow: (
    userId: string
  ) => Promise<{ deletedCount: number; error: unknown }>;
  deleteAuthUser: (userId: string) => Promise<{ error: unknown }>;
  /** Defaults to console.error. Injected so tests stay quiet. */
  log?: (line: string) => void;
};

/**
 * What the route should send.
 *
 * ⚠️ `body` is built here from literal strings and fixed code constants ONLY.
 * No caught error, no error message, no connection row, no revocation outcome
 * and no count reaches it. That is not a stylistic preference: the Plaid SDK
 * rejects with an AxiosError whose config carries PLAID-SECRET and the user's
 * access token, which is why plaidErrorRedaction.ts exists, and the cheapest
 * way to keep any of it out of a response is for no response to be built from
 * an error in the first place. accountDeletion.test.ts asserts the key set.
 */
export type AccountDeletionResult = {
  status: number;
  body: Record<string, unknown>;
};

function emit(deps: AccountDeletionDeps, line: string): void {
  if (deps.log) {
    deps.log(line);
    return;
  }
  console.error(line);
}

function failure(
  status: number,
  message: string,
  code: string
): AccountDeletionResult {
  return { status, body: { error: message, code } };
}

/**
 * @param userId The authenticated user id, from the verified Bearer token only.
 *               It is never read from a request body, and it is passed to the
 *               revocation step unmodified because it is also the AAD the
 *               stored ciphertext is bound to.
 */
export async function deleteAccountForUser(
  userId: string,
  deps: AccountDeletionDeps
): Promise<AccountDeletionResult> {
  // ---------------------------------------------------------------------
  // Step 1a. The precondition for steps 4 and 5, checked BEFORE step 2 spends
  // anything. Revoking a user's bank connections and then discovering we
  // cannot delete their account is the one ordering this route must not have:
  // the revocations are irreversible and the user is left half-deleted with no
  // bank connections and a live account.
  // ---------------------------------------------------------------------
  if (!deps.isAdminConfigured()) {
    emit(
      deps,
      "[account-delete] refusing before revocation: admin client is not configured"
    );
    return failure(500, SERVER_FAULT_MESSAGE, "ADMIN_UNCONFIGURED");
  }

  // ---------------------------------------------------------------------
  // Step 1b. Read the connections. null means the read failed, and the
  // distinction from [] is the entire reason getAllPlaidConnections returns a
  // nullable (see its header).
  //
  // A failed read is answered by REFUSING to delete, which is a change from the
  // previous behaviour — it used to log and carry on. Carrying on is no longer
  // available: the rule below is "no un-revoked connection may be left behind",
  // and a read that failed cannot tell us whether there is one. Deleting the
  // account here would destroy the rows holding the only copies of tokens for
  // Items we never revoked. Refusing costs the user a retry; proceeding costs
  // them a bank connection nobody can close.
  // ---------------------------------------------------------------------
  const connections = await deps.listConnections(userId);
  if (connections === null) {
    emit(
      deps,
      "[account-delete] refusing before revocation: connection read failed"
    );
    return failure(500, RETRYABLE_MESSAGE, "CONNECTION_READ_FAILED");
  }

  // ---------------------------------------------------------------------
  // Step 1c. If there is anything to revoke, we must be able to revoke it.
  //
  // Gated on `connections.length > 0` deliberately: a deployment with no Plaid
  // credentials and a user with no connections has nothing to do here, and must
  // still be able to delete their account.
  //
  // isCryptoConfigured() catches a MISSING or MALFORMED key. It cannot catch a
  // key whose VALUE is wrong — that one is well-formed, passes here, and then
  // fails every row with auth_failed inside the loop. The
  // sawCryptoConfigFailure check after the loop is the second half of this
  // defense, and even together the two do not cover the wrong-value case (see
  // classifyCryptoFailure).
  // ---------------------------------------------------------------------
  if (
    connections.length > 0 &&
    (!deps.isPlaidConfigured() || !deps.isCryptoConfigured())
  ) {
    emit(
      deps,
      "[account-delete] refusing before revocation: Plaid or token encryption is not configured"
    );
    return failure(503, SERVER_FAULT_MESSAGE, "PLAID_CRYPTO_UNCONFIGURED");
  }

  // ---------------------------------------------------------------------
  // Step 2. Revoke each Item and delete only the rows whose Item was revoked.
  // ---------------------------------------------------------------------
  const summary = await deps.revokeAll(userId, connections);

  // ---------------------------------------------------------------------
  // Step 3a. A key-level crypto failure reached us despite step 1c — the key
  // went away, or was replaced with a malformed one, between that check and the
  // loop. It is our fault rather than a data problem, so it gets the
  // configuration answer instead of the retry answer, and it is reported before
  // the generic gate below so the more specific cause wins.
  //
  // ⚠️ "KEY-LEVEL" IS EXACTLY THE THREE REASONS loadKey() RAISES — key_missing,
  // key_format, key_length (see isKeyLevelReason in plaidRevocation.ts). It is
  // NOT every crypto failure that looks deployment-wide to a reader:
  //
  //   - unknown_version — a row whose tag this build does not understand — is
  //     classified crypto_row, NOT crypto_config, so it does NOT arrive here. It
  //     falls through to the gate below and is answered 500 REVOKE_INCOMPLETE.
  //     An earlier version of this comment claimed the opposite. Whoever adds
  //     key rotation should decide deliberately whether a v2 row under a v1
  //     build deserves the configuration answer; today it does not get it.
  //   - auth_failed from a WRONG key VALUE is also crypto_row, for the reason
  //     classifyCryptoFailure documents: it is indistinguishable from a single
  //     corrupt row by the error alone.
  //
  // So this branch catches less than its name suggests, and the gate below is
  // what actually stops the deletion in the other cases.
  // ---------------------------------------------------------------------
  if (summary.sawCryptoConfigFailure) {
    emit(
      deps,
      "[account-delete] stopping after revocation: key-level crypto failure; " +
        `remaining=${summary.remaining}`
    );
    return failure(503, SERVER_FAULT_MESSAGE, "PLAID_CRYPTO_UNCONFIGURED");
  }

  // ---------------------------------------------------------------------
  // Step 3b. THE GATE. Any connection whose row is still there is a connection
  // whose Item we did not confirm revoked, and its row holds the only copy of
  // the token that could revoke it later. Deleting the account now would throw
  // that copy away.
  //
  // `remaining` never grows across calls — a connection that succeeds loses its
  // row and drops out of the next read — so for a transient failure a retry
  // converges on 0 and the deletion completes then.
  //
  // ⚠️ NOT EVERY FAILURE IS TRANSIENT, and an earlier version of this comment
  // asserted convergence without qualification. Two cases never converge (they
  // are named in full on revokeAndDeleteConnections): a row whose Item was
  // revoked but whose delete failed twice, and a row whose ciphertext is
  // corrupt while the key is fine. Both fail identically on every retry, so
  // this gate refuses forever and that user CANNOT complete an account
  // deletion. No recovery path exists in the code — it is an open item, not an
  // oversight, and not something to work around by loosening this gate.
  // ---------------------------------------------------------------------
  if (summary.remaining > 0) {
    emit(
      deps,
      `[account-delete] stopping before user deletion: remaining=${summary.remaining}`
    );
    return failure(500, RETRYABLE_MESSAGE, "REVOKE_INCOMPLETE");
  }

  // ---------------------------------------------------------------------
  // Step 4. Delete the public.users row. FK ON DELETE CASCADE removes the child
  // tables (survey_responses, recommendations_new, posts, comments,
  // chat_sessions, chat_messages, user_facts, chat_summaries, admin_users).
  //
  // A query error is fatal. Deleting 0 rows is NOT: on a retry after step 5
  // failed, the row is already gone and this retry must still reach step 5 to
  // finish. Erroring on 0 rows would break that convergence, so it is logged as
  // an anomaly instead of being silent.
  // ---------------------------------------------------------------------
  const usersResult = await deps.deleteUsersRow(userId);
  if (usersResult.error) {
    emit(deps, "[account-delete] failed to delete the public.users row");
    return { status: 500, body: { error: USERS_DELETE_FAILED_MESSAGE } };
  }
  if (usersResult.deletedCount === 0) {
    emit(
      deps,
      `[account-delete] users row already absent for ${userId} — idempotent retry or anomaly`
    );
  }

  // ---------------------------------------------------------------------
  // Step 5. Delete the Supabase Auth user. Most irreversible, therefore last:
  // deleting it first would invalidate the token this request authenticated
  // with and block everything above.
  // ---------------------------------------------------------------------
  const authResult = await deps.deleteAuthUser(userId);
  if (authResult.error) {
    // Half-deleted: the profile and its children are gone, the login remains.
    // Say so explicitly — never report success.
    emit(deps, "[account-delete] failed to delete the auth user");
    return { status: 500, body: { error: AUTH_DELETE_FAILED_MESSAGE } };
  }

  return { status: 200, body: { ok: true } };
}
