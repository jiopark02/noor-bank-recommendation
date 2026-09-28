import { NextRequest } from "next/server";
import { createServerClient, createAdminClient, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Resolve the authenticated Supabase user id from a Bearer access token.
 * Do not trust client-supplied userId in body or query string.
 *
 * ⚠️ isSupabaseConfigured() does not cover createServerClient() below. The
 * predicate asks about the URL and the anon key; the constructor also requires
 * the service role key and throws without it. That throw is caught here and
 * reported as null, which its callers answer with a 401 — so a deployment
 * missing only the service role key looks to the user like a sign-in problem.
 * Fail-closed is the right direction; the misleading status is the cost.
 */
export async function getAuthenticatedUserIdFromRequest(
  request: NextRequest
): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    return null;
  }

  try {
    const supabase = createServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    return user.id;
  } catch {
    return null;
  }
}

// ============================================================================
// STEP 2 — requireAdmin helper (admin_users membership lookup)
// ============================================================================
// Add to: src/lib/apiAuth.ts, below getAuthenticatedUserIdFromRequest.
//
// Admin authorization model:
//   - Admin status lives in the admin_users table (service-role-only:
//     RLS on, no policies — users cannot read or write it).
//   - This helper verifies the caller's JWT, then checks admin_users
//     membership using the SERVICE ROLE client (createAdminClient), which
//     bypasses RLS. A user-JWT client would always see "not a member"
//     because RLS hides the table from regular users.
//
// Security properties:
//   1. Only a verified JWT identity is trusted — never any client-supplied
//      body/query/header value.
//   2. Email must be present AND confirmed (email_confirmed_at) — unconfirmed
//      accounts are rejected.
//   3. Membership is read with the service role, for the specific user id only.
//   4. Fail-closed: missing token, invalid token, unconfirmed email, or no
//      membership row all return null. The caller must respond 403 on null.
// ============================================================================

/**
 * Verify that a request comes from an admin user.
 *
 * All of the following must hold:
 *   - A valid Bearer access token (verified by Supabase Auth).
 *   - user.email present and user.email_confirmed_at set.
 *   - A matching row in admin_users for the user's id.
 *
 * @returns { userId, email } on success, otherwise null. Callers must treat
 *          null as "forbidden" (HTTP 403) and must NOT fall back to any
 *          client-provided identity.
 *
 * Security: the admin_users lookup needs a service-role client because
 * admin_users is RLS-locked to service role only. createAdminClient provides
 * one; createServerClient is service-role too, so the choice records intent
 * rather than granting anything extra.
 *
 * ⚠️ Same gap as getAuthenticatedUserIdFromRequest: isSupabaseConfigured() does
 * not cover the createServerClient() below, which also requires the service role
 * key. A missing key throws, is caught here, and returns null — which callers
 * answer with a 403.
 */
export async function requireAdmin(
  request: NextRequest
): Promise<{ userId: string; email: string } | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) {
    return null;
  }

  try {
    // Step 1: verify the JWT and resolve the user (id, email, confirmation).
    // createServerClient is fine here: getUser(token) validates the token
    // itself, so holding the service role key grants nothing extra at this step
    // — the authorization decision is step 2.
    const authClient = createServerClient();
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser(token);

    if (error || !user) {
      return null;
    }
    if (!user.email) {
      return null;
    }
    if (!user.email_confirmed_at) {
      // Reject unconfirmed-email accounts from admin access.
      return null;
    }

    // Step 2: check admin_users membership with the SERVICE ROLE client.
    // admin_users is RLS-locked (no policies); only the service role can read
    // it. We look up the caller's own id only — no client-supplied value.
    const admin = createAdminClient();
    const { data: membership, error: membershipError } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      // On lookup failure, fail closed (deny). Log for diagnosis.
      console.error("requireAdmin: admin_users lookup failed:", membershipError);
      return null;
    }
    if (!membership) {
      // No membership row → not an admin.
      return null;
    }

    return { userId: user.id, email: user.email };
  } catch (err) {
    // Any unexpected error → fail closed.
    console.error("requireAdmin: unexpected error:", err);
    return null;
  }
}
