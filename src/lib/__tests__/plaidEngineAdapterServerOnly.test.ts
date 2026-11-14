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
 * The cash-flow engine package is server only: it uses node:crypto. A value
 * import from a page, a component or a client-safe helper would pull it
 * toward the browser bundle, where node:crypto does not exist.
 *
 * Rule: a value import of the package is allowed in the adapter and in route
 * handlers under app/api; anywhere else only `import type` may name it.
 *
 * Mutations that turn this block red:
 *   - a page or a client-safe helper (bankSummaryView, say) imports a value
 *     from the package
 *   - the package is reached through `require(` or a dynamic `import(`
 *     outside the allowed files
 *   - the summary route stops declaring the Node.js runtime, or names "edge"
 *   - the engine called a second time anywhere, or its answer not bound as
 *     `unknown` where it is called
 *
 * Limits: the same as above — one import statement at a time, no re-exports.
 */
const ENGINE_PACKAGE = /["']@sungwon0162\/cf-engine["']/;

function enginePackageImports(source: string): string[] {
  const statements = source.match(/(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s*["'][^"']+["']/g) ?? [];
  const calls = source.match(/\b(?:require|import)\s*\(\s*["'][^"']+["']\s*\)/g) ?? [];
  return statements.concat(calls).filter((s) => ENGINE_PACKAGE.test(s)).map((s) => s.trim());
}

function mayImportEngineValues(relPath: string): boolean {
  if (relPath === "lib/plaidEngineAdapter.ts") return true;
  return relPath.startsWith("app/api/") && /\/route\.(ts|js)$/.test(relPath);
}

describe("the cash-flow engine package stays on the server", () => {
  const files = walk(SRC);

  it("finds the known importers (the probe is pointed at real code)", () => {
    const importers = files
      .filter((f) => enginePackageImports(readFileSync(f, "utf8")).length > 0)
      .map(rel);
    expect(importers).toContain("app/api/finance/summary/route.ts");
  });

  it("outside the adapter and app/api route handlers, only `import type` reaches the package", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const r = rel(file);
      if (mayImportEngineValues(r)) continue;
      for (const statement of enginePackageImports(readFileSync(file, "utf8"))) {
        if (!/^(?:import|export)\s+type\b/.test(statement)) offenders.push(`${r}: ${statement}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no \"use client\" file names the package, even for types", () => {
    const offenders = files
      .filter((f) => {
        const source = readFileSync(f, "utf8");
        return /^\s*["']use client["']/.test(source) && enginePackageImports(source).length > 0;
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the pattern matches the package and not a look-alike", () => {
    expect(ENGINE_PACKAGE.test(`from "@sungwon0162/cf-engine"`)).toBe(true);
    expect(ENGINE_PACKAGE.test(`from "@sungwon0162/cf-engine-extra"`)).toBe(false);
  });

  // Red if: the engine is called in a second place, or its answer is kept or
  // returned under its declared type instead of being checked as unknown.
  it("the engine is called in one place, and its answer is bound as unknown", () => {
    const calls: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (/\banalyzeCashFlow\s*\(/.test(line) && !/^\s*(?:\/\/|\*)/.test(line)) {
          calls.push(`${rel(file)}: ${line.trim()}`);
        }
      }
    }
    expect(calls).toEqual([
      "lib/plaidEngineAdapter.ts: const answer: unknown = analyzeCashFlow(input, ENGINE_PROFILE);",
    ]);
  });

  it("the summary route declares the Node.js runtime", () => {
    const route = readFileSync(path.join(SRC, "app/api/finance/summary/route.ts"), "utf8");
    expect(route).toMatch(/^export const runtime = "nodejs";$/m);
    expect(route).not.toMatch(/runtime\s*=\s*["']edge["']/);
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
