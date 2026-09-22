import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { isPlaidConfigured } from "@/lib/plaid";
import { getAllPlaidConnections } from "@/lib/plaidApiUtils";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";
import {
  liveRevocationDeps,
  revokeAndDeleteConnections,
} from "@/lib/plaidRevocation";
import { deleteAccountForUser } from "@/lib/accountDeletion";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/delete — permanent GDPR account deletion.
 *
 * Identity comes ONLY from the verified Bearer JWT. No id is read from the
 * request body — it is neither accepted nor trusted.
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
 * configuration accident (a rotation that left the old key behind, Production
 * and Preview carrying different values, a mistyped env var), and every one of
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
 * ⚠️ "THE RETRY CONVERGES" IS NOT UNCONDITIONAL, and this header used to say it
 * as though it were. Two failures repeat forever — a row whose Item was revoked
 * but whose delete failed both attempts, and a row whose ciphertext is corrupt
 * under a working key — and a user holding either CANNOT complete an account
 * deletion at all. They are named in full on revokeAndDeleteConnections in
 * plaidRevocation.ts, and the gate in accountDeletion.ts repeats the warning
 * where it refuses. There is no recovery path in the code today. Do not cite
 * convergence as the reason this trade is acceptable without also citing them.
 *
 * THIS FILE IS WIRING, NOT DECISION. Every branch lives in
 * src/lib/accountDeletion.ts, and the ordering rationale is documented there.
 * The split exists because the guarantee that matters is a negative one — when
 * a bank connection could not be revoked, the user's rows are NOT deleted — and
 * a negative guarantee has to be observed as a call that did not happen. This
 * route cannot be executed offline (it authenticates first, and nothing in the
 * suite fakes that boundary), so the decision moved to where it can be:
 * accountDeletion.test.ts runs every branch with injected fakes.
 *
 * Keep it that way. A branch added here instead of there is a branch nothing
 * tests.
 */
export async function POST(request: NextRequest) {
  const authUserId = await getAuthenticatedUserIdFromRequest(request);
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // getAllPlaidConnections is contracted to report every failure by returning
    // null; the catch is here because this route is the wrong place to discover
    // that the contract changed. A throw would otherwise escape POST entirely
    // (there is no outer catch) and Next would answer with a bodiless 500,
    // losing the named CONNECTION_READ_FAILED answer. Both directions refuse to
    // delete, so this costs nothing and keeps the response legible.
    listConnections: async (userId) => {
      try {
        return await getAllPlaidConnections(userId);
      } catch (error) {
        console.error(
          "account/delete: getAllPlaidConnections threw, which its contract " +
            "says it does not; treating as a failed read:",
          error
        );
        return null;
      }
    },

    revokeAll: (userId, connections) =>
      revokeAndDeleteConnections(userId, connections, liveRevocationDeps()),

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
