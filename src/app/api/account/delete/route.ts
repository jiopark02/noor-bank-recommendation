import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { isPlaidConfigured, plaidClient } from "@/lib/plaid";
import {
  getAllPlaidConnections,
  deleteAllPlaidConnections,
} from "@/lib/plaidApiUtils";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/delete — permanent GDPR account deletion.
 *
 * Identity comes ONLY from the verified Bearer JWT. No id is read from the
 * request body — it is neither accepted nor trusted.
 *
 * There is no single transaction available: this spans an external API (Plaid)
 * plus two internal systems (the public schema and Supabase Auth). Steps are
 * therefore ordered from "external / recoverable" to "irreversible", and each
 * is individually idempotent so a retry after a partial failure converges:
 *
 *   1. Plaid itemRemove per connection  (best-effort; revokes external access)
 *   2. Delete plaid_connections rows    (TEXT user_id, no cascade -> explicit)
 *   3. DELETE public.users              (FK ON DELETE CASCADE removes 9 children)
 *   4. auth.admin.deleteUser            (most irreversible -> last; deleting the
 *                                        auth user first would invalidate the
 *                                        token and block remaining cleanup)
 *
 * A partial failure (e.g. step 3 succeeds, step 4 fails) MUST surface as an
 * explicit 500 — never a silent success — so the user is not told "deleted"
 * while a login record still exists.
 */
export async function POST(request: NextRequest) {
  const authUserId = await getAuthenticatedUserIdFromRequest(request);
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Step 1: best-effort revocation of external Plaid access. Failures are
  // logged (with item_id) and skipped — they must not block DB/auth deletion,
  // and step 2 is what actually removes our stored access tokens. If Plaid is
  // not configured, skip the whole step.
  if (isPlaidConfigured()) {
    try {
      const connections = await getAllPlaidConnections(authUserId);
      for (const connection of connections) {
        try {
          await plaidClient.itemRemove({
            access_token: connection.access_token,
          });
        } catch (err) {
          console.error(
            `account/delete: Plaid itemRemove failed for item_id=${connection.item_id}:`,
            err
          );
          // continue — revocation is best-effort
        }
      }
    } catch (err) {
      console.error(
        "account/delete: failed to list Plaid connections for revocation:",
        err
      );
      // continue — revocation is best-effort
    }
  }

  const admin = createAdminClient();

  // Step 2: delete Plaid connection rows (not covered by any cascade).
  const plaidDeleted = await deleteAllPlaidConnections(authUserId);
  if (!plaidDeleted) {
    return NextResponse.json(
      {
        error:
          "Failed to delete bank connections. No account data was removed; please retry.",
      },
      { status: 500 }
    );
  }

  // Step 3: delete the public.users row. FK ON DELETE CASCADE removes the 9
  // child tables (survey_responses, recommendations_new, posts, comments,
  // chat_sessions, chat_messages, user_facts, chat_summaries, admin_users).
  //
  // A genuine query error is fatal (500). But deleting 0 rows is NOT an error:
  // on a retry after a partial failure (Step 3 succeeded, Step 4 failed) the
  // users row is already gone, and this retry must still reach Step 4 to finish
  // removing the auth user. Erroring on 0 rows would break that idempotent
  // convergence. We log a warning instead so the "already absent" case is
  // visible rather than silent.
  const { data: deletedUsers, error: usersError } = await admin
    .from("users")
    .delete()
    .eq("id", authUserId)
    .select("id");
  if (usersError) {
    console.error(
      "account/delete: failed to delete public.users row:",
      usersError
    );
    return NextResponse.json(
      { error: "Failed to delete account data. Please retry." },
      { status: 500 }
    );
  }
  if (!deletedUsers || deletedUsers.length === 0) {
    console.warn(
      `account/delete: users row already absent for ${authUserId} — idempotent retry or anomaly`
    );
  }

  // Step 4: delete the Supabase Auth user (most irreversible -> last).
  const { error: authError } = await admin.auth.admin.deleteUser(authUserId);
  if (authError) {
    // Half-deleted state: the profile and children are gone but the login
    // record remains. Surface it explicitly — never report success.
    console.error("account/delete: failed to delete auth user:", authError);
    return NextResponse.json(
      {
        error:
          "Your account data was deleted, but the login record could not be removed. Please contact support to finish deletion.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
