import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { resolveRequestAuth } from "@/lib/apiAuth";
import { readRequestJsonWithByteLimit } from "@/lib/boundedRequestJson";
import {
  HOUSEHOLD_BODY_MAX_BYTES,
  requestTooLarge,
  type HouseholdIdentity,
  type HouseholdLog,
  type HouseholdResult,
  type HouseholdStore,
  type RouteName,
} from "@/lib/householdInvite";
import { makeHouseholdStore } from "@/lib/householdStore";
import { HOUSEHOLD_CODES, HOUSEHOLD_MESSAGES } from "@/lib/householdCopy";

/**
 * What every /api/household route does first, in this order:
 *   1. without the service-role key, 503 ADMIN_UNCONFIGURED, before any
 *      token is read (otherwise the missing key reads as a 401);
 *   2. the bearer token verified with the auth server (resolveRequestAuth),
 *      before any body is read or store built. An auth server that gave no
 *      usable answer (auth_unreachable) is ours to report, not the caller's
 *      session: 503 AUTH_UNAVAILABLE, logged as one fixed line. Every other
 *      cause is 401 { error: "Unauthorized" } and is not logged. The split
 *      by cause (503 for auth_unreachable, 401 for the rest) is the one the
 *      Plaid connection routes make (plaidAuthRefusal); the logging is not:
 *      plaidAuthRefusal logs every refusal, 401s included, and this gate
 *      logs only the 503.
 * The identity is the verified user's id, email and whether that email is
 * confirmed; nothing from the request body names a user.
 *
 * Every answer carries Cache-Control: private, no-store.
 */

export type HouseholdContext = {
  identity: HouseholdIdentity;
  store: HouseholdStore;
  log: HouseholdLog;
};

function respond(status: number, body: Record<string, unknown>): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function householdResponse(result: HouseholdResult): NextResponse {
  return respond(result.status, result.body);
}

export async function householdGate(
  request: NextRequest
): Promise<{ ok: true; context: HouseholdContext } | { ok: false; response: NextResponse }> {
  if (!isSupabaseAdminConfigured()) {
    return {
      ok: false,
      response: respond(503, {
        error: HOUSEHOLD_MESSAGES.ADMIN_UNCONFIGURED,
        code: HOUSEHOLD_CODES.ADMIN_UNCONFIGURED,
      }),
    };
  }
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) {
    if (auth.cause === "auth_unreachable") {
      // A fixed line: nothing from the request reaches it.
      console.warn("[household] route=gate outcome=auth_unavailable");
      return {
        ok: false,
        response: respond(503, {
          error: HOUSEHOLD_MESSAGES.AUTH_UNAVAILABLE,
          code: HOUSEHOLD_CODES.AUTH_UNAVAILABLE,
        }),
      };
    }
    return { ok: false, response: respond(401, { error: "Unauthorized" }) };
  }
  const user = auth.user;
  return {
    ok: true,
    context: {
      identity: {
        id: user.id,
        email: typeof user.email === "string" ? user.email : null,
        emailConfirmed: Boolean(user.email_confirmed_at),
      },
      store: makeHouseholdStore(createAdminClient()),
      log: (line) => console.warn(line),
    },
  };
}

/** The JSON body under the byte limit, or the 413 answer. */
export async function readHouseholdBody(
  request: NextRequest,
  route: RouteName,
  log: HouseholdLog
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const read = await readRequestJsonWithByteLimit(request, HOUSEHOLD_BODY_MAX_BYTES);
  if (read.kind === "too_large") {
    return { ok: false, response: householdResponse(requestTooLarge(route, log)) };
  }
  return { ok: true, body: read.value };
}
