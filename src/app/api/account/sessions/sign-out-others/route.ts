import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { resolveRequestAuth } from "@/lib/apiAuth";
import {
  SESSIONS_CODES,
  SESSIONS_MESSAGES,
  signOutOtherSessions,
  type SessionsResult,
} from "@/lib/accountSessions";

export const dynamic = "force-dynamic";

function respond(result: SessionsResult): NextResponse {
  const response = NextResponse.json(result.body, { status: result.status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function log(line: string): void {
  console.warn(line);
}

const UNAVAILABLE: SessionsResult = {
  status: 503,
  body: {
    error: SESSIONS_MESSAGES.SESSIONS_UNAVAILABLE,
    code: SESSIONS_CODES.SESSIONS_UNAVAILABLE,
  },
};

/**
 * POST /api/account/sessions/sign-out-others — signs out every other session
 * of the verified user (accountSessions.ts). In order:
 *   1. without the service-role key, 503 before any token is read;
 *   2. the bearer token verified (resolveRequestAuth): an auth server that
 *      gave no usable answer is 503, every other cause 401;
 *   3. the same token, read from the Authorization header, passed to the
 *      admin sign-out with the "others" scope.
 * The body is never read, so nothing in it can name a token or a user.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured()) {
    log("[account-sessions] route=sign-out-others outcome=unavailable cause=admin_unconfigured");
    return respond(UNAVAILABLE);
  }
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) {
    if (auth.cause === "auth_unreachable") {
      log("[account-sessions] route=sign-out-others outcome=auth_unavailable");
      return respond(UNAVAILABLE);
    }
    return respond({ status: 401, body: { error: "Unauthorized" } });
  }

  // resolveRequestAuth verified exactly this value: the header, past the
  // "Bearer " prefix, trimmed.
  const token = (request.headers.get("authorization") || "").slice(7).trim();

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    log("[account-sessions] route=sign-out-others outcome=unavailable cause=client");
    return respond(UNAVAILABLE);
  }
  return respond(
    await signOutOtherSessions((jwt, scope) => admin.auth.admin.signOut(jwt, scope), token, log)
  );
}
