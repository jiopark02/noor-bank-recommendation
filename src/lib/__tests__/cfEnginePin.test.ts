import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * How the cash-flow engine package is pinned and fetched.
 *
 * The version lives in package.json only; everything below reads it from
 * there, so moving to another version changes package.json (and the lockfile
 * npm regenerates) and nothing else.
 *
 * Mutations that turn this file red:
 *   - a range ("^", "~", "x", ">=") instead of an exact version in package.json
 *   - the lockfile entry naming another version than package.json
 *   - the lockfile resolving the package from any host but GitHub Packages
 *   - the lockfile entry losing its sha512 integrity
 *   - a token value written into the project .npmrc (the repository is public)
 *   - the scope's registry line removed from the project .npmrc
 */

const PACKAGE = "@sungwon0162/cf-engine";
const ROOT = new URL("../../../", import.meta.url);

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, ROOT)), "utf8"));
}

const pkg = readJson("package.json") as { dependencies: Record<string, string> };
const lock = readJson("package-lock.json") as {
  packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
};
const pinned = pkg.dependencies[PACKAGE];

describe("the engine package pin", () => {
  it("is an exact version in package.json", () => {
    expect(typeof pinned).toBe("string");
    expect(pinned).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it("the lockfile installs that version from GitHub Packages, with a sha512 integrity", () => {
    const entry = lock.packages[`node_modules/${PACKAGE}`];
    expect(entry).toBeDefined();
    expect(entry.version).toBe(pinned);
    expect(entry.resolved?.startsWith("https://npm.pkg.github.com/")).toBe(true);
    expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
  });
});

describe("the project .npmrc", () => {
  const lines = readFileSync(fileURLToPath(new URL(".npmrc", ROOT)), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#") && !l.startsWith(";"));

  it("sends the scope to GitHub Packages", () => {
    expect(lines).toContain("@sungwon0162:registry=https://npm.pkg.github.com");
  });

  it("carries no token value, only the environment variable reference", () => {
    const auth = lines.filter((l) => /_authToken|_auth\b|_password|token/i.test(l));
    expect(auth).toEqual(["//npm.pkg.github.com/:_authToken=${NPM_TOKEN}"]);
  });
});
