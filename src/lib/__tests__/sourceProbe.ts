import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { expect } from "vitest";

/**
 * Shared pieces of the file-level boundary probes (sharedDataReferences,
 * plaidTokenPlaintextSites, chatSystemPromptSites).
 *
 * The walk and the comment stripper are the ones shareGrantReferences.test.ts
 * and chatSharedSourceRecordCallers.test.ts already use: every source file
 * under src/ outside __tests__ and node_modules, and block comments then line
 * comments not preceded by ':' (so URLs survive). The stripper is regex-based:
 * a string literal containing comment markers can hide code from it.
 *
 * Not a test file itself; it executes nothing in src/.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(HERE, "../..");

export function walk(dir: string = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Block comments, then line comments not preceded by ':' (keeps URLs). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

let cached: Map<string, string> | null = null;

/** Every application file, with its comments removed, keyed by src-relative path. */
export function codeBySourceFile(): Map<string, string> {
  if (cached) return cached;
  const files = walk();
  expect(files.length).toBeGreaterThan(0);
  const out = new Map<string, string>();
  for (const file of files) {
    out.set(relative(file), stripComments(readFileSync(file, "utf8")));
  }
  cached = out;
  return out;
}

/** A target: a name and the pattern that finds it in comment-free code. */
export interface ProbeTarget {
  name: string;
  pattern: RegExp;
  /** src-relative path -> one-line reason the file has to reach the target. */
  allowed: Record<string, string>;
}

/** An identifier as a whole word, so a longer name containing it does not count. */
export function word(identifier: string): RegExp {
  return new RegExp(`\\b${identifier}\\b`);
}

/**
 * Compares the files reaching a target with its allowlist, in both
 * directions: a new file fails, and so does an allowed file that no longer
 * reaches the target (a stale entry).
 */
export function expectAllowlistHolds(
  code: Map<string, string>,
  target: ProbeTarget
): void {
  const found: string[] = [];
  code.forEach((source, file) => {
    if (target.pattern.test(source)) found.push(file);
  });
  found.sort();
  const allowed = Object.keys(target.allowed).sort();
  const unexpected = found.filter((f) => allowed.indexOf(f) === -1);
  const stale = allowed.filter((f) => found.indexOf(f) === -1);
  expect(
    unexpected,
    `A new file reaching ${target.name} must be added to the allowlist with a reason; that addition is a review point.`
  ).toEqual([]);
  expect(
    stale,
    `An allowlisted file no longer reaches ${target.name}; remove it from the allowlist.`
  ).toEqual([]);
}
