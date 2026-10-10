import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * AN UNRECOGNIZED PLAID_ENV DISABLES PLAID — executed through the import.
 *
 * plaid.ts reads PLAID_ENV once, at import, and derives three things from that
 * one read: the client's environment (PLAID_ENVIRONMENT), whether the value was
 * recognized (PLAID_ENV_RECOGNIZED, which isPlaidConfigured() reads), and a
 * `[plaid-config]` log line when it was not. None of that can be reached by
 * calling a function with an argument, so each case here resets the module
 * registry, sets the environment, and imports the module fresh.
 *
 * WHAT IT PROVES. For an unrecognized value: the constant is sandbox,
 * isPlaidConfigured() is false even with credentials present, and the log line
 * is written once. For the recognized values: isPlaidConfigured() is true with
 * credentials and no line is written.
 *
 * WHAT IT DOES NOT PROVE. That the routes answer 503 — they read
 * isPlaidConfigured() through their own branches, which nothing here executes.
 * Nothing about the live deployment's value. Importing the module runs its side
 * effects (Configuration, axios instance, interceptor, PlaidApi) offline, as
 * plaidClientWiring.test.ts does; no client method is called. The credentials
 * below are dummies and never leave the process.
 */

const KEYS = ["PLAID_ENV", "PLAID_CLIENT_ID", "PLAID_SECRET"] as const;
const ORIGINAL: Record<string, string | undefined> = Object.fromEntries(
  KEYS.map((key) => [key, process.env[key]])
);

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function importWith(plaidEnv: string | undefined) {
  setEnv("PLAID_ENV", plaidEnv);
  setEnv("PLAID_CLIENT_ID", "test-client-id");
  setEnv("PLAID_SECRET", "test-secret");
  vi.resetModules();
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const plaid = await import("../plaid");
  const configLines = errorSpy.mock.calls
    .map((args) => String(args[0]))
    .filter((line) => line.startsWith("[plaid-config]"));
  return { plaid, configLines };
}

afterEach(() => {
  for (const key of KEYS) setEnv(key, ORIGINAL[key]);
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("an unrecognized PLAID_ENV, at import", () => {
  for (const value of ["Production", " sandbox", "development"]) {
    it(`treats ${JSON.stringify(value)} as unconfigured, on sandbox, and says so once`, async () => {
      const { plaid, configLines } = await importWith(value);

      // MUTATION: resolving the unrecognized row to production fails here.
      expect(plaid.PLAID_ENVIRONMENT).toBe("sandbox");
      expect(plaid.PLAID_ENV_RECOGNIZED).toBe(false);
      // MUTATION: dropping `&& PLAID_ENV_RECOGNIZED` from isPlaidConfigured fails here.
      expect(plaid.isPlaidConfigured()).toBe(false);
      // MUTATION: removing the log fails here.
      expect(configLines).toHaveLength(1);
      expect(configLines[0]).toContain(`value=${JSON.stringify(value)}`);
    });
  }
});

describe("a recognized PLAID_ENV, at import", () => {
  const rows: Array<[string | undefined, "sandbox" | "production"]> = [
    [undefined, "sandbox"],
    ["", "sandbox"],
    ["sandbox", "sandbox"],
    ["production", "production"],
  ];

  for (const [value, expected] of rows) {
    const shown = value === undefined ? "<unset>" : JSON.stringify(value);
    it(`keeps Plaid configured for ${shown}, on ${expected}, with no config line`, async () => {
      const { plaid, configLines } = await importWith(value);

      expect(plaid.PLAID_ENVIRONMENT).toBe(expected);
      expect(plaid.PLAID_ENV_RECOGNIZED).toBe(true);
      expect(plaid.isPlaidConfigured()).toBe(true);
      expect(configLines).toHaveLength(0);
    });
  }

  it("still reports unconfigured without credentials, whatever PLAID_ENV says", async () => {
    // The pre-existing half of the check, unchanged.
    setEnv("PLAID_ENV", "sandbox");
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
    vi.resetModules();
    const plaid = await import("../plaid");

    expect(plaid.isPlaidConfigured()).toBe(false);
  });
});
