import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/export — GDPR data export.
 *
 * Returns the caller's own data as a downloadable JSON file. Identity comes
 * ONLY from the verified Bearer JWT; every query is filtered by that id.
 *
 * Deliberately excluded:
 *   - plaid_connections.access_token — a live bank credential; only
 *     institution_name / status / item_id are exported.
 *   - admin_users — internal access-control data, not user-owned content.
 *   - waitlist_signups — pre-signup data with no user_id link.
 *   - llm_calls.user_id — the payload's top-level user_id already carries it.
 *
 * If any per-table read fails, the whole export returns 500 rather than
 * silently handing back an incomplete file the user believes is complete.
 */
export async function GET(request: NextRequest) {
  const authUserId = await getAuthenticatedUserIdFromRequest(request);
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [
    usersRes,
    surveyRes,
    messagesRes,
    summariesRes,
    factsRes,
    recommendationsRes,
    postsRes,
    commentsRes,
    plaidRes,
    llmCallsRes,
  ] = await Promise.all([
    admin.from("users").select("*").eq("id", authUserId),
    admin.from("survey_responses").select("*").eq("user_id", authUserId),
    admin.from("chat_messages").select("*").eq("user_id", authUserId),
    admin.from("chat_summaries").select("*").eq("user_id", authUserId),
    admin.from("user_facts").select("*").eq("user_id", authUserId),
    admin.from("recommendations_new").select("*").eq("user_id", authUserId),
    admin.from("posts").select("*").eq("user_id", authUserId),
    admin.from("comments").select("*").eq("user_id", authUserId),
    // access_token intentionally omitted — never export a live bank credential.
    admin
      .from("plaid_connections")
      .select("institution_name, status, item_id")
      .eq("user_id", authUserId),
    // Columns listed so a column added later is not exported by default.
    admin
      .from("llm_calls")
      .select(
        "id, created_at, started_at, route, attempt_index, request_model, response_model, generation_id, succeeded, http_status, error_class, finish_reason, latency_ms, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, provider_cost, has_memory_block, has_plaid_scaffold_block, has_balance_block, has_financial_snapshot_block, engine_reason_code, session_id"
      )
      .eq("user_id", authUserId),
  ]);

  const sections = [
    ["users", usersRes],
    ["survey_responses", surveyRes],
    ["chat_messages", messagesRes],
    ["chat_summaries", summariesRes],
    ["user_facts", factsRes],
    ["recommendations", recommendationsRes],
    ["posts", postsRes],
    ["comments", commentsRes],
    ["plaid_connections", plaidRes],
    ["llm_calls", llmCallsRes],
  ] as const;

  const failed = sections.filter(([, res]) => res.error).map(([key]) => key);
  if (failed.length > 0) {
    console.error("account/export: query failed for tables:", failed);
    return NextResponse.json(
      { error: "Failed to export some of your data. Please retry." },
      { status: 500 }
    );
  }

  const payload: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    user_id: authUserId,
  };
  for (const [key, res] of sections) {
    payload[key] = res.data ?? [];
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="noor-data-export.json"',
    },
  });
}
