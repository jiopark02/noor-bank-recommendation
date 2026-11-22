import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Nothing in the application calls the function that records a shared bank
 * connection entering a chat session.
 *
 * That function is the only writer of the table the purge and the memory
 * jobs decide on. The code that will call it has to take the moment before
 * it saves the turn and record it for the session the turn is saved in; until
 * that code exists, a call added anywhere else would mark sessions with no
 * such guarantee. This probe turns red when any application file names the
 * function, in code or in a comment, so the first caller cannot arrive
 * without this file changing.
 *
 * It reads source text and executes nothing. The name is split so this file
 * never matches itself; test files are not walked.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");
const MIGRATION = path.resolve(
  HERE,
  "../../../supabase/migrations/20261122120000_chat_shared_sources.sql"
);

const FUNCTION = ["chat", "shared", "source", "record"].join("_");

function walk(dir: string, out: string[] = []): string[] {
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

function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

describe("callers of the shared source recording function", () => {
  it("the name probed is the function the migration defines", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain(`create or replace function public.${FUNCTION}(`);
  });

  it("no application file names it", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(0);
    const found = files
      .filter((file) => readFileSync(file, "utf8").includes(FUNCTION))
      .map(relative)
      .sort();
    expect(found, "an application file names the recording function").toEqual([]);
  });
});
