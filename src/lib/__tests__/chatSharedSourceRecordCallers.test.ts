import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Who writes the marks the purge and the memory jobs decide on.
 *
 * chat_shared_sources is written by one database function, which records the
 * mark and stores the turn together under the purge's locks. The function it
 * replaced recorded a mark alone, with a moment the caller gave; its migration
 * drops it. This probe turns red when any application file names the old
 * function, in code or in a comment, and when any file but the one that saves
 * a shared turn names the new one, so a second writer cannot arrive without
 * this file changing.
 *
 * It reads source text and executes nothing. The names are split so this file
 * never matches itself; test files are not walked.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");
const MIGRATIONS = path.resolve(HERE, "../../../supabase/migrations");
const OLD_MIGRATION = path.join(MIGRATIONS, "20261122120000_chat_shared_sources.sql");
const NEW_MIGRATION = path.join(MIGRATIONS, "20261124120000_chat_shared_turn_save.sql");

const OLD_FUNCTION = ["chat", "shared", "source", "record"].join("_");
const NEW_FUNCTION = ["chat", "shared", "turn", "save"].join("_");

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

function filesNaming(name: string): string[] {
  const files = walk(SRC);
  expect(files.length).toBeGreaterThan(0);
  return files
    .filter((file) => readFileSync(file, "utf8").includes(name))
    .map(relative)
    .sort();
}

describe("writers of the shared source marks", () => {
  it("the old name is the function the earlier migration defined, and the new migration drops it", () => {
    expect(readFileSync(OLD_MIGRATION, "utf8")).toContain(
      `create or replace function public.${OLD_FUNCTION}(`
    );
    expect(readFileSync(NEW_MIGRATION, "utf8")).toContain(
      `drop function if exists public.${OLD_FUNCTION}(`
    );
  });

  it("no application file names the old function", () => {
    expect(filesNaming(OLD_FUNCTION), "an application file names the replaced recording function").toEqual([]);
  });

  it("the new name is the function the new migration defines", () => {
    expect(readFileSync(NEW_MIGRATION, "utf8")).toContain(
      `create or replace function public.${NEW_FUNCTION}(`
    );
  });

  it("only the module that saves a shared turn names the new function", () => {
    expect(filesNaming(NEW_FUNCTION), "a file other than aiMemory.ts names the function").toEqual([
      "lib/aiMemory.ts",
    ]);
  });
});
