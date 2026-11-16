import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PLAID_REVOKE_ROUTE_MAX_DURATION_SECONDS } from "../plaidRevocation";

/**
 * Source probe: every route that can reach a revocation declares the same
 * maxDuration the revocation loop's time check assumes, and the account
 * deletion route takes its clock from the start of the request.
 *
 * The platform reads `maxDuration` statically, so each route states it as a
 * literal rather than importing the constant; this file holds the two equal.
 * It reads source text and executes nothing; the time check itself is executed
 * in plaidRevocation.test.ts.
 *
 * Mutations that turn this file red:
 *   - a route's maxDuration removed, changed, or declared twice   -> "declares"
 *   - the constant changed without the routes                     -> "declares"
 *   - startedAt taken after authentication, or not passed through -> "request start"
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** Comments removed, so assertions are about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTES = [
  "../../app/api/account/delete/route.ts",
  "../../app/api/plaid/disconnect/route.ts",
  "../../app/api/plaid/webhook/route.ts",
  "../../app/api/plaid/exchange-token/route.ts",
];

describe("routes that reach a revocation", () => {
  it.each(ROUTES)("%s declares the revocation maxDuration exactly once", (route) => {
    const declaration = `export const maxDuration = ${PLAID_REVOKE_ROUTE_MAX_DURATION_SECONDS};`;
    const source = code(read(route));
    expect(source.split(declaration).length - 1).toBe(1);
    expect(source.split("export const maxDuration").length - 1).toBe(1);
  });

  it("the shared value is 300 seconds", () => {
    expect(PLAID_REVOKE_ROUTE_MAX_DURATION_SECONDS).toBe(300);
  });
});

describe("/api/account/delete — the clock starts with the request", () => {
  const source = code(read("../../app/api/account/delete/route.ts"));

  it("takes the start time before authentication", () => {
    const startedAt = source.indexOf("const startedAt = Date.now();");
    const auth = source.indexOf("await getAuthenticatedUserIdFromRequest(");
    expect(startedAt).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(-1);
    expect(startedAt).toBeLessThan(auth);
  });

  it("passes that start time and the real clock to the revocation loop", () => {
    const revokeAll = source.slice(source.indexOf("revokeAll:"));
    expect(revokeAll).toMatch(/startedAtMs:\s*startedAt\b/);
    expect(revokeAll).toMatch(/now:\s*Date\.now\b/);
  });
});
