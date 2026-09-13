import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "./supabase";
import { getAuthenticatedUserIdFromRequest } from "./apiAuth";
import { getPlaidErrorCode, getPlaidErrorStatus } from "./plaidErrorRedaction";
import { asPlainObject, readRequestJson } from "@/lib/requestJson";
import { encryptPlaidAccessToken } from "./plaidTokenCrypto";

/**
 * Authenticate Plaid API requests via Supabase Bearer JWT.
 * userId comes only from the token; any client-supplied userId in the body is ignored.
 */
export async function authenticate(
  request: NextRequest
): Promise<{ userId: string; body: Record<string, unknown> } | null> {
  try {
    const userId = await getAuthenticatedUserIdFromRequest(request);
    if (!userId) {
      return null;
    }

    const raw = await readRequestJson(request);
    const body: Record<string, unknown> = { ...asPlainObject(raw) };
    delete body.userId;

    return { userId, body };
  } catch {
    return null;
  }
}

/**
 * The three states a single-row read can be in.
 *
 * This is the single-row mirror of what getAllPlaidConnections does with
 * `T[] | null`, and it exists for the same reason: "the query failed" and "this
 * row does not exist" are different facts, and a `T | null` return can only
 * carry one of them.
 *
 * It is a discriminated union rather than another nullable because `ok` has to
 * be read before `connection` can be. A caller that forgets the failure case
 * does not compile — which is the property the list helper gets from its return
 * type too, and the property the previous `row | null` shape did not have.
 *
 *   { ok: false }                   the read FAILED; nothing is known
 *   { ok: true,  connection: null } the read succeeded; there is no such row
 *   { ok: true,  connection: row }  the read succeeded and returned this row
 */
export type ConnectionLookup<T> =
  | { ok: true; connection: T | null }
  | { ok: false };

/**
 * Decide what a single-row plaid_connections read means.
 *
 * Pure and exported for the same reason connectionRowsOrNull is: the decision
 * gets a regression line that needs no database and no mock.
 *
 * A PostgREST error is a failure. `null` data with no error is what maybeSingle
 * returns for zero rows, and that is an absence, not a failure. There is no
 * "unexpected shape" branch here, unlike the list version — maybeSingle has no
 * shape to get wrong, it either resolves a row object or null.
 */
export function connectionRowOrFailure<T>(result: {
  data: T | null;
  error: unknown;
}): ConnectionLookup<T> {
  if (result.error) {
    return { ok: false };
  }
  return { ok: true, connection: result.data ?? null };
}

/**
 * Get a single Plaid connection for a user by its item_id.
 *
 * Uses maybeSingle() (not single()): (user_id, item_id) is UNIQUE, so the result
 * is 0 or 1 row and maybeSingle() never errors on "not exactly one" the way
 * single() does when a user has multiple connections.
 *
 * ⚠️ THIS USED TO RETURN `row | null` AND FOLD A FAILED QUERY INTO THE null.
 * That made a database hiccup indistinguishable from "this connection is
 * already gone", and /api/plaid/disconnect read the null as the latter and
 * answered 200 { success: true } — telling the user their bank was removed
 * while the row and its live Plaid Item both survived. Under the revoke-before-
 * delete rule that is the worst possible answer to a failed read, and it is the
 * same defect getAllPlaidConnections' nullable return exists to prevent on the
 * list side. The distinction has to live HERE because this function is the only
 * place that ever sees `error`; a caller cannot recover it afterwards.
 *
 * The catch is a failure too, not an absence: createServerClient() throws on
 * missing env, and reporting that as "no such row" would resurrect the same bug
 * through the other door.
 */
export async function getPlaidConnectionByItemId(userId: string, itemId: string) {
  try {
    const supabase = createServerClient();
    const result = await supabase
      .from("plaid_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("item_id", itemId)
      .maybeSingle();

    if (result.error) {
      console.error("Error fetching Plaid connection by item_id:", result.error);
    }

    return connectionRowOrFailure(result);
  } catch (error) {
    console.error("Error fetching Plaid connection by item_id:", error);
    // `as const` keeps `ok` a literal type, so the union this function returns
    // stays discriminated and callers can still narrow on it.
    return { ok: false } as const;
  }
}

/**
 * Get an active Plaid connection for a user at a given institution, or null.
 *
 * Used for app-level duplicate detection (same user re-linking a bank they
 * already have). Only rows with a matching non-null institution_id are found,
 * so it detects duplicates only among connections created after the
 * institution_id column shipped (pre-existing rows are NULL — see design §5).
 *
 * NOTE: this is UX-grade detection, NOT a security boundary. The institution_id
 * used to call it originates from the client; a forged value only affects the
 * caller's own rows. The persisted institution_id is the server-confirmed value.
 *
 * Throws on a query error so the caller can decide the fail direction
 * (exchange-token fails open — see its call site).
 */
export async function getActivePlaidConnectionByInstitution(
  userId: string,
  institutionId: string
) {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("plaid_connections")
    .select("item_id,institution_name")
    .eq("user_id", userId)
    .eq("institution_id", institutionId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * The plaid_connections columns the callers of getAllPlaidConnections actually read.
 *
 * THIS IS NOT A SCHEMA DEFINITION. It is a view of the row, derived from the
 * call sites rather than from the table: `select("*")` returns every column and
 * this names only the four that are consumed. It is deliberately NOT exported,
 * so no other module can pick it up and read it as a description of the table.
 * A full-row type copied from supabase/migrations/ is the thing to avoid here —
 * the migrations directory is not the source of truth for this table, and the
 * interface this replaces contradicted those migration files in several ways at
 * once. Note what that does and does not establish: the live database has never
 * been queried here, so the old interface is known to disagree with the
 * migrations, not known to disagree with the live table. Either way it was not a
 * type anything could rely on.
 *
 * ⚠️ `access_token` holds CIPHERTEXT, not a usable Plaid token (PL1). Every
 * value in this column is `v<n>:<iv>:<authTag>:<ciphertext>` produced by
 * plaidTokenCrypto.ts, and the database enforces that shape with a CHECK
 * constraint. It CANNOT be handed to the Plaid SDK: it must first go through
 * `decryptPlaidAccessToken(row.access_token, userId)`, with a userId taken
 * verbatim from the verified token, because that userId is the additional
 * authenticated data the ciphertext is bound to.
 *
 * An earlier version of this comment said the opposite — that the value "is
 * passed straight to the Plaid SDK, which requires a string" — and that was
 * true when it was written. The type is still `string` because that is what
 * PostgREST returns for a TEXT column; the string is simply no longer a
 * credential. The compile-time type cannot express the difference, so the
 * guarantee that no route passes this field to the SDK undecrypted is held by
 * src/lib/__tests__/plaidTokenReadSites.test.ts instead.
 *
 * `status` is deliberately left as `string | null` rather than narrowed to
 * "active" | "error": the live schema is unverified, and the CHECK constraint in
 * the migration passes NULL. Callers compare it to "active" and that is enough.
 */
interface PlaidConnectionView {
  access_token: string;
  item_id: string;
  institution_name: string | null;
  status: string | null;
}

/**
 * Decide what a plaid_connections list read means, given what PostgREST returned.
 *
 * Pure and exported so the distinction below has a regression line that needs no
 * database and no mock (mirroring the pure/IO split of plaidChatContext.ts and
 * plaidChatState.ts).
 *
 *   null      = the read FAILED; nothing is known about this user's rows.
 *   []        = the read SUCCEEDED and the user genuinely has no rows.
 *   [rows...] = the read succeeded and returned these rows, unfiltered.
 *
 * A response that is neither an error nor an array is not a shape PostgREST
 * produces for a list query. It is reported as a failure rather than as an empty
 * result, because "we don't know" is the honest reading of an unexpected shape
 * and is the direction that cannot invent a wrong answer.
 */
export function connectionRowsOrNull<T>(result: {
  data: T[] | null;
  error: unknown;
}): T[] | null {
  if (result.error) {
    return null;
  }
  if (!Array.isArray(result.data)) {
    return null;
  }
  return result.data;
}

/**
 * Get all Plaid connections for a user, or null if the read failed.
 *
 * Returning null rather than [] on failure is the point of this helper. An empty
 * array used to mean both "the query failed" and "this user has no bank
 * connected", so every caller reported a database hiccup as "no bank connected"
 * — which on the money screen shows the connect-a-bank card to an already
 * connected user and pushes them toward a duplicate connection row, and on the
 * dashboard clears the cached accounts and transactions.
 *
 * It returns null rather than throwing, and the reason is type-level, not
 * behavioral. `PlaidConnectionView[] | null` puts the failure case in the return
 * type, so a caller that ignores it does not compile; a throw is invisible to the
 * compiler and gets absorbed by whatever outer catch happens to be in scope.
 *
 * The fail direction now differs across the three callers, and it did not
 * always. Both data routes convert the null straight back into a throw and land
 * in their own outer catch, so a failed read is answered with the 500 and the
 * generic "There was a problem reaching your bank" that handlePlaidError
 * produces for any error carrying no Plaid error_code — which is also what
 * throwing from here would produce.
 *
 * /api/account/delete used to catch and carry on either way, because its Plaid
 * revocation was best-effort. It no longer does: a row is now deleted only after
 * its Plaid Item has actually been revoked, so a read that failed cannot report
 * whether an un-revoked connection is about to be destroyed. That route answers
 * the null by REFUSING to delete the account. If this helper is ever changed to
 * report a failed read as [], that route silently starts deleting accounts whose
 * bank connections were never revoked — with the tokens that could have revoked
 * them.
 *
 * What the null does buy at the routes is not the 500 — it is not emitting the
 * 404. That 404's wording is string-matched by the money and dashboard screens;
 * a generic 500 matches nothing, so the connect-a-bank card stays hidden and the
 * cached data survives.
 *
 * Rows are returned UNFILTERED, including status != 'active'. Callers filter for
 * themselves: /api/account/delete needs the inactive ones to revoke their Plaid
 * Items, and filtering here in SQL would also re-merge "no rows" with "rows, none
 * active" — the distinction this helper exists to keep.
 */
export async function getAllPlaidConnections(
  userId: string
): Promise<PlaidConnectionView[] | null> {
  try {
    const supabase = createServerClient();
    const result = await supabase
      .from("plaid_connections")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (result.error) {
      console.error("Error fetching Plaid connections:", result.error);
    } else if (!Array.isArray(result.data)) {
      // The other path connectionRowsOrNull folds to null. Without this line it
      // is the one failure exit that logs nothing, leaving a caller's own
      // "Failed to read Plaid connections" as the only trace and no clue as to
      // why. Logs the SHAPE only, never the payload: a row carries a Plaid
      // access token.
      console.error(
        "Error fetching Plaid connections: unexpected payload shape, data was",
        result.data === null ? "null" : typeof result.data
      );
    }

    return connectionRowsOrNull<PlaidConnectionView>(result);
  } catch (error) {
    console.error("Error fetching Plaid connections:", error);
    return null;
  }
}

/**
 * Store Plaid connection in database.
 *
 * THIS FUNCTION IS THE ENCRYPTION BOUNDARY (PL1). It is the only place in the
 * repo that writes plaid_connections.access_token, so encrypting here — rather
 * than at the one caller — means a future second caller cannot forget to. The
 * `accessToken` parameter is PLAINTEXT, as Plaid issued it; what reaches the
 * database is ciphertext.
 *
 * `userId` is doing two jobs: it is the row's owner AND the additional
 * authenticated data the ciphertext is bound to. It must be the value from the
 * verified token, unmodified — no trim, no casing change — because every read
 * site has to reproduce it byte-for-byte to decrypt.
 *
 * Encryption failures are NOT caught by the try below: encryptPlaidAccessToken
 * throws before the insert is built, so a missing or malformed
 * PLAID_TOKEN_ENCRYPTION_KEY propagates to the caller instead of being folded
 * into this function's `return null` ("Failed to save connection"). That is
 * deliberate — a configuration fault and a database fault are different events
 * and must not arrive as the same one. The route's outer catch turns it into
 * the generic 500. There is no branch here that stores a plaintext token.
 */
export async function storePlaidConnection(
  userId: string,
  accessToken: string,
  itemId: string,
  institutionName: string,
  institutionId: string | null
) {
  const encryptedAccessToken = encryptPlaidAccessToken(accessToken, userId);

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plaid_connections")
      .insert({
        user_id: userId,
        access_token: encryptedAccessToken,
        item_id: itemId,
        institution_name: institutionName,
        institution_id: institutionId,
        status: "active",
      })
      .select()
      .single();

    if (error) {
      console.error("Error storing Plaid connection:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error storing Plaid connection:", error);
    return null;
  }
}

/**
 * Update Plaid connection status
 */
export async function updatePlaidConnectionStatus(
  userId: string,
  itemId: string,
  status: "active" | "error"
) {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plaid_connections")
      .update({ status })
      .eq("user_id", userId)
      .eq("item_id", itemId)
      .select()
      .single();

    if (error) {
      console.error("Error updating Plaid connection status:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error updating connection status:", error);
    return null;
  }
}

/**
 * Delete Plaid connection
 */
export async function deletePlaidConnection(userId: string, itemId: string) {
  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("plaid_connections")
      .delete()
      .eq("user_id", userId)
      .eq("item_id", itemId);

    if (error) {
      console.error("Error deleting Plaid connection:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error deleting connection:", error);
    return false;
  }
}

/**
 * The re-auth signal the frontend keys on. `money`'s fetchData shows its
 * "Re-link bank" affordance on exactly this string, so it is a contract, not a
 * label — do not rename it without changing every consumer.
 */
const RELINK_ERROR_TYPE = "ITEM_LOGIN_REQUIRED";

/**
 * User-facing strings. These are rendered VERBATIM: every consumer reads the
 * response body's `error` key through `readErrorMessage` and puts it straight
 * on screen. That is why an internal message must never reach this object — the
 * defect this mapping replaces surfaced axios' own "Request failed with status
 * code 400" to users. The raw error is still logged by each route before it
 * gets here, so nothing is lost for diagnosis.
 */
const RELINK_MESSAGE = "Bank connection expired. Please re-link your account.";
const GENERIC_MESSAGE = "There was a problem reaching your bank. Please try again.";

type MappedPlaidError = {
  status: number;
  errorType?: string;
  message: string;
};

/**
 * Map a Plaid error_code to an HTTP response shape.
 *
 * Allow-list by construction: only the codes named here get a specific
 * treatment, and only the two re-auth codes are allowed to produce
 * RELINK_ERROR_TYPE. An unrecognised code can never acquire it by accident,
 * which is what keeps a configuration failure from being presented to the user
 * as "your bank connection expired" (see INVALID_API_KEYS below).
 */
function mapPlaidError(
  code: string | undefined,
  status: number | undefined
): MappedPlaidError {
  // Not a Plaid API error at all — a Supabase failure, a runtime TypeError, a
  // thrown primitive. Nothing to diagnose from the client's side.
  if (code === undefined) {
    return { status: 500, message: GENERIC_MESSAGE };
  }

  switch (code) {
    // Both mean "the user must re-authenticate with their bank", so they are
    // normalised onto one errorType and the frontend needs only one branch.
    case "ITEM_LOGIN_REQUIRED":
    case "INVALID_ACCESS_TOKEN":
      return {
        status: 401,
        errorType: RELINK_ERROR_TYPE,
        message: RELINK_MESSAGE,
      };

    // OUR credentials are wrong (wrong secret, or a PLAID_ENV that does not
    // match the key pair) — nothing about the USER's connection is broken.
    // Deliberately NOT the re-link type and deliberately worded without any
    // suggestion to reconnect: prompting a re-link here would send the user in
    // a loop they cannot exit, and could mint a duplicate connection row.
    case "INVALID_API_KEYS":
      return {
        status: 500,
        errorType: "CONFIGURATION_ERROR",
        message: "Bank data is temporarily unavailable. Please try again later.",
      };

    case "RATE_LIMIT_EXCEEDED":
      return {
        status: 429,
        errorType: "RATE_LIMIT_EXCEEDED",
        message:
          "Too many requests to your bank. Please try again in a few minutes.",
      };

    default: {
      // A Plaid error we have not mapped individually. Surface Plaid's own
      // status when it is a 4xx (the client's request was refused); anything
      // else — a Plaid 5xx, or a transport failure with no response — is our
      // problem to report as a 500.
      const isClientError =
        typeof status === "number" && status >= 400 && status <= 499;
      return {
        status: isClientError ? status : 500,
        errorType: "PLAID_ERROR",
        message: GENERIC_MESSAGE,
      };
    }
  }
}

/**
 * Turn a caught Plaid error into the HTTP response for it.
 *
 * Judgment is made on the Plaid `error_code`, never on `error.message`: the SDK
 * rejects with an AxiosError whose message axios builds as "Request failed with
 * status code <n>", so the previous message-matching branches could not match
 * and every Plaid failure collapsed into a 500.
 *
 * This function does NOT write connection state. Marking a connection as
 * errored has to move together with the frontend's hasActive/connect-card
 * contract, so it is deliberately absent here — a mapping that returned 401
 * AND flipped a row to "error" would hide the re-link affordance on the next
 * page load and could produce a duplicate connection row.
 */
export function handlePlaidError(error: unknown): NextResponse {
  const code = getPlaidErrorCode(error);
  const mapped = mapPlaidError(code, getPlaidErrorStatus(error));

  // Named decision line for live verification. Both values are allow-listed by
  // the redaction layer, so this cannot print a credential or a balance.
  console.error(
    `[plaid-error] code=${code ?? "none"} -> status=${mapped.status} errorType=${
      mapped.errorType ?? "none"
    }`
  );

  return NextResponse.json(
    {
      error: mapped.message,
      ...(mapped.errorType ? { errorType: mapped.errorType } : {}),
      ...(code ? { errorCode: code } : {}),
    },
    { status: mapped.status }
  );
}
