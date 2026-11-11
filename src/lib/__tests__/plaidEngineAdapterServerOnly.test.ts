import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The Plaid -> engine adapter is server only: it decrypts stored access tokens
 * and calls Plaid. The `server-only` package is not installed, so this source
 * probe holds the line instead.
 *
 * Rule: outside route handlers under app/api, a file may import from the
 * adapter only with `import type`, which the compiler erases. A value import
 * from a page, a component or a client-safe helper would pull the adapter (and
 * the Plaid client) toward the browser bundle.
 *
 * Mutations that turn this file red:
 *   - a page or a client-safe helper imports a value from the adapter
 *   - the adapter is reached through `require(` or a dynamic `import(`
 *
 * Limits: it reads source text one import statement at a time. It does not
 * follow re-exports, so a server module that re-exports adapter values and is
 * then imported by a page is not caught.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");
const ADAPTER = /["'](?:@\/lib\/|\.\.?\/(?:[^"']*\/)?)plaidEngineAdapter["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

/** Every import/export-from statement and require/dynamic import naming the adapter. */
function adapterImports(source: string): string[] {
  const statements = source.match(/(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s*["'][^"']+["']/g) ?? [];
  const calls = source.match(/\b(?:require|import)\s*\(\s*["'][^"']+["']\s*\)/g) ?? [];
  return statements.concat(calls).filter((s) => ADAPTER.test(s)).map((s) => s.trim());
}

describe("the Plaid -> engine adapter stays on the server", () => {
  const files = walk(SRC).filter((f) => !rel(f).startsWith("lib/plaidEngineAdapter."));

  it("finds the known importers (the probe is pointed at real code)", () => {
    const importers = files.filter((f) => adapterImports(readFileSync(f, "utf8")).length > 0).map(rel);
    expect(importers).toContain("app/api/finance/summary/route.ts");
    expect(importers).toContain("lib/bankSummaryView.ts");
  });

  it("outside app/api route handlers, only `import type` reaches the adapter", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const r = rel(file);
      if (r.startsWith("app/api/") && /\/route\.(ts|js)$/.test(r)) continue;
      for (const statement of adapterImports(readFileSync(file, "utf8"))) {
        if (!/^(?:import|export)\s+type\b/.test(statement)) offenders.push(`${r}: ${statement}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/*
 * "@/lib/plaid" builds the Plaid API client when it is evaluated, so a client
 * page that imports a value from it pulls that module into the browser
 * bundle. Display-only data it used to hold lives in client-safe modules.
 *
 * Mutation that turns this block red: a `"use client"` file imports a value
 * from "@/lib/plaid" again (for example `import { CATEGORY_ICONS } from
 * "@/lib/plaid"`).
 *
 * Limits: the same as above — one import statement at a time, no re-exports.
 */
const PLAID_MODULE = /["'](?:@\/lib\/|\.\.?\/(?:[^"']*\/)?)plaid["']/;

function plaidModuleImports(source: string): string[] {
  const statements = source.match(/(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s*["'][^"']+["']/g) ?? [];
  const calls = source.match(/\b(?:require|import)\s*\(\s*["'][^"']+["']\s*\)/g) ?? [];
  return statements.concat(calls).filter((s) => PLAID_MODULE.test(s)).map((s) => s.trim());
}

function isClientModule(source: string): boolean {
  return /^\s*["']use client["']/.test(source);
}

describe("client pages import no values from the Plaid client module", () => {
  const files = walk(SRC);

  it("finds the client pages (the probe is pointed at real code)", () => {
    const clients = files.filter((f) => isClientModule(readFileSync(f, "utf8"))).map(rel);
    expect(clients).toContain("app/money/page.tsx");
    expect(clients).toContain("app/dashboard/page.tsx");
  });

  it("only `import type` reaches \"@/lib/plaid\" from a \"use client\" file", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!isClientModule(source)) continue;
      for (const statement of plaidModuleImports(source)) {
        if (!/^(?:import|export)\s+type\b/.test(statement)) offenders.push(`${rel(file)}: ${statement}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the pattern matches the module itself and not its neighbours", () => {
    expect(PLAID_MODULE.test(`from "@/lib/plaid"`)).toBe(true);
    expect(PLAID_MODULE.test(`from "../lib/plaid"`)).toBe(true);
    expect(PLAID_MODULE.test(`from "@/lib/plaidApiUtils"`)).toBe(false);
    expect(PLAID_MODULE.test(`from "@/lib/plaidEngineAdapter"`)).toBe(false);
  });
});
