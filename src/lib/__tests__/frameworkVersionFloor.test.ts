import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The lowest framework version this project accepts.
 *
 * Earlier releases of the framework carry published security advisories, so
 * the version is pinned exactly, held at or above a floor, and kept the same
 * in package.json, the lockfile and the installed tree. CI installs with
 * `npm ci` before running this file, so a downgrade turns a pull request red.
 * There is no ceiling: moving to a later major version must not be blocked.
 *
 * Mutations that turn this file red:
 *   - a range ("^", "~", ">=") instead of an exact version for next
 *   - next set below the floor
 *   - the lockfile entry for next naming another version than package.json
 *   - package.json changed without reinstalling, so the installed next differs
 *   - eslint-config-next moved without next, or next without it
 *   - react and react-dom pinned to different versions
 *   - react set below major version 19
 */

// Raise this when a new advisory moves the lowest safe release up.
const NEXT_FLOOR = "15.5.29";
const REACT_MAJOR_FLOOR = 19;

const ROOT = new URL("../../../", import.meta.url);

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, ROOT)), "utf8"));
}

type Triple = [number, number, number];

function parseExact(version: string): Triple | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareTriples(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const pkg = readJson("package.json") as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lock = readJson("package-lock.json") as {
  packages: Record<string, { version?: string }>;
};
const nextPinned = pkg.dependencies.next;

describe("the next version", () => {
  it("is an exact version in package.json", () => {
    expect(typeof nextPinned).toBe("string");
    expect(parseExact(nextPinned)).not.toBeNull();
  });

  it("is at or above the floor", () => {
    const pinned = parseExact(nextPinned);
    const floor = parseExact(NEXT_FLOOR);
    expect(pinned).not.toBeNull();
    expect(floor).not.toBeNull();
    expect(compareTriples(pinned as Triple, floor as Triple)).toBeGreaterThanOrEqual(0);
  });

  it("is the version the lockfile installs", () => {
    expect(lock.packages["node_modules/next"]?.version).toBe(nextPinned);
  });

  it("is the version installed in node_modules", () => {
    const installed = readJson("node_modules/next/package.json") as { version?: string };
    expect(installed.version).toBe(nextPinned);
  });

  it("matches eslint-config-next exactly", () => {
    expect(pkg.devDependencies["eslint-config-next"]).toBe(nextPinned);
  });
});

describe("the react version", () => {
  const reactPinned = pkg.dependencies.react;

  it("is an exact version, the same for react and react-dom", () => {
    expect(parseExact(reactPinned)).not.toBeNull();
    expect(pkg.dependencies["react-dom"]).toBe(reactPinned);
  });

  it("is at or above the major version floor", () => {
    const pinned = parseExact(reactPinned);
    expect(pinned).not.toBeNull();
    expect((pinned as Triple)[0]).toBeGreaterThanOrEqual(REACT_MAJOR_FLOOR);
  });
});
