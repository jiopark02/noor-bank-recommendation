import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PlaidEnvironments } from "plaid";
import {
  PLAID_ENVIRONMENT,
  resolvePlaidEnvironmentName,
} from "../plaid";

/**
 * Which Plaid environment this deployment is configured for.
 *
 * WHY THIS NEEDS A TEST AT ALL
 * The name looks like a restatement of PLAID_ENV and is not one. PlaidEnvironments
 * holds exactly two keys, so an unrecognised value does not fail and does not
 * fall back to sandbox: the lookup is undefined, the SDK substitutes its own
 * BASE_PATH, and BASE_PATH is production. A deployment with PLAID_ENV="dev" talks
 * to PRODUCTION Plaid. tsc cannot see that — PlaidEnvironment is declared with an
 * index signature returning `string`, so the undefined lookup type-checks clean —
 * and no other test in this suite reads the value.
 *
 * It matters twice over. The name is about to become one of the three conditions
 * under which plaidRevocation.ts folds an already-removed Item into success, so
 * getting "which environment are we" wrong there means either refusing a fold
 * that should happen (a row nobody can delete) or accepting one that should not
 * (a row deleted while its Item is live in the other environment).
 *
 * WHAT THIS FILE PROVES
 * The mapping, on all four rows, by calling the real function. And that the URL
 * the new lookup yields equals the one the previous expression yielded, for every
 * row — the equivalence claim that made the refactor safe, rather than an
 * assertion that the new code agrees with itself.
 *
 * WHAT IT DOES NOT PROVE
 * Nothing about the live deployment: PLAID_ENV's real value is live state and is
 * read from the Vercel dashboard, never from here. It does not inspect the
 * Configuration plaid.ts builds: that basePath is built from PLAID_ENVIRONMENT is
 * a property of plaid.ts's source, not something executed here. And importing
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
 * the equivalence test below fails — which is the correct outcome, not a nuisance:
 * the fourth row of the mapping is derived from it.
 */
const SDK_DEFAULT_BASE_PATH = "https://production.plaid.com";

/**
 * The expression this change replaced, reproduced exactly, plus the SDK default
 * it silently relied on. `||` and not `??`, because that is the operator BaseAPI
 * uses (dist/base.js:44).
 */
function legacyBasePath(): string {
  const fromMap =
    PlaidEnvironments[
      (process.env.PLAID_ENV as keyof typeof PlaidEnvironments) || "sandbox"
    ];
  return fromMap || SDK_DEFAULT_BASE_PATH;
}

const ORIGINAL = process.env.PLAID_ENV;

/** Set or delete PLAID_ENV. `undefined` means "the variable is not present". */
function setPlaidEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.PLAID_ENV;
    return;
  }
  process.env.PLAID_ENV = value;
}

describe("resolvePlaidEnvironmentName — the four rows of the mapping", () => {
  beforeEach(() => {
    setPlaidEnv(ORIGINAL);
  });

  afterEach(() => {
    setPlaidEnv(ORIGINAL);
  });

  it("answers sandbox when the variable is not set at all", () => {
    setPlaidEnv(undefined);

    expect(resolvePlaidEnvironmentName()).toBe("sandbox");
  });

  it("answers sandbox for an empty string", () => {
    // Falsy, so the previous expression's `|| "sandbox"` caught it too. An unset
    // variable and a variable set to "" are the same case and must stay so.
    setPlaidEnv("");

    expect(resolvePlaidEnvironmentName()).toBe("sandbox");
  });

  it("answers sandbox for sandbox", () => {
    setPlaidEnv("sandbox");

    expect(resolvePlaidEnvironmentName()).toBe("sandbox");
  });

  it("answers production for production", () => {
    setPlaidEnv("production");

    expect(resolvePlaidEnvironmentName()).toBe("production");
  });

  it("answers production for a value the SDK does not know", () => {
    // NOT sandbox. "development" was a real Plaid environment and this SDK
    // version dropped it, so PlaidEnvironments has no such key, the lookup is
    // undefined, and the SDK's BASE_PATH — production — is what the deployment
    // actually talked to. Answering "sandbox" here would be the comfortable
    // reading and the wrong one: it would let the revocation fold accept a
    // production token as a sandbox one.
    setPlaidEnv("development");

    expect(resolvePlaidEnvironmentName()).toBe("production");
  });

  it("answers production for a near-miss of a name it knows", () => {
    // Case matters: the lookup is a plain object index, so "Production" and
    // "Sandbox" are both misses. A misspelled sandbox is therefore a PRODUCTION
    // deployment, which is the sharp end of the trap.
    setPlaidEnv("Production");
    expect(resolvePlaidEnvironmentName()).toBe("production");

    setPlaidEnv("Sandbox");
    expect(resolvePlaidEnvironmentName()).toBe("production");

    setPlaidEnv(" sandbox");
    expect(resolvePlaidEnvironmentName()).toBe("production");
  });
});

describe("resolvePlaidEnvironmentName — same URL as the expression it replaced", () => {
  beforeEach(() => {
    setPlaidEnv(ORIGINAL);
  });

  afterEach(() => {
    setPlaidEnv(ORIGINAL);
  });

  it("produces the same basePath as the previous expression, on every row", () => {
    // THE EQUIVALENCE CLAIM, executed. The refactor is only safe if the URL is
    // unchanged for every input, and "the fourth row reaches production either
    // way" is the row worth proving rather than asserting: before, via an
    // undefined lookup and the SDK's default; now, explicitly.
    const rows: Array<string | undefined> = [
      undefined,
      "",
      "sandbox",
      "production",
      "development",
      "Production",
      " sandbox",
    ];

    for (const row of rows) {
      setPlaidEnv(row);
      expect(
        PlaidEnvironments[resolvePlaidEnvironmentName()],
        `PLAID_ENV=${row === undefined ? "<unset>" : JSON.stringify(row)}`
      ).toBe(legacyBasePath());
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
  it("is the name the function resolves for the environment this module loaded in", () => {
    // The constant is computed once, at import. That is the point: the basePath
    // the client was built with and the name the revocation check reads are the
    // same value, so they cannot disagree within a process. It also means this is
    // the only assertion here that cannot vary PLAID_ENV — whatever it was at
    // import is what the constant holds, and re-importing would not re-run it.
    setPlaidEnv(ORIGINAL);

    expect(PLAID_ENVIRONMENT).toBe(resolvePlaidEnvironmentName());
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
