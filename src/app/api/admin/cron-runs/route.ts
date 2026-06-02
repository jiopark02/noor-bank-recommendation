// ============================================================================
// STEP 3 — GET /api/admin/cron-runs
// ============================================================================
// File: src/app/api/admin/cron-runs/route.ts (new file)
//
// Admin-only, READ-ONLY endpoint that returns recent cron_runs rows for the
// monitoring page. This is the REAL access-control boundary — the UI hiding a
// link is not security; this gate is.
//
// Security:
//   - requireAdmin(request) must pass; null → 403. No fallback to any
//     client-supplied identity.
//   - cron_runs is read with the service role (createAdminClient) because the
//     table is RLS-locked to service role only.
//   - Read-only: this route never writes or deletes. Fixes are done in
//     Supabase / code, not here.
//   - Uses the Supabase query builder only (no raw SQL / rpc).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiAuth";
import { createAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// How many recent runs to return by default, and the hard cap.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  // --- Access control: the real defense line. ---
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Lightweight access log (also keeps `admin` referenced).
  console.info(`admin/cron-runs: accessed by ${admin.email}`);

  // --- Parse a bounded limit from the query string (optional). ---
  // Defensive: clamp to [1, MAX_LIMIT]; fall back to DEFAULT_LIMIT on garbage.
  const limitParam = request.nextUrl.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  // --- Read cron_runs with the service role (RLS-locked table). ---
  // Query builder only — no raw SQL. Read-only select.
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("cron_runs")
      .select(
        "id, job_name, status, started_at, finished_at, duration_ms, " +
          "items_processed, items_failed, stats, error, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("admin/cron-runs: query failed:", error);
      return NextResponse.json(
        { error: "Failed to load cron runs" },
        { status: 500 }
      );
    }

    return NextResponse.json({ runs: data ?? [] });
  } catch (err) {
    console.error("admin/cron-runs: unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to load cron runs" },
      { status: 500 }
    );
  }
}
