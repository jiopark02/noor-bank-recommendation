import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { makeHouseholdStore } from "@/lib/householdStore";
import { pruneHouseholdInvites } from "@/lib/householdInvite";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/prune-household-invites — deletes every expired household
 * invite through household_invites_prune_expired (src/lib/householdInvite.ts).
 *
 * The bearer check is the one the other cron routes make, and comes before
 * any client is built: CRON_SECRET unset or whitespace-only is 503, a missing
 * or different bearer is 401. Without the service-role key the answer is 503.
 * A failed call is 500.
 *
 * Nothing here decides whether an invite is usable: every read and the accept
 * function compare expires_at with the current time themselves, so a run that
 * fails or does not happen leaves expired rows stored longer and changes no
 * answer.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim() === "") {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured()) {
    console.error("[household-prune] outcome=admin_unconfigured");
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 503 }
    );
  }

  const result = await pruneHouseholdInvites(
    makeHouseholdStore(createAdminClient()),
    (line) => console.warn(line)
  );
  return NextResponse.json(result.body, { status: result.status });
}
