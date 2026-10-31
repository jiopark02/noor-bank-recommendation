import type { SessionReadResult } from "@/lib/supabase-browser";

/**
 * The decisions the sign-in pages take from a session read or a follow-up read,
 * kept apart from the pages so they can be executed by the test suite: a page
 * file cannot be, since the suite has no DOM.
 *
 * The rule all of them follow: only an answer may change local auth state or
 * send the user elsewhere. "none" is an answer. "unavailable" is not, and a
 * valid session can produce it, so it never signs anyone out.
 *
 * Every time value here is an unvalidated default: nothing measures these
 * paths yet.
 */

/** One timeout per attempt, and the wait before each attempt after the first. */
export type RetryPlan = {
  timeoutsMs: readonly number[];
  gapsMs: readonly number[];
};

// Keeps the budget the first read has always had. A retry is not shorter: reads
// are serialized inside auth-js, so a retry queues behind the same token refresh
// and a smaller budget would only give up on the same work sooner.
export const DASHBOARD_SESSION_RETRY: RetryPlan = {
  timeoutsMs: [3000, 3000, 3000],
  gapsMs: [500, 1000],
};

// Longer than the default read. The first read on /auth/callback waits on the
// OAuth code exchange, a network round trip, where other pages mostly read a
// cookie. A failed exchange does not itself clear an earlier session, so what the
// read answers depends on that session. None: "none", at once. Valid, or expired
// with a refresh that succeeds: "session", for that earlier user. Expired with a
// refresh that fails: "unavailable". On a 400 or 500 the library clears it and
// fires SIGNED_OUT, so the retry reads "none". On a retryable failure such as a
// 503, its own refresh retries can outlast this budget and end as a timeout.
// Either way this budget only ever costs a longer spinner. This is auth-js 2.91.0
// as installed: re-check it when upgrading.
export const CALLBACK_SESSION_RETRY: RetryPlan = {
  timeoutsMs: [8000, 4000],
  gapsMs: [500],
};

export const CALLBACK_SURVEY_RETRY: RetryPlan = {
  timeoutsMs: [4000, 4000],
  gapsMs: [500],
};

export const SIGN_IN_TIMEOUT_MS = 10000;
// Short because all that is lost is display fields with a fallback.
export const PROFILE_READ_TIMEOUT_MS = 3000;
export const CALLBACK_SYNC_TIMEOUT_MS = 8000;

export type SettleOutcome<T> =
  | { timedOut: true }
  | { timedOut: false; value: T };

/**
 * Waits for `work` for at most `ms`. A rejection is passed on unchanged. The
 * work itself is not cancelled: it keeps running after a timeout, and a caller
 * that cares about its late result must keep a reference to it.
 */
export async function settleWithin<T>(
  work: PromiseLike<T>,
  ms: number
): Promise<SettleOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<SettleOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([
      Promise.resolve(work).then(
        (value): SettleOutcome<T> => ({ timedOut: false, value })
      ),
      limit,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `run` once per entry in `plan.timeoutsMs`, stopping at the first result
 * `shouldRetry` declines. Returns the last result. Once `isCancelled` is true no
 * further attempt starts; the caller checks it again before acting on the
 * result.
 */
export async function retryUntilAnswered<T>(
  run: (timeoutMs: number, attempt: number) => Promise<T>,
  shouldRetry: (result: T) => boolean,
  plan: RetryPlan,
  deps: {
    sleep: (ms: number) => Promise<void>;
    isCancelled: () => boolean;
  }
): Promise<T> {
  let result = await run(plan.timeoutsMs[0], 1);
  for (let i = 1; i < plan.timeoutsMs.length; i++) {
    if (deps.isCancelled() || !shouldRetry(result)) return result;
    await deps.sleep(plan.gapsMs[i - 1]);
    if (deps.isCancelled()) return result;
    result = await run(plan.timeoutsMs[i], i + 1);
  }
  return result;
}

// "not-configured" comes from a value fixed when the module loaded, so asking
// again cannot change it.
export function shouldRetrySessionRead(read: SessionReadResult): boolean {
  return read.status === "unavailable" && read.reason !== "not-configured";
}

export type DashboardMountAction = "proceed" | "sign-out" | "show-delayed";

export function decideDashboardMount(
  read: SessionReadResult
): DashboardMountAction {
  if (read.status === "session") return "proceed";
  if (read.status === "none") return "sign-out";
  return "show-delayed";
}

export type LoginMountAction = "go-dashboard" | "clear-local" | "stay";

export function decideLoginMount(read: SessionReadResult): LoginMountAction {
  if (read.status === "session") return "go-dashboard";
  if (read.status === "none") return "clear-local";
  return "stay";
}

export type CallbackSessionAction = "continue" | "no-session" | "show-retry";

export function decideCallbackSession(
  read: SessionReadResult
): CallbackSessionAction {
  if (read.status === "unavailable") return "show-retry";
  if (read.status === "session" && read.session.user) return "continue";
  return "no-session";
}

export type SurveyLookup = "found" | "missing" | "failed";

/**
 * Reads the "has this user completed the survey" query. "missing" is reserved
 * for a query that answered with no row: a query that errored or never answered
 * says nothing about the user, so it must not be read as a new user.
 */
export function readSurveyLookup(
  outcome: SettleOutcome<{ data: unknown; error: unknown }>
): SurveyLookup {
  if (outcome.timedOut) return "failed";
  if (outcome.value.error) return "failed";
  return outcome.value.data ? "found" : "missing";
}

const POSTGREST_CODE = /^[A-Za-z0-9_-]{1,16}$/;

/**
 * What a failed survey lookup may say in the browser console: that it timed
 * out, or the PostgREST error code. An error's message, details and hint can
 * quote values, so they stay out, and a code of any other shape is not repeated.
 */
export function surveyLookupLogDetail(
  outcome: SettleOutcome<{ data: unknown; error: unknown }>
): string {
  if (outcome.timedOut) return "timed-out";
  const code = (outcome.value.error as { code?: unknown } | null)?.code;
  return typeof code === "string" && POSTGREST_CODE.test(code)
    ? `code=${code}`
    : "code=unknown";
}

export type CallbackRoute = "dashboard" | "survey" | "setup-error";

/**
 * "failed" is not accepted here, so an unknown survey state cannot be routed.
 * A returning user is not stopped by a failed profile sync: their row already
 * exists. A new user needs that row before the survey can be completed.
 */
export function decideCallbackRoute(
  lookup: "found" | "missing",
  syncOk: boolean
): CallbackRoute {
  if (lookup === "found") return "dashboard";
  return syncOk ? "survey" : "setup-error";
}

export type LateSignInAction = "adopt" | "ignore";

/**
 * What to do with a sign-in that finished after its time limit. supabase-js has
 * already stored that session by now and offers no way to cancel the call, so
 * adopting it brings the local state in line with the cookie. A newer attempt
 * takes precedence, and so does the user having left the page.
 */
export function decideLateSignIn(input: {
  attempt: number;
  latestAttempt: number;
  mounted: boolean;
  hasError: boolean;
  hasUser: boolean;
}): LateSignInAction {
  if (input.attempt !== input.latestAttempt) return "ignore";
  if (!input.mounted) return "ignore";
  if (input.hasError || !input.hasUser) return "ignore";
  return "adopt";
}
