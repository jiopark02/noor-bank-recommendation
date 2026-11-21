import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { getAuthenticatedUserFromRequest } from "@/lib/apiAuth";
import { buildAccountExport, makeSupabasePageReader } from "@/lib/accountExport";
import { requireRecentReauth } from "@/lib/accountReauth";
import { liveReauthGateDeps, reauthResponse } from "@/lib/accountReauthRoute";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/export — GDPR data export.
 *
 * Returns the caller's own data as a downloadable JSON file. Identity comes
 * ONLY from the verified Bearer JWT: the user's id, their address and whether
 * that address is confirmed. Every query is filtered by that id, or, for the
 * invites made to the user, by the confirmed address. Which tables are read,
 * and how each is paged, lives in src/lib/accountExport.ts.
 *
 * Before any section is read the route requires a recent email-code
 * verification for "export_data" (requireRecentReauth, accountReauth.ts),
 * and the check uses it up, so one verification answers one export: 403
 * REAUTH_REQUIRED without one, 503 REAUTH_CHECK_UNAVAILABLE when it cannot be
 * checked, unless ACCOUNT_REAUTH_MODE is exactly "off".
 *
 * Deliberately excluded:
 *   - plaid_connections.access_token — a live bank credential; only
 *     institution_name / status / item_id / id are exported.
 *   - admin_users — internal access-control data, not user-owned content.
 *   - waitlist_signups — pre-signup data with no user_id link.
 *   - user_id in sections with an explicit column list — the payload's
 *     top-level user_id already carries it.
 *   - grantee_user_id in share_grants and share_prompt_answers — the other
 *     member's identifier is their personal data.
 *   - account_reauth_codes.code_hash — the keyed hash of a one-time code,
 *     nothing the user entered or can use.
 *
 * If any page of any section fails, the whole export returns 500 rather than
 * silently handing back an incomplete file the user believes is complete.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A recent email-code verification for this purpose, read from the
  // database and used up by the same check, before any section is read.
  const reauth = await requireRecentReauth(liveReauthGateDeps(), user.id, "export_data");
  if (!reauth.ok) {
    return reauthResponse(reauth);
  }

  const admin = createAdminClient();
  const result = await buildAccountExport(
    {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
      emailConfirmed: Boolean(user.email_confirmed_at),
    },
    makeSupabasePageReader(admin)
  );

  if (result.status !== 200) {
    console.error("account/export: query failed for tables:", result.failedSections);
    return NextResponse.json(result.body, { status: 500 });
  }

  return new NextResponse(JSON.stringify(result.body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="noor-data-export.json"',
    },
  });
}
