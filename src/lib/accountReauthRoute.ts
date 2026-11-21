import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { resolveRequestAuth } from "@/lib/apiAuth";
import { readRequestJsonWithByteLimit } from "@/lib/boundedRequestJson";
import { sendEmail } from "@/lib/email";
import {
  REAUTH_CODES,
  REAUTH_MESSAGES,
  deriveReauthCodeKey,
  resolveAccountReauthMode,
  sessionIdFromVerifiedToken,
  type ReauthDeps,
  type ReauthIdentity,
  type ReauthResult,
  type ReauthRpc,
} from "@/lib/accountReauth";

/**
 * Wiring for the reauthentication routes and the gate in the account delete
 * and export routes. The decisions live in accountReauth.ts.
 *
 * Every answer carries Cache-Control: private, no-store.
 */

/** A body is {purpose} or {purpose, code}; anything larger is refused. */
export const REAUTH_BODY_MAX_BYTES = 1024;

export function reauthResponse(result: ReauthResult): NextResponse {
  const response = NextResponse.json(result.body, { status: result.status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function log(line: string): void {
  console.warn(line);
}

function liveRpc(): ReauthRpc {
  const client = createAdminClient();
  return (fn, args) => client.rpc(fn, args);
}

/**
 * The session id of the request's bearer token. Call only after
 * resolveRequestAuth has accepted the request: it verified exactly this value,
 * the Authorization header past "Bearer ", trimmed. Null when the header is
 * absent or the token carries no well-formed session id.
 */
export function verifiedRequestSessionId(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  return sessionIdFromVerifiedToken(header.slice(7).trim());
}

/** The mode, the derived key, the service-role rpc and the mailer. */
export function liveReauthDeps(): ReauthDeps {
  return {
    mode: resolveAccountReauthMode(process.env.ACCOUNT_REAUTH_MODE),
    key: deriveReauthCodeKey(process.env.SUPABASE_SERVICE_ROLE_KEY),
    rpc: liveRpc,
    sendCode: (to, email) =>
      sendEmail({ to, subject: email.subject, html: email.html, text: email.text }),
    log,
  };
}

/** What the delete and export routes pass to requireRecentReauth. */
export function liveReauthGateDeps(): Pick<ReauthDeps, "mode" | "rpc" | "log"> {
  return {
    mode: resolveAccountReauthMode(process.env.ACCOUNT_REAUTH_MODE),
    rpc: liveRpc,
    log,
  };
}

/**
 * What both reauthentication routes do first, in this order:
 *   1. without the service-role key, 503 REAUTH_UNAVAILABLE, before any
 *      token is read: no hash key can be derived and no rpc made;
 *   2. the bearer token verified (resolveRequestAuth). An auth server that
 *      gave no usable answer is 503; every other cause is 401;
 *   3. the body read under REAUTH_BODY_MAX_BYTES.
 * The identity is the verified user's id and address and the token's session
 * id; nothing from the body names a user, an address or a session.
 */
export async function reauthRouteGate(
  request: NextRequest,
  route: "start" | "verify"
): Promise<
  | { ok: true; identity: ReauthIdentity; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  if (!isSupabaseAdminConfigured()) {
    log(`[account-reauth] route=${route} outcome=unavailable cause=admin_unconfigured`);
    return {
      ok: false,
      response: reauthResponse({
        status: 503,
        body: {
          error: REAUTH_MESSAGES.REAUTH_UNAVAILABLE,
          code: REAUTH_CODES.REAUTH_UNAVAILABLE,
        },
      }),
    };
  }
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) {
    if (auth.cause === "auth_unreachable") {
      log(`[account-reauth] route=${route} outcome=auth_unavailable`);
      return {
        ok: false,
        response: reauthResponse({
          status: 503,
          body: {
            error: REAUTH_MESSAGES.REAUTH_UNAVAILABLE,
            code: REAUTH_CODES.REAUTH_UNAVAILABLE,
          },
        }),
      };
    }
    return { ok: false, response: reauthResponse({ status: 401, body: { error: "Unauthorized" } }) };
  }
  const read = await readRequestJsonWithByteLimit(request, REAUTH_BODY_MAX_BYTES);
  if (read.kind === "too_large") {
    return {
      ok: false,
      response: reauthResponse({
        status: 413,
        body: {
          error: REAUTH_MESSAGES.REAUTH_BAD_REQUEST,
          code: REAUTH_CODES.REAUTH_BAD_REQUEST,
        },
      }),
    };
  }
  const body =
    typeof read.value === "object" && read.value !== null && !Array.isArray(read.value)
      ? (read.value as Record<string, unknown>)
      : {};
  return {
    ok: true,
    identity: {
      id: auth.user.id,
      email: typeof auth.user.email === "string" ? auth.user.email : null,
      sessionId: verifiedRequestSessionId(request),
    },
    body,
  };
}
