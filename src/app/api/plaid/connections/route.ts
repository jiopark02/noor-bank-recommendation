import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/plaid/connections — the authoritative bank-connection state for the
 * signed-in user, read from the plaid_connections table (NOT localStorage).
 *
 * The frontend uses this to decide "is a bank connected?" so that connection
 * state survives a localStorage purge (logout / shared-device cleanup / a new
 * device) instead of falsely showing "not connected".
 *
 * Identity comes ONLY from the verified Bearer JWT; the query is scoped by that
 * id. access_token is deliberately NOT selected — a live bank credential must
 * never leave the server (same principle as /api/account/export).
 */
export async function GET(request: NextRequest) {
  const authUserId = await getAuthenticatedUserIdFromRequest(request);
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("plaid_connections")
    // access_token intentionally omitted — never expose a bank credential.
    .select("item_id, institution_name, status, created_at")
    .eq("user_id", authUserId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("plaid/connections: query failed:", error);
    return NextResponse.json(
      { error: "Failed to load bank connections. Please try again." },
      { status: 500 }
    );
  }

  const connections = (data ?? []).map((row) => ({
    itemId: row.item_id as string,
    institutionName: (row.institution_name as string) ?? "",
    status: row.status === "active" ? "active" : "error",
    createdAt: row.created_at as string,
  }));

  return NextResponse.json({ success: true, connections });
}
