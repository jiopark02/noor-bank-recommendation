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
