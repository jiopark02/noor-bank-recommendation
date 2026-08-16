"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { LockFunc, Session } from "@supabase/supabase-js";
import type { FetchStringHeaders } from "@/lib/supabaseAuthHeaders";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// FIX (auth hang): @supabase/auth-js acquires a per-client Web Lock
// ("lock:sb-<ref>-auth-token") with no acquire timeout. When a tab is
// backgrounded/idle and the lock is left orphaned (aborted refresh, suspended
// tab, Strict Mode unmount), every later auth call (getSession, signOut) queues
// behind the never-released lock and hangs forever — the user sees an infinite
// spinner on opening chat or signing out until a full reload recreates the
// client. Known upstream issue, unfixed as of supabase-js 2.91. A no-op lock
// disables the cross-tab serialization; NOOR is used in a single tab/session in
// practice, and the server already reconciles concurrent token refresh via
// refresh-token rotation, so the worst case is one tab re-authenticating
// (handled by getSessionSafe) rather than a deadlock.
const noOpLock: LockFunc = async (_name, _acquireTimeout, fn) => fn();

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey, {
        auth: { lock: noOpLock },
      })
    : null;

// Defense-in-depth safety net: even with the lock removed, any auth read that
// stalls must never freeze the UI. Races getSession() against a timeout and
// falls back to "no session" so every caller can resolve its loading state. The
// warning also serves as a post-deploy diagnostic: if it still fires after the
// no-op lock, another cause is at play.
const GET_SESSION_TIMEOUT_MS = 3000;

/**
 * Outcome of a session read, with the two failure modes kept apart.
 *
 * getSessionSafe() collapses every path to `null`, which is fine for callers
 * that only ask "is there a session right now" but wrong for callers that must
 * decide whether the absence is authoritative:
 *
 *   - "none"        getSession() answered cleanly and there is genuinely no
 *                   session. An answer carrying an error is NOT this.
 *   - "unavailable" we never got a clean answer (client not configured,
 *                   timeout, or an error — thrown, or returned in
 *                   getSession's own error field). This is NOT evidence of
 *                   being logged out — a valid cookie session can produce it —
 *                   so callers must withhold any logout decision and may retry.
 *
 * Note that getSession() is not a local-storage read: this is a cookie-based
 * client, so an expired access token makes it hit
 * /auth/v1/token?grant_type=refresh_token over the network. "unavailable" is
 * therefore often a transient network condition that a retry can clear.
 */
export type SessionReadResult =
  | { status: "session"; session: Session }
  | { status: "none" }
  | {
      status: "unavailable";
      reason: "not-configured" | "timeout" | "error";
      elapsedMs: number;
    };

/**
 * Call-site identifier for the diagnostic log below. Deliberately a closed
 * union of code-defined constants — never build one from user input, since the
 * value is printed verbatim to the console.
 *
 * "session-safe" means the read came through the getSessionSafe() wrapper,
 * whose 10 callers are not individually identified.
 */
export type SessionReadLabel =
  | "session-safe"
  | "survey-submit"
  | "survey-submit-retry";

type SessionReadLogFields = {
  label: SessionReadLabel;
  attempt: number;
  timeoutMs: number;
  elapsedMs: number;
  // Closed union, matching SessionReadResult's reason, so the "code-defined
  // constant" claim below is enforced by the type rather than by convention.
  reason: "not-configured" | "timeout" | "error";
  errorName?: string;
  errorMessage?: string;
};

// Every field is a code-defined constant or a number, with ONE exception:
// errorMessage carries an error string produced by supabase-js or the network
// stack, so its content is not controlled by this repo and cannot be asserted
// to be PII-free. It is logged anyway because a failed session read is
// otherwise undiagnosable, and it is narrower than the whole error object that
// this function replaced. Treat it as the only field here that is not
// PII-free by construction.
// Never add the session, an access/refresh token, an email, a user id, or any
// monetary figure here — this line goes to the browser console verbatim.
function warnSessionReadUnavailable(fields: SessionReadLogFields): void {
  let line =
    `[auth] session read unavailable label=${fields.label}` +
    ` attempt=${fields.attempt} timeoutMs=${fields.timeoutMs}` +
    ` elapsedMs=${fields.elapsedMs} reason=${fields.reason}`;
  if (fields.errorName) {
    line += ` errorName=${fields.errorName}`;
  }
  if (fields.errorMessage) {
    line += ` errorMessage=${fields.errorMessage}`;
  }
  console.warn(line);
}

/**
 * Read the session and report WHICH outcome occurred.
 *
 * @param timeoutMs how long to wait before giving up. Defaults to the same
 *                  budget getSessionSafe has always used, so the wrapper's
 *                  behavior is unchanged.
 * @param label     which call site this read belongs to (diagnostics only).
 * @param attempt   1 for the first read, 2 for a retry. A retry's outcome is
 *                  always logged — success included — so the value of retrying
 *                  can be judged from real data rather than assumed.
 *
 * Timing note: elapsedMs is logged next to timeoutMs on purpose. A retry runs
 * on a smaller budget, so "did it run out of budget" (elapsedMs ~= timeoutMs)
 * and "did it fail outright" (elapsedMs well under timeoutMs) are only
 * distinguishable when both numbers are present.
 */
export async function readSession(
  timeoutMs: number = GET_SESSION_TIMEOUT_MS,
  label: SessionReadLabel = "session-safe",
  attempt: number = 1
): Promise<SessionReadResult> {
  if (!supabase) {
    warnSessionReadUnavailable({
      label,
      attempt,
      timeoutMs,
      elapsedMs: 0,
      reason: "not-configured",
    });
    return { status: "unavailable", reason: "not-configured", elapsedMs: 0 };
  }

  const startedAt = Date.now();

  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs)
      ),
    ]);
    const elapsedMs = Date.now() - startedAt;

    if (result === "timeout") {
      warnSessionReadUnavailable({
        label,
        attempt,
        timeoutMs,
        elapsedMs,
        reason: "timeout",
      });
      return { status: "unavailable", reason: "timeout", elapsedMs };
    }

    // A resolved call is not the same as an answer. getSession() can resolve
    // with an error in hand — a refresh that failed rather than threw — and
    // reading only result.data.session would file that under "none", which is
    // contracted above as an AUTHORITATIVE absence. An errored read is not
    // evidence of being logged out, so it belongs in "unavailable" with the
    // timeout and the throw.
    //
    // Whether supabase-js actually resolves-with-error on a failed refresh, as
    // opposed to throwing, is not verifiable from this repo. That does not
    // matter for the decision: if it never takes this path the branch is inert,
    // and if it does, "unavailable" is the reading that withholds the logout
    // decision and lets the caller retry. It is safe either way, which is why
    // it is written without confirming the library's behavior first.
    //
    // Shares reason="error" with the catch below rather than introducing a
    // fourth reason; errorName is what separates the two in the log.
    //
    // The !session half of the condition is not redundant. supabase-js's
    // declared return type pairs an error with a null session, so an error
    // arriving alongside a usable session should be impossible — but that type
    // cannot be read from this repo to confirm it. If the combination does
    // occur, a session in hand is still a session, and discarding it here
    // would block a submit that has a perfectly good token: the exact failure
    // this whole path exists to prevent. Preferring the session in that case
    // also keeps getSessionSafe()'s output byte-identical to what it returned
    // before this branch was added.
    if (result.error && !result.data.session) {
      warnSessionReadUnavailable({
        label,
        attempt,
        timeoutMs,
        elapsedMs,
        reason: "error",
        errorName: result.error.name || "UnknownError",
        errorMessage: result.error.message,
      });
      return { status: "unavailable", reason: "error", elapsedMs };
    }

    const session = result.data.session;

    // Only retries are logged on the success path; logging every first read
    // would drown the console, since this runs on every mount.
    if (attempt > 1) {
      console.warn(
        `[auth] session read retry resolved label=${label}` +
          ` attempt=${attempt} timeoutMs=${timeoutMs}` +
          ` elapsedMs=${elapsedMs} status=${session ? "session" : "none"}`
      );
    }

    return session ? { status: "session", session } : { status: "none" };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    // Name and message only. The error object's full shape is not verifiable
    // from this repo, so it is never handed to console as-is.
    warnSessionReadUnavailable({
      label,
      attempt,
      timeoutMs,
      elapsedMs,
      reason: "error",
      errorName: err instanceof Error ? err.name : "UnknownError",
      errorMessage: err instanceof Error ? err.message : undefined,
    });
    return { status: "unavailable", reason: "error", elapsedMs };
  }
}

/**
 * Back-compatible wrapper: same signature, same timeout budget, same "any
 * problem becomes null" fallback it has always had. Callers that need to tell
 * "no session" apart from "could not tell" should use readSession() instead.
 */
export async function getSessionSafe(): Promise<Session | null> {
  const result = await readSession();
  return result.status === "session" ? result.session : null;
}

/**
 * Authorization header for API routes that validate the Supabase access token.
 *
 * Returns {} when there is no token, which lets the caller send a header-less
 * request. Callers that must not reach the server unauthenticated should read
 * the session themselves via readSession() rather than relying on this.
 */
export async function getSupabaseBearerHeaders(): Promise<FetchStringHeaders> {
  const session = await getSessionSafe();
  const token = session?.access_token;
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}
