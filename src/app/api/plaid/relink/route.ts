import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  PLAID_COUNTRY_CODES,
  isPlaidConfigured,
} from "@/lib/plaid";
import { isSupabaseAdminConfigured } from "@/lib/supabase";
import { readNonEmptyString } from "@/lib/requestJson";
import {
  authenticate,
  getPlaidConnectionByItemId,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import {
  decryptPlaidAccessToken,
  isPlaidTokenCryptoConfigured,
} from "@/lib/plaidTokenCrypto";

/** Retryable by the user: the connection could not be read this time. */
const RELINK_RETRY_MESSAGE =
  "We couldn't start re-linking right now. Please try again in a moment.";

/**
 * A fault in OUR configuration. Worded without "try again", as in
 * /api/plaid/disconnect: the client shows this string to the user, and
 * retrying does not change a missing key.
 */
const SERVER_FAULT_MESSAGE =
  "Something went wrong on our end. Please check back in a moment.";

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured() || !isPlaidTokenCryptoConfigured()) {
      // Re-linking needs the EXISTING access token to build an update-mode link
      // token, so without PLAID_TOKEN_ENCRYPTION_KEY this route cannot run.
      return NextResponse.json(
        { error: "Plaid is not configured" },
        { status: 503 }
      );
    }

    // The service-role key must exist before anything here reads the database.
    // Checked before authenticate() because authenticate() would answer first
    // and answer wrong: verifying the token builds a server client, which
    // throws without the key, and that throw comes back as "no user" — a 401
    // that blames the caller's session for our configuration. Same status,
    // code and message as the same gate in /api/plaid/disconnect.
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: SERVER_FAULT_MESSAGE, code: "ADMIN_UNCONFIGURED" },
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

    // Look up the specific connection by item_id. Multi-connection safe:
    // getPlaidConnection used .single() and returned null (→ 404 "Connection
    // not found") whenever the user had more than one connection. Looking up by
    // (user_id, item_id) — which is UNIQUE — also makes the old item_id mismatch
    // check redundant.
    const lookup = await getPlaidConnectionByItemId(userId, itemId);

    // A FAILED READ IS NOT AN ABSENT ROW. Telling the user "Connection not
    // found" when the query failed would report a database fault as a fact
    // about their bank, so the failure gets its own retryable 500 and the
    // absence keeps its 404. The failure is decided first: `{ ok: false }` has
    // no `connection`, so checking absence first would absorb every failure.
    if (!lookup.ok) {
      return NextResponse.json(
        { error: RELINK_RETRY_MESSAGE, code: "CONNECTION_READ_FAILED" },
        { status: 500 }
      );
    }
    if (!lookup.connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
    const connection = lookup.connection;

    // Decrypt ABOVE the try, deliberately. The catch below re-throws every
    // error, so a decrypt failure would reach the same place either way — but
    // the log line it passes through on the way ("Error creating update link
    // token") would then name the wrong step. Hoisting it keeps a configuration
    // fault from being recorded as a Plaid API fault.
    //
    // userId is the verified-token value, unmodified: it is the AAD this
    // ciphertext was bound to when the connection was stored.
    const accessToken = decryptPlaidAccessToken(
      connection.access_token,
      userId
    );

    // Create a new link token in "update" mode using the existing access token
    // This allows the user to re-authenticate their bank login.
    //
    // No `products`: the Plaid SDK's LinkTokenCreateRequest documents that the
    // field should be omitted when launching Link in update mode, unless update
    // mode is being used to add a credit product, which this route never does.
    try {
      const response = await plaidClient.linkTokenCreate({
        user: {
          client_user_id: userId,
        },
        client_name: "Noor",
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
        redirect_uri: process.env.PLAID_REDIRECT_URI,
        access_token: accessToken, // This makes it an "update" mode link
      });

      // No status write here. This runs BEFORE the user has re-authenticated —
      // they may abandon Link or fail the bank's login — so marking the
      // connection active at this point would record a repair that has not
      // happened. Completing update mode does not reach the server either (the
      // client no longer exchanges its public token), so nothing writes status
      // on the re-link path.
      return NextResponse.json({
        success: true,
        linkToken: response.data.link_token,
        expiration: response.data.expiration,
        message:
          "Please re-authenticate your bank account in the Plaid Link window",
      });
    } catch (error) {
      console.error("Error creating update link token:", error);
      throw error;
    }
  } catch (error: unknown) {
    console.error("Error relinking bank account:", error);
    return handlePlaidError(error);
  }
}
