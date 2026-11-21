import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Which application files can see a share grant.
 *
 * A share grant says one person allowed another to see one bank connection.
 * Nothing in the application reads another person's bank data yet. This
 * probe keeps the grant tables and the grantee column out of every module
 * that reads bank data or builds the chat prompt, so such a read cannot be
 * added there without this file changing: only the share store and the
 * account export may name them in code.
 *
 * Code is read with comments removed, so a comment that explains a cascade
 * does not count as a reference. The bank-reading modules are also checked
 * with their comments, so a reference hidden from the comment stripper is
 * caught there.
 *
 * It reads source text and executes nothing. Identifiers are split so this
 * file never matches itself.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

const IDENTIFIERS = [
  ["share", "grants"].join("_"),
  ["share", "prompt", "answers"].join("_"),
  ["grantee", "user", "id"].join("_"),
];

/** The only files that may name the identifiers in code. */
const ALLOWED = ["lib/accountExport.ts", "lib/householdShareStore.ts"];

/** Modules that read bank data or build what the model sees. */
const BANK_READERS = [
  "lib/plaidApiUtils.ts",
  "lib/plaidChatState.ts",
  "lib/plaidChatContext.ts",
  "lib/plaidEngineAdapter.ts",
  "lib/plaidEgressPolicy.ts",
  "lib/bankSummaryView.ts",
  "app/api/finance/summary/route.ts",
  "app/api/chat/route.ts",
  "app/api/plaid/connections/route.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Block comments, then line comments not preceded by ':' (keeps URLs). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

describe("share grant references", () => {
  it("only the share store and the account export name the grant tables or the grantee column in code", () => {
    const found = walk(SRC)
      .filter((file) => {
        const code = stripComments(readFileSync(file, "utf8"));
        return IDENTIFIERS.some((id) => code.includes(id));
      })
      .map(relative)
      .sort();
    const outside = found.filter((f) => !ALLOWED.includes(f));
    expect(outside, "a file outside the share store and the export names a grant table").toEqual([]);
  });

  it("no bank-reading module mentions them at all, comments included", () => {
    for (const file of BANK_READERS) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      for (const id of IDENTIFIERS) {
        expect(source.includes(id), `${file}: ${id}`).toBe(false);
      }
    }
  });
});
