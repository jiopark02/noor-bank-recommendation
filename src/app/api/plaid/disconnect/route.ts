import { NextRequest, NextResponse } from "next/server";
import { isPlaidConfigured } from "@/lib/plaid";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";
import { readNonEmptyString } from "@/lib/requestJson";
import {
  authenticate,
  getPlaidConnectionByItemId,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import {
  liveRevocationDeps,
  revokeAndDeleteConnection,
} from "@/lib/plaidRevocation";

/**
 * POST /api/plaid/disconnect — remove one bank connection.
 *
 * This route used to delete the row and nothing else. Its own comment said as
 * much: it described fetching the stored token and calling
 * plaidClient.itemRemove(), then skipped it, on the grounds that "the DB row
 * deletion is the important part". The row deletion was in fact the destructive
 * part — the row holds the ONLY copy of the stored token, so deleting it left
 * the Plaid Item live on Plaid's side with nothing left anywhere that could
 * revoke it. The user pressed "remove" and their bank access stayed open
 * forever.
 *
 * It now revokes first and deletes only on success. Every failure leaves the
 * row exactly where it was, so pressing the button again retries the whole
 * operation with nothing consumed in between.
 *
 * The pairing itself lives in plaidRevocation.ts, with the tests that execute
 * it. This file is wiring: preconditions, the row lookup, and the mapping from
 * one outcome to one response.
 */

/** Retryable by the user: something transient failed and trying again may work. */
const RETRYABLE_MESSAGE =
  "We couldn't disconnect this bank. Please try again in a moment. " +
  "If this keeps happening, please contact support.";

/**
 * A fault in OUR configuration. Deliberately worded WITHOUT "try again": the
 * user pressing the button ten more times changes nothing, and the retry
 * wording presents our misconfiguration as something they failed to do.
 */
const SERVER_FAULT_MESSAGE =
  "Something went wrong on our end. Please check back in a moment.";

export async function POST(request: NextRequest) {
  try {
    // Without PLAID_TOKEN_ENCRYPTION_KEY the stored token cannot be decrypted,
    // so the Item cannot be revoked, so under the pairing rule the row cannot be
    // deleted either. Refusing here reports that as the configuration fault it
    // is, at the same 503 the accounts/transactions/relink routes already use,
    // instead of as a per-connection failure.
    //
    // SERVER_FAULT_MESSAGE, not "Plaid is not configured", because this body is
    // now RENDERED TO THE USER. usePlaidConnections.disconnect returns the
    // `error` string of every non-2xx verbatim and money/page.tsx prints it —
    // previously a failed disconnect only reached the hook's internal `error`
    // and was displayed nowhere, so the wording of this branch had no audience.
    // It does now, and an internal configuration string is the wrong thing to
    // show someone who pressed "remove". Same message and same code as the
    // crypto_config outcome below, which is the same fault reached later.
    //
    // The 401 and 400 below stay as they are: both are resolved by
    // something the user or the client does, and their wording already says so.
    if (!isPlaidConfigured() || !isPlaidTokenCryptoConfigured()) {
      return NextResponse.json(
        { error: SERVER_FAULT_MESSAGE, code: "PLAID_CRYPTO_UNCONFIGURED" },
        { status: 503 }
      );
    }

    // Authenticate user
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, body } = auth;
    const itemId = readNonEmptyString(body, "itemId");

    if (!itemId) {
      return NextResponse.json(
        { error: "Item ID is required" },
        { status: 400 }
      );
    }

    // Scoped by (user_id, item_id), which is UNIQUE — one row or none, and a
    // forged item_id can only ever name the caller's own connection.
    const lookup = await getPlaidConnectionByItemId(userId, itemId);

    // A FAILED READ IS NOT AN ABSENT ROW. This route cannot tell the difference
    // by itself — the helper is the only place that sees the query error — which
    // is why the helper reports the two separately. Answering a failed read as
    // success would tell the user their bank was removed while the row and its
    // live Plaid Item both survive, which is the exact outcome the revoke-before-
    // delete rule exists to prevent. Same answer /api/account/delete gives a
    // failed connection read, and the same code, deliberately.
    if (!lookup.ok) {
      return NextResponse.json(
        { error: RETRYABLE_MESSAGE, code: "CONNECTION_READ_FAILED" },
        { status: 500 }
      );
    }

    // No row means the end state this request is asking for already holds.
    // Answered as success rather than 404, deliberately: it makes the route
    // idempotent, so a retry after a disconnect that actually succeeded does not
    // show the user an error for work that is already done. (relink answers 404
    // for the same lookup because it NEEDS the row; this route needs it gone.)
    if (!lookup.connection) {
      return NextResponse.json({ success: true });
    }

    const outcome = await revokeAndDeleteConnection(
      userId,
      lookup.connection,
      liveRevocationDeps()
    );

    if (outcome.ok) {
      return NextResponse.json({
        success: true,
        message: "Bank account disconnected successfully",
      });
    }

    // Deliberately NOT routed through handlePlaidError. That mapping turns
    // ITEM_LOGIN_REQUIRED / INVALID_ACCESS_TOKEN into a 401 carrying
    // errorType "ITEM_LOGIN_REQUIRED", and money/page.tsx keys its "Re-link
    // bank" affordance on exactly that string. Offering a re-link to a user who
    // asked to REMOVE the bank is the wrong instruction, and re-linking can mint
    // a duplicate connection row. handlePlaidError stays on the outer catch,
    // where the error is genuinely unexpected.
    switch (outcome.failure) {
      case "crypto_config":
        return NextResponse.json(
          { error: SERVER_FAULT_MESSAGE, code: "PLAID_CRYPTO_UNCONFIGURED" },
          { status: 503 }
        );
      case "row_delete":
        // The Item IS revoked; only the row survived. Reported separately from
        // REVOKE_FAILED because the two leave the system in different states and
        // a retry behaves differently in each.
        return NextResponse.json(
          { error: RETRYABLE_MESSAGE, code: "ROW_DELETE_FAILED" },
          { status: 500 }
        );
      default:
        // crypto_row and plaid. The row is untouched either way.
        return NextResponse.json(
          { error: RETRYABLE_MESSAGE, code: "REVOKE_FAILED" },
          { status: 500 }
        );
    }
  } catch (error: unknown) {
    console.error("Error disconnecting bank account:", error);
    return handlePlaidError(error);
  }
}
