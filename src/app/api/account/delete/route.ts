import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { isPlaidConfigured } from "@/lib/plaid";
import {
  getRevocableConnections,
  postgrestErrorCode,
} from "@/lib/plaidApiUtils";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";
import {
  liveRevocationDeps,
  revokeAndDeleteConnections,
} from "@/lib/plaidRevocation";
import { deleteAccountForUser } from "@/lib/accountDeletion";
import { requireRecentReauth } from "@/lib/accountReauth";
import { liveReauthGateDeps, reauthResponse } from "@/lib/accountReauthRoute";

export const dynamic = "force-dynamic";

// Literal, because the platform reads it statically. Must equal
// PLAID_REVOKE_ROUTE_MAX_DURATION_SECONDS (plaidRevocation.ts); a test holds it.
export const maxDuration = 300;

/**
 * POST /api/account/delete — permanent GDPR account deletion.
 *
 * Identity comes ONLY from the verified Bearer JWT. No id is read from the
 * request body — it is neither accepted nor trusted.
 *
 * Before anything else the route requires a recent email-code verification
 * for "delete_account" (requireRecentReauth, accountReauth.ts): 403
 * REAUTH_REQUIRED without one, 503 REAUTH_CHECK_UNAVAILABLE when it cannot be
 * checked, unless ACCOUNT_REAUTH_MODE is exactly "off".
 *
 * WHAT REPLACED THE "BEST-EFFORT REVOCATION" RULE, AND WHY
 * This route used to revoke each Plaid Item best-effort and then delete every
 * connection row regardless of the outcome. A decrypt failure in particular was
 * caught and skipped, under a rule recorded here and in CLAUDE.md as the one
 * deliberate exception to PL1's fail-closed discipline. The argument for it was
 * that skipping "would not buy anything: a token that cannot be decrypted
 * cannot be used to revoke the Item either."
 *
 * That argument rests on a premise that is false. A token that cannot be
 * decrypted TODAY is usually not lost — the dominant cause is a key
 * configuration accident (a rotation that left the old key behind, one table
 * written under two different keys, a mistyped env var), and every one of
 * those is reversible. Recover the key and the row decrypts again, and the Item
 * can be revoked then. Deleting the row throws that away: the ciphertext is the
 * only copy of the token, so the recovery path dies with it and the Item stays
 * live on Plaid's side permanently.
 *
 * So a row whose Item was not revoked is now kept, and the account deletion
 * stops rather than proceeding. That is a real cost to the user — their
 * deletion does not complete on that attempt — and it is the smaller one: for a
 * transient failure the retry converges, while a discarded token does not come
 * back.
 *
 * ⚠️ "THE RETRY CONVERGES" HAS ONE EXCEPTION, and this header used to name two.
 * A row whose ciphertext is corrupt under a working key fails identically on
 * every attempt, and a user holding one CANNOT complete an account deletion at
 * all. There is no recovery path in the code today. The other case — a row whose
 * Item was revoked but whose delete failed — converges now (observed on sandbox
 * 2026-09-27; production unobserved — see the provenance note in
 * plaidRevocation.ts's header): a confirmed absent Item is folded into success by
 * plaidRevocation.ts,
 * so the retry reaches the delete again. It is named in full on
 * revokeAndDeleteConnections there, and the gate in accountDeletion.ts repeats
 * the warning where it refuses. Cite the remaining exception, not both.
 *
 * THIS FILE IS WIRING, NOT DECISION. Every branch lives in
 * src/lib/accountDeletion.ts, and the ordering rationale is documented there.
 * The split exists because the guarantee that matters is a negative one — when
 * a bank connection could not be revoked, the user's rows are NOT deleted — and
 * a negative guarantee has to be observed as a call that did not happen. The
 * decision moved to where it can be observed without faking authentication:
 * accountDeletion.test.ts runs every branch with injected fakes.
 * accountActionReauthGate.test.ts executes this route with authentication faked,
 * for the reauthentication gate only.
 *
 * Keep it that way. A branch added here instead of there is a branch nothing
 * tests.
 */
export async function POST(request: NextRequest) {
  // The start of the request, before anything waits: the revocation loop's
  // time check counts from here, not from when the loop begins.
  const startedAt = Date.now();

  const authUserId = await getAuthenticatedUserIdFromRequest(request);
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A recent email-code verification for this purpose, read from the
  // database, before anything is revoked or deleted. Closed when it cannot be
  // checked. Not used up: a deletion that stops part-way is retried.
  const reauth = await requireRecentReauth(liveReauthGateDeps(), authUserId, "delete_account");
  if (!reauth.ok) {
    return reauthResponse(reauth);
  }

  // Constructed lazily and at most once. createAdminClient() THROWS when
  // SUPABASE_SERVICE_ROLE_KEY is missing, and the deletion flow refuses on
  // isSupabaseAdminConfigured() before it revokes anything — so this must not
  // run while the dependency object is being built, only inside the two steps
  // that reach it after that check has passed.
  let adminClient: SupabaseClient | null = null;
  const admin = (): SupabaseClient => {
    if (!adminClient) {
      adminClient = createAdminClient();
    }
    return adminClient;
  };

  const result = await deleteAccountForUser(authUserId, {
    isPlaidConfigured,
    isCryptoConfigured: isPlaidTokenCryptoConfigured,
    isAdminConfigured: isSupabaseAdminConfigured,

    // getRevocableConnections reads only the two columns a revocation needs and
    // is contracted to report every failure by returning null; the catch is
    // here because this route is the wrong place to discover that the contract
    // changed. A throw would otherwise escape POST entirely (there is no outer
    // catch) and Next would answer with a bodiless 500, losing the named
    // CONNECTION_READ_FAILED answer. Both directions refuse to delete, so this
    // costs nothing and keeps the response legible. Only the error's code is
    // logged, as the helper itself does: a value thrown from this read could
    // carry query details or row values.
    listConnections: async (userId) => {
      try {
        return await getRevocableConnections(userId);
      } catch (error) {
        console.error(
          "account/delete: getRevocableConnections threw, which its contract " +
            "says it does not; treating as a failed read: threw, code",
          postgrestErrorCode(error) ?? "none"
        );
        return null;
      }
    },

    revokeAll: (userId, connections) =>
      revokeAndDeleteConnections(userId, connections, liveRevocationDeps(), {
        startedAtMs: startedAt,
        now: Date.now,
      }),

    // The row count comes from .select("id"): a PostgREST delete returns the
    // deleted rows when a representation is requested, so `data.length` IS the
    // count. No separate count query, and no { count: "exact" } head request.
    // Zero is not an error here — see step 4 in accountDeletion.ts.
    deleteUsersRow: async (userId) => {
      const { data, error } = await admin()
        .from("users")
        .delete()
        .eq("id", userId)
        .select("id");
      return { deletedCount: data ? data.length : 0, error };
    },

    deleteAuthUser: async (userId) => {
      const { error } = await admin().auth.admin.deleteUser(userId);
      return { error };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
