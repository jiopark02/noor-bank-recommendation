import { describe, it, expect } from "vitest";
import { PlaidEnvironments } from "plaid";
import { PLAID_ENVIRONMENT, resolvePlaidEnvironment } from "../plaid";

/**
 * Which Plaid environment a PLAID_ENV value means.
 *
 * WHY THIS NEEDS A TEST AT ALL
 * The name looks like a restatement of PLAID_ENV and is not one. PlaidEnvironments
 * holds exactly two keys, and an unrecognized value used to fall through to the
 * SDK's own BASE_PATH, which is production: a deployment with PLAID_ENV="dev"
 * talked to PRODUCTION Plaid, silently. tsc cannot see that — PlaidEnvironment is
 * declared with an index signature returning `string`, so an undefined lookup
 * type-checks clean. The resolver now answers sandbox, NOT recognized, for every
 * such value, and isPlaidConfigured() reads the second half of that answer.
 *
 * It matters twice over. The name is one of the three conditions under which
 * plaidRevocation.ts folds an already-removed Item into success. "sandbox" for an
 * unrecognized value is safe there for two reasons: the routes that revoke refuse
 * before revoking when isPlaidConfigured() is false, and if one ever did not, the
 * call would go to sandbox (the basePath is built from the same name), so the
 * comparison still describes where the call went — and a production token
 * compared against "sandbox" is an env_mismatch, whose row is kept.
 *
 * WHAT THIS FILE PROVES
 * The mapping, on every row, by calling the real (pure) function. That the four
 * recognized rows produce the same URL the original expression produced. That no
 * unrecognized row produces the production URL.
 *
 * WHAT IT DOES NOT PROVE
 * Nothing about the live deployment: PLAID_ENV's real value is live state and is
 * read from the Vercel dashboard, never from here. The import-time path — the
 * constants, the log line, isPlaidConfigured() — is executed by
 * plaidEnvironmentGate.test.ts, which re-imports the module per case. Importing
 * this module runs plaid.ts's side effects (Configuration, the axios instance,
 * the interceptor, the PlaidApi), exactly as plaidClientWiring.test.ts does —
 * offline, since no client method is ever called.
 */

/**
 * What the SDK substitutes when `configuration.basePath` is falsy.
 *
 * Hardcoded because `BASE_PATH` is not reachable from the `plaid` package root —
 * its index re-exports ./api and ./configuration only, and BASE_PATH lives in
 * ./base. Verified against the installed copy at dist/base.js:23, with the
 * substitution itself at dist/base.js:40,44 (`basePath = exports.BASE_PATH`, then
 * `configuration.basePath || this.basePath`). If an upgrade changes this default,
 * the equivalence test below fails — which is the correct outcome.
 */
const SDK_DEFAULT_BASE_PATH = "https://production.plaid.com";

/**
 * The original expression, reproduced exactly, plus the SDK default it silently
 * relied on. `||` and not `??`, because that is the operator BaseAPI uses
 * (dist/base.js:44). Kept so the recognized rows can be shown unchanged.
 */
function legacyBasePath(raw: string | undefined): string {
  const fromMap =
    PlaidEnvironments[(raw as keyof typeof PlaidEnvironments) || "sandbox"];
  return fromMap || SDK_DEFAULT_BASE_PATH;
}

const RECOGNIZED_ROWS: Array<string | undefined> = [
  undefined,
  "",
  "sandbox",
  "production",
];

const UNRECOGNIZED_ROWS: string[] = [
  "development",
  "Production",
  "Sandbox",
  " sandbox",
  "production ",
  "dev",
];

function label(row: string | undefined): string {
  return `PLAID_ENV=${row === undefined ? "<unset>" : JSON.stringify(row)}`;
}

describe("resolvePlaidEnvironment — the mapping", () => {
  it("answers sandbox, recognized, when the variable is not set at all", () => {
    expect(resolvePlaidEnvironment(undefined)).toEqual({
      name: "sandbox",
      recognized: true,
    });
  });

  it("answers sandbox, recognized, for an empty string", () => {
    // Falsy, so the original expression's `|| "sandbox"` caught it too. An unset
    // variable and a variable set to "" are the same case and must stay so.
    expect(resolvePlaidEnvironment("")).toEqual({
      name: "sandbox",
      recognized: true,
    });
  });

  it("answers sandbox, recognized, for sandbox", () => {
    expect(resolvePlaidEnvironment("sandbox")).toEqual({
      name: "sandbox",
      recognized: true,
    });
  });

  it("answers production, recognized, for production", () => {
    expect(resolvePlaidEnvironment("production")).toEqual({
      name: "production",
      recognized: true,
    });
  });

  it("answers sandbox, NOT recognized, for a value the SDK does not know", () => {
    // "development" was a real Plaid environment and this SDK version dropped it.
    // It used to reach production through the SDK default; it must not.
    expect(resolvePlaidEnvironment("development")).toEqual({
      name: "sandbox",
      recognized: false,
    });
  });

  it("answers sandbox, NOT recognized, for a near-miss of a name it knows", () => {
    // Exact match only. Case and surrounding whitespace are NOT normalized: a
    // value that differs from the two names in any way is a misconfiguration to
    // surface, not an intent to guess.
    for (const row of ["Production", "Sandbox", " sandbox", "production "]) {
      expect(resolvePlaidEnvironment(row), label(row)).toEqual({
        name: "sandbox",
        recognized: false,
      });
    }
  });
});

describe("resolvePlaidEnvironment — the URL each row produces", () => {
  it("produces the same basePath as the original expression on every recognized row", () => {
    for (const row of RECOGNIZED_ROWS) {
      expect(
        PlaidEnvironments[resolvePlaidEnvironment(row).name],
        label(row)
      ).toBe(legacyBasePath(row));
    }
  });

  it("never produces the production URL for an unrecognized row", () => {
    // THE POINT OF THE CHANGE, executed. Each of these used to resolve to
    // production; the first assertion pins that this is a real behaviour change
    // and not a test of a value that was always sandbox.
    for (const row of UNRECOGNIZED_ROWS) {
      expect(legacyBasePath(row), label(row)).toBe(SDK_DEFAULT_BASE_PATH);
      expect(
        PlaidEnvironments[resolvePlaidEnvironment(row).name],
        label(row)
      ).not.toBe(SDK_DEFAULT_BASE_PATH);
    }
  });

  it("maps each name to the URL the SDK publishes for it", () => {
    // Guards the other direction: the function could return a correct-looking
    // name that indexes nothing. Both keys must exist in the installed SDK.
    expect(PlaidEnvironments.sandbox).toBe("https://sandbox.plaid.com");
    expect(PlaidEnvironments.production).toBe(SDK_DEFAULT_BASE_PATH);
    expect(Object.keys(PlaidEnvironments).sort()).toEqual([
      "production",
      "sandbox",
    ]);
  });
});

describe("PLAID_ENVIRONMENT — one value, shared", () => {
  it("is the name the resolver gives for the environment this module loaded in", () => {
    // The constant is computed once, at import. That is the point: the basePath
    // the client was built with and the name the revocation check reads are the
    // same value, so they cannot disagree within a process.
    expect(PLAID_ENVIRONMENT).toBe(
      resolvePlaidEnvironment(process.env.PLAID_ENV).name
    );
  });

  it("is one of the two names, never an arbitrary string", () => {
    expect(["sandbox", "production"]).toContain(PLAID_ENVIRONMENT);
  });

  it("indexes a real SDK environment", () => {
    // If it ever did not, the client would be built with basePath undefined and
    // would quietly talk to production.
    expect(PlaidEnvironments[PLAID_ENVIRONMENT]).toBeTypeOf("string");
    expect(PlaidEnvironments[PLAID_ENVIRONMENT]).toMatch(
      /^https:\/\/(sandbox|production)\.plaid\.com$/
    );
  });
});
