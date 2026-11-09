import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { isChunkLike, type CookieOptions } from "@supabase/ssr";
import type { SessionReadResult } from "@/lib/supabase-browser";
import { firstNameForClient } from "@/lib/defaultFirstName";

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

// The other signed-in pages read the session the same way the dashboard does.
export const PROTECTED_SESSION_RETRY: RetryPlan = DASHBOARD_SESSION_RETRY;

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

export type ProtectedMountAction = "proceed" | "sign-out" | "show-delayed";

/**
 * The mount decision for a signed-in page (/dashboard, /money, /chat). Only a
 * clean "none" signs out. "unavailable" — a timeout, an error, or a client that
 * is not configured — can come from a valid session, so it shows the delayed
 * screen and leaves local state alone.
 */
export function decideProtectedMount(
  read: SessionReadResult
): ProtectedMountAction {
  if (read.status === "session") return "proceed";
  if (read.status === "none") return "sign-out";
  return "show-delayed";
}

export type DashboardMountAction = ProtectedMountAction;

export const decideDashboardMount = decideProtectedMount;

export type LocalIdentityAction = "keep" | "replace";

/**
 * Whether the locally cached user id belongs to the session's user. A cache
 * left by another account on the same device is replaced, not acted on: the
 * session is the authority, so a mismatch is not a reason to sign anyone out.
 */
export function decideLocalIdentity(
  storedUserId: string | null,
  sessionUserId: string
): LocalIdentityAction {
  return storedUserId === sessionUserId ? "keep" : "replace";
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

export type CallbackUrlState =
  | { kind: "confirm"; tokenHash: string }
  | { kind: "url-error" }
  | { kind: "none" };

/**
 * What /auth/callback was opened with.
 *
 * An auth error in the query or the fragment wins over everything else, and
 * nothing of it is kept: the page answers it with one fixed OAuth message, so
 * neither the code nor error_description (text whoever wrote the link chose)
 * is read. Only OAuth redirects carry an error here; a confirmation link's
 * errors come from verifyOtp in the page.
 *
 * A signup confirmation carries its token in the FRAGMENT (see
 * buildConfirmationLink). A token_hash in the query is not accepted, nor is
 * any type other than "signup"; both come back "none", which is the existing
 * OAuth path.
 */
export function readCallbackUrl(href: string): CallbackUrlState {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: "none" };
  }
  const query = url.searchParams;
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));

  const sources = [query, fragment];
  for (let i = 0; i < sources.length; i++) {
    const params = sources[i];
    if (params.has("error") || params.has("error_code")) {
      return { kind: "url-error" };
    }
  }

  const tokenHash = fragment.get("token_hash");
  if (tokenHash && fragment.get("type") === "signup") {
    return { kind: "confirm", tokenHash };
  }
  return { kind: "none" };
}

export type ConfirmResult = "continue" | "expired" | "retry" | "failed";

const CONFIRM_EXPIRED_CODES = ["otp_expired", "flow_state_expired", "flow_state_not_found"];

/**
 * The outcome of verifyOtp on a signup confirmation link. "retry" is for an
 * answer that never came (a network failure, a 5xx): the same token may
 * still work. "expired" is a token the server refused as expired or used.
 * A success that carries no session is "failed": there is nothing to go on
 * with.
 */
export function decideConfirmResult(
  error: unknown,
  hasSession: boolean
): ConfirmResult {
  if (!error) return hasSession ? "continue" : "failed";
  if (isAuthRetryableFetchError(error)) return "retry";
  const fields = typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : {};
  const status = typeof fields.status === "number" ? fields.status : undefined;
  if (status !== undefined && (status === 0 || status >= 500)) return "retry";
  if (typeof fields.code === "string" && CONFIRM_EXPIRED_CODES.indexOf(fields.code) !== -1) {
    return "expired";
  }
  if (status === 403) return "expired";
  return "failed";
}

export type DisplayNames = { firstName: string; lastName: string };

/** A users row's names in the local-profile shape, or null without a row. */
export function storedNamesFromRow(row: unknown): DisplayNames | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    firstName: firstNameForClient(typeof r.first_name === "string" ? r.first_name : ""),
    lastName: typeof r.last_name === "string" ? r.last_name : "",
  };
}

/**
 * The names the local profile gets after an email confirmation: the names the
 * profile sync reported writing, else the stored users row, else empty.
 * user_metadata is deliberately not an input: a second signup request for the
 * same unconfirmed email overwrites it with whatever names that request sent,
 * while the users row keeps the first signup's names.
 */
export function chooseConfirmedNames(input: {
  synced: DisplayNames | null;
  stored: DisplayNames | null;
}): DisplayNames {
  if (input.synced) return { ...input.synced };
  if (input.stored) return { ...input.stored };
  return { firstName: "", lastName: "" };
}

// ---------------------------------------------------------------------------
// Sign-out and session cookie lifetime
// ---------------------------------------------------------------------------

/**
 * Marker cookie for "Keep me signed in" left unchecked. The login page sets it
 * (with no lifetime, so it ends when the browser closes) before signing in and
 * removes it when the box is checked. While it is present, every Supabase auth
 * cookie written — by the browser client after sign-in or a token refresh, and
 * by the middleware after a refresh — is written without a lifetime as well.
 * It shortens the holder's own session and carries nothing else, so a forged
 * marker grants nothing.
 */
export const SESSION_ONLY_COOKIE = "noor_session_only";

export type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * The options one auth cookie is written with. @supabase/ssr always sets a
 * 400-day maxAge on the cookies it writes and overrides any maxAge passed as
 * cookieOptions, so the lifetime can only be removed here, in the cookie
 * writer. A removal (maxAge 0, or an empty value) passes through unchanged:
 * stripping its lifetime would turn a deletion into a session cookie that
 * outlives the sign-out.
 */
export function cookieOptionsForPersistence(
  cookie: CookieToSet,
  persistent: boolean
): CookieOptions {
  const options = cookie.options ?? {};
  if (persistent) return options;
  if (options.maxAge === 0 || cookie.value === "") return options;
  const sessionOnly: CookieOptions = { ...options };
  delete sessionOnly.maxAge;
  delete sessionOnly.expires;
  return sessionOnly;
}

export function applySessionPersistence(
  cookies: CookieToSet[],
  persistent: boolean
): CookieToSet[] {
  return cookies.map((cookie) => ({
    ...cookie,
    options: cookieOptionsForPersistence(cookie, persistent),
  }));
}

/**
 * The storage key supabase-js derives when none is configured:
 * `sb-<first label of the project host>-auth-token`. The browser client and
 * the middleware both use that default, so this is the name of the session
 * cookie (and the prefix of its chunks). sessionCookiePolicy.test.ts compares
 * it with the key the installed library derives.
 */
export function defaultSupabaseStorageKey(supabaseUrl: string): string | null {
  try {
    const host = new URL(supabaseUrl.trim()).hostname;
    return host ? `sb-${host.split(".")[0]}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * Whether a cookie is one of the cookies auth-js keeps under `storageKey`:
 * the session (whole or chunked as `<key>.0`, `<key>.1`, ...), the PKCE code
 * verifier, and the separately stored user.
 */
export function isSupabaseAuthCookieName(
  name: string,
  storageKey: string
): boolean {
  return (
    isChunkLike(name, storageKey) ||
    isChunkLike(name, `${storageKey}-code-verifier`) ||
    isChunkLike(name, `${storageKey}-user`)
  );
}

export type SignOutScope = "local" | "global";

export type SignOutDeps = {
  /** Null when the browser client is not configured. */
  signOut:
    | ((scope: SignOutScope) => Promise<{ error: unknown }>)
    | null;
  /** Deletes the Supabase auth cookies directly. */
  removeAuthCookies: () => void;
  /** Clears the app's own browser storage. */
  clearLocal: () => void;
  navigate: () => void;
  /** Defaults to console.warn. Injected so tests stay quiet. */
  log?: (line: string) => void;
};

export type SignOutOutcome = "server-confirmed" | "local-only";

function errorFields(err: unknown): string {
  if (!err || typeof err !== "object") return "name=UnknownError";
  const e = err as { name?: unknown; status?: unknown };
  const name = typeof e.name === "string" && e.name ? e.name : "UnknownError";
  const status = typeof e.status === "number" ? ` status=${e.status}` : "";
  return `name=${name}${status}`;
}

/**
 * Signs out, and always leaves the device signed out and the user on the next
 * screen, whatever the server answers.
 *
 * auth-js removes its own session only when the server call succeeds or is
 * refused with 401, 403 or 404. On any other error it returns the error and
 * keeps the session, and on a network failure it throws and keeps it. Either
 * way the cookie would keep the middleware treating the device as signed in,
 * so on every outcome other than a clean answer the auth cookies are deleted
 * here. That signs this device out only: the refresh token is not revoked on
 * the server, which the log line records.
 *
 * The local clean-up and the navigation run in `finally`, so a throw never
 * leaves stale local state behind or the user on the page they left.
 */
export async function runSignOut(
  scope: SignOutScope,
  deps: SignOutDeps
): Promise<SignOutOutcome> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  let serverConfirmed = false;
  try {
    if (deps.signOut) {
      const { error } = await deps.signOut(scope);
      if (error) {
        log(
          `[auth] sign-out server call failed scope=${scope} ${errorFields(error)};` +
            " removing auth cookies on this device only"
        );
      } else {
        serverConfirmed = true;
      }
    }
  } catch (err) {
    log(
      `[auth] sign-out server call threw scope=${scope} ${errorFields(err)};` +
        " removing auth cookies on this device only"
    );
  } finally {
    if (!serverConfirmed) {
      try {
        deps.removeAuthCookies();
      } catch (err) {
        log(`[auth] removing auth cookies failed ${errorFields(err)}`);
      }
    }
    deps.clearLocal();
    deps.navigate();
  }
  return serverConfirmed ? "server-confirmed" : "local-only";
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export type PasswordResetOutcome =
  | { kind: "success" }
  | { kind: "verify-refused"; error: unknown }
  | { kind: "verify-threw" }
  | { kind: "update-refused"; error: unknown }
  | { kind: "update-threw" };

export type PasswordResetDeps = {
  /** verifyOtp with the recovery token_hash; creates the recovery session. */
  verify: () => Promise<{ error: unknown }>;
  /** updateUser with the new password, under the recovery session. */
  update: () => Promise<{ error: unknown }>;
  /** auth.signOut with the given scope. */
  signOut: (scope: SignOutScope) => Promise<{ error: unknown }>;
  /** Deletes the Supabase auth cookies directly (see runSignOut). */
  removeAuthCookies: () => void;
  /** Defaults to console.warn. Injected so tests stay quiet. */
  log?: (line: string) => void;
};

/**
 * Ends a recovery session that must not outlive this function. A failed or
 * throwing sign-out falls back to deleting the auth cookies on this device.
 */
async function endRecoverySession(
  scope: SignOutScope,
  deps: PasswordResetDeps,
  log: (line: string) => void
): Promise<void> {
  let ended = false;
  try {
    const { error } = await deps.signOut(scope);
    if (error) {
      log(`[auth] sign-out after password reset failed scope=${scope} ${errorFields(error)}`);
    } else {
      ended = true;
    }
  } catch (err) {
    log(`[auth] sign-out after password reset threw scope=${scope} ${errorFields(err)}`);
  }
  if (!ended) {
    try {
      deps.removeAuthCookies();
    } catch (err) {
      log(`[auth] removing auth cookies failed ${errorFields(err)}`);
    }
  }
}

/**
 * The password reset, run only when the user submits the new password.
 *
 * The recovery link's token is not exchanged when the page opens, so opening
 * the link — or a mail scanner fetching it — creates no session. On submit:
 * verifyOtp creates the recovery session, updateUser changes the password,
 * and a global sign-out ends every session, this one included, since the old
 * password may be compromised.
 *
 * Once the password has changed, the reset has succeeded whatever the
 * sign-out does; a failed sign-out is logged and this device's auth cookies
 * are deleted directly. If the update is refused or throws after the token
 * was exchanged, the recovery session is ended on this device ('local') so a
 * reset that was not finished leaves no session behind; the token is spent,
 * so a retry needs a new link.
 */
export async function runPasswordReset(
  deps: PasswordResetDeps
): Promise<PasswordResetOutcome> {
  const log = deps.log ?? ((line: string) => console.warn(line));

  try {
    const { error } = await deps.verify();
    if (error) return { kind: "verify-refused", error };
  } catch {
    return { kind: "verify-threw" };
  }

  let updateFailure: PasswordResetOutcome | null = null;
  try {
    const { error } = await deps.update();
    if (error) updateFailure = { kind: "update-refused", error };
  } catch {
    updateFailure = { kind: "update-threw" };
  }
  if (updateFailure) {
    await endRecoverySession("local", deps, log);
    return updateFailure;
  }

  await endRecoverySession("global", deps, log);
  return { kind: "success" };
}

// The same server work as the callback's profile sync.
export const LOGIN_SYNC_TIMEOUT_MS = CALLBACK_SYNC_TIMEOUT_MS;
