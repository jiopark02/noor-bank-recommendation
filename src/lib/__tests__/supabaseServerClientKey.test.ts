import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * createServerClient requires the service role key.
 *
 * WHAT THIS EXISTS TO PREVENT
 * The constructor used to read `supabaseServiceKey || supabaseAnonKey`. A
 * deployment missing the service role key therefore got an anon client, which
 * attaches no user JWT — `auth.uid()` is NULL, every RLS-scoped read matches
 * zero rows, and the calling code reads that as "the row does not exist". A
 * configuration fault arrived as data. Two routes already carried their own
 * guard against exactly that (/api/plaid/disconnect's ADMIN_UNCONFIGURED and
 * the account-deletion precondition); this moves the answer into the
 * constructor so a route does not have to remember.
 *
 * WHY THE DYNAMIC IMPORT
 * supabase.ts reads all three environment variables at module scope, so the
 * values are frozen at import time. A static import would bind one instance for
 * the whole file and the first case would decide the configuration for every
 * case after it. `vi.resetModules()` plus a fresh `await import()` per case
 * gives each test its own module instance. The stubs must be in place BEFORE
 * the import, which is why every test goes through `load()`. Same construction
 * as plaidTokenCrypto.test.ts, for a different reason: that module reads its
 * variable at call time, inside loadKey, and what its tests must defeat is a
 * module-scope cache. Here it is the environment read itself.
 *
 * WHY THE ENVIRONMENT IS STUBBED EVEN FOR THE "ABSENT" CASES
 * CI injects no Supabase variables at all (.github/workflows/test.yml has no
 * env block), but a developer machine may have them exported. Stubbing all
 * three explicitly — to "" for absent — makes the file say the same thing in
 * both places rather than depending on what the shell happens to hold.
 *
 * NO MOCKS. This loads the real module. The all-present case really does call
 * createClient from @supabase/supabase-js; that constructor performs no network
 * I/O (it assembles URLs and sub-clients), and the auth client's auto-refresh
 * ticker is unref'd, so it does not hold the process open.
 *
 * ⚠️ WHAT THIS DOES NOT PROVE
 * Nothing about which key any caller ends up using at runtime, and nothing
 * about RLS. It proves the constructor's preconditions and that the other three
 * exports were left alone.
 */

/** Shaped like a real project URL: supabase-js parses it and derives a hostname. */
const URL_OK = "https://example.supabase.co";
const ANON_OK = "anon_test_key";
const SERVICE_OK = "service_test_key";

/** The message that predates this change. Unchanged on purpose — see below. */
const URL_ANON_MESSAGE = "Supabase URL and anon key are required";
const SERVICE_MESSAGE = "Supabase service role key is required";

type SupabaseModule = typeof import("../supabase");

/** Fresh module instance. An omitted value is stubbed empty, not left alone. */
async function load(env: {
  url?: string;
  anon?: string;
  service?: string;
}): Promise<SupabaseModule> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.url ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", env.anon ?? "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", env.service ?? "");
  return import("../supabase");
}

/** The value a call threw, or undefined if it returned. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("createServerClient — the service role key is a precondition", () => {
  it("throws when the service role key is absent", async () => {
    // EXPECTED MUTATION: reverting to `supabaseServiceKey || supabaseAnonKey`
    // must turn this red — the call would return a client instead of throwing.
    const m = await load({ url: URL_OK, anon: ANON_OK });

    expect(() => m.createServerClient()).toThrow(SERVICE_MESSAGE);
  });

  it("throws a plain Error carrying no code", async () => {
    // The absence of `code` is the assertion, not an accident. A code would be
    // read as a classified fault — a PostgREST code, a Plaid error_code — by
    // the handlers this throw travels through, and this is neither.
    const m = await load({ url: URL_OK, anon: ANON_OK });

    const thrown = thrownBy(() => m.createServerClient());

    expect(thrown).toBeInstanceOf(Error);
    expect(Object.prototype.hasOwnProperty.call(thrown, "code")).toBe(false);
    expect((thrown as { code?: unknown }).code).toBeUndefined();
  });

  it("says nothing that would read as a transient failure", async () => {
    // Several catch sites turn this message into a user-facing body (see the
    // catalog routes, which return error.message verbatim). Wording it like a
    // network blip would invite a retry that can never succeed: the fault is a
    // missing variable and only a redeploy changes it.
    //
    // Asserted through a caught value rather than by handing a matcher to
    // toThrow: a matcher that this version silently ignored would leave a test
    // that passes on any throw at all.
    const m = await load({ url: URL_OK, anon: ANON_OK });

    const thrown = thrownBy(() => m.createServerClient());

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toMatch(/network|timeout|fetch/i);
  });

  it("constructs when all three values are present", async () => {
    const m = await load({ url: URL_OK, anon: ANON_OK, service: SERVICE_OK });

    expect(() => m.createServerClient()).not.toThrow();
  });
});

describe("createServerClient — the pre-existing checks are unchanged", () => {
  it("reports a missing URL with the message it always used", async () => {
    // The exact string matters beyond tidiness: plaidConnectionReadSeam and
    // plaidConnectionDeleteSeam both fake a construction failure by throwing
    // this literal. Changing it would leave those mocks imitating a message the
    // real module can no longer produce.
    const m = await load({ anon: ANON_OK, service: SERVICE_OK });

    expect(() => m.createServerClient()).toThrow(URL_ANON_MESSAGE);
  });

  it("reports a missing anon key with the message it always used", async () => {
    const m = await load({ url: URL_OK, service: SERVICE_OK });

    expect(() => m.createServerClient()).toThrow(URL_ANON_MESSAGE);
  });

  it("answers for the URL first when the service role key is also absent", async () => {
    // Which check fires first is observable — it decides what an operator reads
    // in the log — so it is stated here rather than left to the reading order
    // of the source.
    const m = await load({ anon: ANON_OK });

    expect(() => m.createServerClient()).toThrow(URL_ANON_MESSAGE);
  });
});

describe("the rest of the module is untouched", () => {
  it("createAdminClient still requires URL and the service role key", async () => {
    const missing = await load({ url: URL_OK, anon: ANON_OK });
    expect(() => missing.createAdminClient()).toThrow(
      "Supabase URL and service role key are required for admin operations"
    );

    const present = await load({
      url: URL_OK,
      anon: ANON_OK,
      service: SERVICE_OK,
    });
    expect(() => present.createAdminClient()).not.toThrow();
  });

  it("isSupabaseConfigured still asks only about URL and the anon key", async () => {
    // This is the load-bearing half of the scope claim. Several routes gate on
    // this predicate and then construct a server client, so it passing while
    // createServerClient throws is a real state — narrowing the predicate to
    // match would change those routes' behaviour, which this change does not do.
    const noService = await load({ url: URL_OK, anon: ANON_OK });
    expect(noService.isSupabaseConfigured()).toBe(true);
    expect(() => noService.createServerClient()).toThrow(SERVICE_MESSAGE);

    const noAnon = await load({ url: URL_OK, service: SERVICE_OK });
    expect(noAnon.isSupabaseConfigured()).toBe(false);
  });

  it("isSupabaseAdminConfigured still asks only about URL and the service role key", async () => {
    const withService = await load({ url: URL_OK, service: SERVICE_OK });
    expect(withService.isSupabaseAdminConfigured()).toBe(true);

    const withoutService = await load({ url: URL_OK, anon: ANON_OK });
    expect(withoutService.isSupabaseAdminConfigured()).toBe(false);
  });
});
