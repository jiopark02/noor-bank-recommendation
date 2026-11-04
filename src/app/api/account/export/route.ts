import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { buildAccountExport, makeSupabasePageReader } from "@/lib/accountExport";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/export — GDPR data export.
 *
 * Returns the caller's own data as a downloadable JSON file. Identity comes
 * ONLY from the verified Bearer JWT; every query is filtered by that id.
 * Which tables are read, and how each is paged, lives in
 * src/lib/accountExport.ts.
 *
 * Deliberately excluded:
 *   - plaid_connections.access_token — a live bank credential; only
 *     institution_name / status / item_id are exported.
 *   - admin_users — internal access-control data, not user-owned content.
 *   - waitlist_signups — pre-signup data with no user_id link.
 *   - user_id in sections with an explicit column list — the payload's
 *     top-level user_id already carries it.
 *
 * If any page of any section fails, the whole export returns 500 rather than
 * silently handing back an incomplete file the user believes is complete.
 */
export async function GET(request: NextRequest) {
  const authUserId = await getAuthenticatedUserIdFromRequest(request);
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const result = await buildAccountExport(
    authUserId,
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
