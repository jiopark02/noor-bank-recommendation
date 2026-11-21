/**
 * accountSessions — signing the caller's other devices out.
 *
 * POST /api/account/sessions/sign-out-others passes the bearer token of the
 * request it verified to the auth server's admin sign-out with the "others"
 * scope, so only that token's user is affected. The token is read from the
 * request's Authorization header and nowhere else; the body is never read.
 *
 * What it does not do: an access token already issued to another device
 * stays valid until it expires, since the auth server cannot recall one. The
 * other device is signed out when it next tries to refresh its session, and
 * the screen says so instead of promising an immediate sign-out.
 *
 * Whether the auth server keeps the requesting session itself is checked on a
 * preview deployment, not here.
 *
 * This file has no imports, so the settings screen can read its copy.
 */

export const SIGN_OUT_OTHERS_SCOPE = "others" as const;

export type SignOutOthersCall = (
  jwt: string,
  scope: typeof SIGN_OUT_OTHERS_SCOPE
) => PromiseLike<{ error: unknown }>;

export type SessionsResult = { status: number; body: Record<string, unknown> };

export const SESSIONS_CODES = {
  SESSIONS_UNAVAILABLE: "SESSIONS_UNAVAILABLE",
  SIGN_OUT_OTHERS_FAILED: "SIGN_OUT_OTHERS_FAILED",
} as const;

export const SESSIONS_MESSAGES = {
  SESSIONS_UNAVAILABLE: "We couldn't reach the sign-in service. Please try again in a moment.",
  SIGN_OUT_OTHERS_FAILED: "We couldn't sign out your other devices. Please try again.",
} as const;

export const SESSIONS_UI = {
  rowLabel: "Sign out other devices",
  rowDescription: "Keep this device signed in",
  title: "Sign out other devices?",
  body:
    "Other devices are signed out the next time their session refreshes. This can take up to about an hour.",
  confirm: "Sign out other devices",
  working: "Please wait…",
  done: "Other devices will be signed out the next time their session refreshes.",
  fallback: "We couldn't sign out your other devices. Please try again.",
  sessionExpired: "Your session has expired. Please sign in again.",
} as const;

const ERROR_CODE_SHAPE = /^[a-z0-9_]{1,40}$/;

/** An auth error's code or status when it has the expected shape, else a fixed word. */
function errorCause(error: unknown): string {
  if (typeof error !== "object" || error === null) return "error";
  const record = error as { code?: unknown; status?: unknown };
  if (typeof record.code === "string" && ERROR_CODE_SHAPE.test(record.code)) return record.code;
  if (typeof record.status === "number" && Number.isInteger(record.status)) return `status_${record.status}`;
  return "error";
}

export async function signOutOtherSessions(
  signOut: SignOutOthersCall,
  token: string,
  log: (line: string) => void
): Promise<SessionsResult> {
  let error: unknown;
  try {
    ({ error } = await signOut(token, SIGN_OUT_OTHERS_SCOPE));
  } catch {
    log("[account-sessions] route=sign-out-others outcome=failed cause=throw");
    return {
      status: 502,
      body: {
        error: SESSIONS_MESSAGES.SIGN_OUT_OTHERS_FAILED,
        code: SESSIONS_CODES.SIGN_OUT_OTHERS_FAILED,
      },
    };
  }
  if (error) {
    log(`[account-sessions] route=sign-out-others outcome=failed cause=${errorCause(error)}`);
    return {
      status: 502,
      body: {
        error: SESSIONS_MESSAGES.SIGN_OUT_OTHERS_FAILED,
        code: SESSIONS_CODES.SIGN_OUT_OTHERS_FAILED,
      },
    };
  }
  log("[account-sessions] route=sign-out-others outcome=signed_out_others");
  return { status: 200, body: { status: "signed_out_others" } };
}
