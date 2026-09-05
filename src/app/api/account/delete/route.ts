import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { isPlaidConfigured, plaidClient } from "@/lib/plaid";
import {
  getAllPlaidConnections,
  deleteAllPlaidConnections,
} from "@/lib/plaidApiUtils";
import { decryptPlaidAccessToken } from "@/lib/plaidTokenCrypto";

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
      if (connections === null) {
        // The read reported failure, so we cannot know which Items to revoke.
        // Deletion still proceeds. That is a CHOICE, not a forced move, and it
        // has a cost — both of which an earlier version of this comment got
        // wrong by asserting that blocking here would leave the user unable to
        // delete their account. Step 2 below already blocks on its own failure
        // (500, "please retry", nothing removed), so this route plainly can
        // block for a Plaid-row problem when it decides to.
        //
        // The cost, in the case that matters — the read fails but the delete
        // that follows succeeds: Step 2 destroys the rows, and the access token
        // in them is the only copy held anywhere in this system. Skipping
        // revocation and then deleting leaves the Plaid Item live on Plaid's
        // side with nothing left to revoke it with, permanently. When the DB is
        // broken enough that Step 2 fails too, that does not arise — the request
        // 500s and a retry can still revoke.
        //
        // Chosen anyway: revocation is best-effort here by design, the deletion
        // is the user's own request, and the behavior is unchanged from before
        // this branch existed — a failed read was previously indistinguishable
        // from "this user had none" and took the same path. The branch exists to
        // say which of the two happened, in the log, not to change what happens.
        console.error(
          "account/delete: Plaid connection read reported failure (returned null); " +
            "skipping revocation"
        );
      } else {
        for (const connection of connections) {
          // THE ONE DELIBERATE EXCEPTION to PL1's fail-closed rule.
          //
          // Everywhere else a decrypt failure throws and the request fails,
          // because silently skipping it would misreport a key problem as "no
          // data". Here it is caught and the loop continues, because this step
          // is best-effort by design (see the header above) and account
          // deletion is the user's own request — refusing to delete their
          // account because a token cannot be decrypted would be a worse
          // outcome, and it would not buy anything: a token that cannot be
          // decrypted cannot be used to revoke the Item either. The Item is
          // already unrevokable at that point, which is the same end state
          // CLAUDE.md already records for a deleted row.
          //
          // Its own try, and its own log line: a decrypt failure and an
          // itemRemove failure are different events and must stay
          // distinguishable in the logs.
          let accessToken: string;
          try {
            accessToken = decryptPlaidAccessToken(
              connection.access_token,
              authUserId
            );
          } catch (err) {
            console.error(
              `account/delete: could not decrypt the stored Plaid access token ` +
                `for item_id=${connection.item_id}; skipping revocation for it ` +
                `(the Plaid Item will remain live and can no longer be revoked):`,
              err instanceof Error ? err.message : err
            );
            continue; // best-effort — deletion must still proceed
          }

          try {
            await plaidClient.itemRemove({
              access_token: accessToken,
            });
          } catch (err) {
            console.error(
              `account/delete: Plaid itemRemove failed for item_id=${connection.item_id}:`,
              err
            );
            // continue — revocation is best-effort
          }
        }
      }
    } catch (err) {
      // NO CURRENT PATH REACHES THIS, AND IT IS KEPT DELIBERATELY.
      //
      // getAllPlaidConnections reports every failure by RETURNING null: its try
      // block spans the whole function body, createServerClient() included (that
      // call throws on missing env, and is caught there, not here). So the null
      // branch above is the only way a failed read arrives, and nothing else left
      // in this try can throw — the loop is over an array the helper guarantees,
      // and each itemRemove has its own catch.
      //
      // This is therefore a defense that rests on a CONTRACT of the helper, not
      // on a property of this file. It stays because account deletion is the
      // wrong place to discover that the contract changed: if the helper is ever
      // made to throw, this is what keeps a best-effort revocation step from
      // failing the entire deletion request.
      //
      // Distinct event from the branch above — keep the two log lines
      // distinguishable. That one is a read that failed and said so; this one is
      // a read that broke the return-null contract.
      console.error(
        "account/delete: unexpected throw while listing Plaid connections " +
          "(getAllPlaidConnections is contracted to return null on failure); " +
          "skipping revocation:",
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
