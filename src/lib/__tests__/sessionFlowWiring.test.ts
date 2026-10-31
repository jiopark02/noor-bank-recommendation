import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe: the sign-in pages take their decisions from sessionFlow.ts and
 * act on them. The decisions themselves are executed in sessionFlow.test.ts.
 * A page cannot be executed here, there being no DOM, so what the screens
 * actually show is a live check.
 *
 * Comments are removed the way dashboardBankReadErrors.test.ts removes them,
 * not with the character mask of loginPageWiring.test.ts: these probes read
 * whole pages, and an apostrophe in JSX text would throw that mask's quote
 * tracking.
 *
 * A negative check here cannot see a call moved into a helper or imported under
 * another name, so each one is paired with a check for what must be present.
 * Order checks compare text position only.
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const LOGIN = code(read("../../app/login/page.tsx"));
const DASHBOARD = code(read("../../app/dashboard/page.tsx"));
const CALLBACK = code(read("../../app/auth/callback/page.tsx"));

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw new Error(
      `could not bound the region between \`${from}\` and \`${to}\`; ` +
        "re-point these anchors."
    );
  }
  return source.slice(start, end);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe("login page mount", () => {
  const EFFECT = slice(LOGIN, "useEffect(() => {", "const [showPassword");

  it("P1 reads through readSession, not getSessionSafe", () => {
    expect(LOGIN).not.toContain("getSessionSafe");
    expect(EFFECT).toContain('await readSession(undefined, "login-mount")');
  });

  it("P2 clears local state only on the clear-local decision", () => {
    const flat = EFFECT.replace(/\s+/g, " ");
    expect(flat).toContain("const action = decideLoginMount(read);");
    expect(EFFECT).not.toContain("switch (");
    expect(flat).toContain(
      'if (action === "go-dashboard") { router.replace("/dashboard"); return; }'
    );
    expect(flat).toContain(
      'if (action === "clear-local") { clearLocalAuthState(); return; }'
    );
    expect(count(LOGIN, "clearLocalAuthState()")).toBe(1);
  });

  it("P29 the page removes browser storage only through clearLocalAuthState", () => {
    expect(LOGIN).not.toContain("removeItem");
    expect(LOGIN).not.toContain("Storage.clear(");
    expect(count(LOGIN, "clearLocalAuthState()")).toBe(1);
  });

  it("P22 the page marks itself mounted and unmounted", () => {
    expect(LOGIN.replace(/\s+/g, " ")).toContain(
      "useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);"
    );
  });
});

describe("login page submit", () => {
  const SUBMIT = slice(LOGIN, "const handleSubmit = async", "const isFormValid").replace(
    /\s+/g,
    " "
  );
  const TIMED_OUT = slice(
    SUBMIT,
    "if (outcome.timedOut) {",
    "const { data: authData, error: signInError } = outcome.value;"
  );

  it("P3 the password call runs under its time limit", () => {
    expect(SUBMIT).toContain("const signIn = supabase.auth.signInWithPassword(");
    expect(SUBMIT).toContain(
      "const outcome = await settleWithin(signIn, SIGN_IN_TIMEOUT_MS);"
    );
  });

  it("P4 a timeout tells the user, handles a late result and stops", () => {
    expect(TIMED_OUT).toContain(
      "Signing in is taking longer than expected. Please check your connection and try again."
    );
    expect(TIMED_OUT).toContain("signIn.then(");
    expect(TIMED_OUT).toContain("const action = decideLateSignIn({");
    expect(TIMED_OUT).toContain('if (action !== "adopt" || !data.user) return;');
    expect(TIMED_OUT).toContain("await finishSignIn(data.user, normalizedEmail);");
    expect(TIMED_OUT.trimEnd().endsWith("return; }")).toBe(true);
  });

  it("P20 the late decision reads the live attempt and mounted state", () => {
    expect(TIMED_OUT).toContain(
      "decideLateSignIn({ attempt, latestAttempt: signInAttemptRef.current, mounted: mountedRef.current, hasError: Boolean(lateError), hasUser: Boolean(data.user), });"
    );
  });

  it("P21 each submit takes a new attempt number before signing in", () => {
    expect(SUBMIT).toContain(
      "signInAttemptRef.current += 1; const attempt = signInAttemptRef.current; const signIn = supabase.auth.signInWithPassword("
    );
  });

  it("P23 the late path always releases the spinner", () => {
    expect(TIMED_OUT).toContain(
      "} catch { setError(ERROR_MESSAGES.SERVER_ERROR); } finally { setIsLoading(false); }"
    );
  });

  it("P24 a late rejection has a handler", () => {
    expect(TIMED_OUT).toMatch(/\}, \(\) => \{\} \); return; \}\s*$/);
  });

  it("P26 the outer finally releases the spinner on every submit", () => {
    expect(SUBMIT).toContain(
      "} catch (err) { setError(ERROR_MESSAGES.SERVER_ERROR); } finally { setIsLoading(false); } }; const finishSignIn = async"
    );
  });

  it("P5 both follow-up reads run under their time limit", () => {
    expect(SUBMIT).toMatch(
      /settleWithin\( supabase \.from\("users"\)[^;]*?\.maybeSingle\(\), PROFILE_READ_TIMEOUT_MS \)/
    );
    expect(SUBMIT).toContain(
      "settleWithin( getSurveyFieldsForUserProfile(supabase, user.id), PROFILE_READ_TIMEOUT_MS )"
    );
  });
});

describe("dashboard mount", () => {
  const EFFECT = slice(DASHBOARD, "useEffect(() => {", "const fetchLiveMoneyData =");

  it("P6 signs out only on the sign-out decision", () => {
    expect(DASHBOARD).not.toContain("getSessionSafe");
    expect(EFFECT.replace(/\s+/g, " ")).toContain(
      'await retryUntilAnswered( (timeoutMs, attempt) => readSession(timeoutMs, "dashboard-mount", attempt), shouldRetrySessionRead, DASHBOARD_SESSION_RETRY, { sleep: waitMs, isCancelled: () => cancelled } );'
    );
    expect(EFFECT).toContain("const action = decideDashboardMount(read);");

    expect(count(DASHBOARD, "clearLocalAuthState()")).toBe(1);
    expect(count(DASHBOARD, 'router.replace("/login")')).toBe(1);

    const signOut = slice(
      EFFECT,
      'if (action === "sign-out") {',
      'if (action === "show-delayed") {'
    );
    expect(signOut).toContain("clearLocalAuthState()");
    expect(signOut).toContain('router.replace("/login")');

    const delayed = slice(
      EFFECT,
      'if (action === "show-delayed") {',
      "const res = await fetchOrFail("
    );
    expect(delayed.replace(/\s+/g, " ")).toContain(
      "setSessionDelayed(true); return; }"
    );
    expect(delayed).not.toContain("clearLocalAuthState");
    expect(delayed).not.toContain("router.");
  });

  it("P19 the spinner is released unless cancelled or redirecting", () => {
    expect(EFFECT.replace(/\s+/g, " ")).toContain(
      "finally { if (!cancelled && !redirecting) setIsLoading(false); }"
    );
  });

  it("P27 the redirect flag starts false and only the sign-out branch sets it", () => {
    expect(EFFECT).toContain("let redirecting = false;");
    expect(EFFECT.match(/\bredirecting = (?:true|false);/g)).toEqual([
      "redirecting = false;",
      "redirecting = true;",
    ]);
    expect(
      slice(EFFECT, 'if (action === "sign-out") {', 'if (action === "show-delayed") {')
    ).toContain("redirecting = true;");
  });

  it("P7 the delayed screen comes before the spinner and offers a reload", () => {
    const delayedAt = DASHBOARD.indexOf("if (sessionDelayed) {");
    const spinnerAt = DASHBOARD.indexOf("if (isLoading) {");
    expect(delayedAt).toBeGreaterThan(-1);
    expect(spinnerAt).toBeGreaterThan(delayedAt);
    const screen = DASHBOARD.slice(delayedAt, spinnerAt);
    expect(screen).toContain("onClick={() => window.location.reload()}");
    expect(screen).toContain("Try again");
  });
});

describe("auth callback", () => {
  const FLAT = CALLBACK.replace(/\s+/g, " ");

  it("P8 reads the session through readSession with this page's budget", () => {
    expect(CALLBACK).not.toContain("auth.getSession(");
    expect(FLAT).toContain(
      'await retryUntilAnswered( (timeoutMs, attempt) => readSession(timeoutMs, "auth-callback", attempt), shouldRetrySessionRead, CALLBACK_SESSION_RETRY, { sleep: waitMs, isCancelled } );'
    );
    expect(CALLBACK).toContain("const action = decideCallbackSession(read);");
  });

  it("P17 an unanswered session read offers the retry, not Back to Login", () => {
    const retry = slice(
      CALLBACK,
      'if (action === "show-retry") {',
      'if (action === "no-session"'
    );
    expect(retry).toContain("setRetryMessage(");
    expect(retry).toContain("return;");
    expect(retry).not.toContain("setError(");
  });

  it("P9 the survey lookup hands the whole query result to readSurveyLookup", () => {
    expect(CALLBACK).not.toContain("Boolean(surveyRow)");
    expect(FLAT).toMatch(
      /const outcome = await settleWithin\( client \.from\("survey_responses"\) \.select\("id"\)/
    );
    expect(FLAT).toContain(
      'return readSurveyLookup(outcome); }, (result) => result === "failed", CALLBACK_SURVEY_RETRY, { sleep: waitMs, isCancelled } );'
    );
  });

  it("P18 a failed lookup offers the retry, not Back to Login", () => {
    const failed = slice(CALLBACK, 'if (lookup === "failed") {', "let syncOk");
    expect(failed).toContain("setRetryMessage(");
    expect(failed).not.toContain("setError(");
  });

  it("P28 both retry messages are non-empty fixed strings", () => {
    const calls = FLAT.match(/setRetryMessage\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatch(/^setRetryMessage\(\s*"[^"]+"\s*,?\s*\)$/);
    }
  });

  it("P25 a failed lookup logs only the reduced detail", () => {
    expect(FLAT).toContain("lookupFailure = surveyLookupLogDetail(outcome);");
    const failed = slice(CALLBACK, 'if (lookup === "failed") {', "let syncOk");
    expect(failed).toContain('console.error("Survey lookup failed:", lookupFailure);');
    expect(count(CALLBACK, "Survey lookup failed")).toBe(1);
  });

  it("P10 a failed lookup stops before the sync and before any local write", () => {
    const failedAt = CALLBACK.indexOf('if (lookup === "failed") {');
    const syncAt = CALLBACK.indexOf('fetch("/api/auth/sync-profile"');
    const storeAt = CALLBACK.indexOf("localStorage.setItem(");
    expect(failedAt).toBeGreaterThan(-1);
    expect(syncAt).toBeGreaterThan(failedAt);
    expect(storeAt).toBeGreaterThan(failedAt);
    expect(slice(CALLBACK, 'if (lookup === "failed") {', "let syncOk")).toContain(
      "return;"
    );
  });

  it("P11 the survey is reached only through the survey route", () => {
    expect(count(CALLBACK, 'router.push("/survey")')).toBe(1);
    expect(CALLBACK).toContain("const route = decideCallbackRoute(lookup, syncOk);");
    expect(FLAT).toMatch(/if \(route === "survey"\) \{ router\.push\("\/survey"\);/);
  });

  it("P15 the setup error stops before any local write or route", () => {
    const setup = slice(CALLBACK, 'if (route === "setup-error") {', "localStorage.setItem(");
    expect(setup).toContain("setError(");
    expect(setup.replace(/\s+/g, " ").trimEnd().endsWith("return; }")).toBe(true);
  });

  it("P16 syncOk comes only from the sync response", () => {
    expect(CALLBACK.match(/\bsyncOk = [^;]*;/g)).toEqual([
      "syncOk = false;",
      "syncOk = syncRes.ok;",
    ]);
  });

  it("P12 the retry screen reloads and does not send the user to /login", () => {
    const screen = slice(CALLBACK, "if (retryMessage) {", "if (error) {");
    expect(screen).toContain("onClick={() => window.location.reload()}");
    expect(screen).toContain("Try again");
    expect(screen).not.toContain('router.push("/login")');
  });

  it("P13 the profile sync can be aborted at its time limit", () => {
    expect(FLAT).toMatch(
      /fetch\("\/api\/auth\/sync-profile", \{ method: "POST", signal: syncAbort\.signal,/
    );
    expect(FLAT).toContain("() => syncAbort.abort(), CALLBACK_SYNC_TIMEOUT_MS");
  });

  it("P14 the effect cancels on unmount", () => {
    expect(FLAT).toMatch(/return \(\) => \{ cancelled = true; \}; \}, \[router\]\);/);
  });
});
