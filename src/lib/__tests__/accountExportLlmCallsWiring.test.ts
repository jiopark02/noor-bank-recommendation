import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * GET /api/account/export includes the caller's llm_calls rows, and only
 * theirs.
 *
 * The select names its columns rather than using `*`, so a column added to
 * llm_calls later is not exported until someone decides it should be. The
 * list must be the migration's columns, in order, minus user_id; the payload's
 * top-level user_id already carries that value. Both sides are read from the
 * files themselves, so a typo in the export list (which PostgREST would answer
 * with a 400, failing every export) or a column added to the migration fails
 * here rather than only live.
 *
 * The same migration's closing DO block lists the CHECK constraints it expects
 * to find. That list must name exactly the constraints the CREATE TABLE
 * defines, or the check would either miss a constraint or fail on a name that
 * never exists.
 *
 * ⚠️ A SOURCE PROBE. It shows the query is written with the user filter and
 * the column list. It cannot show the table exists where the route runs: if it
 * does not, the whole export answers 500, by the route's existing rule that a
 * failed section fails the export. That is checked live.
 */

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8"
  ).replace(/\r\n?/g, "\n");
}

const SOURCE = read("../../app/api/account/export/route.ts");
const MIGRATION = read(
  "../../../supabase/migrations/20261009120000_create_llm_calls.sql"
);

function allMatches(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.push(match[1]);
  }
  return found;
}

/** The CREATE TABLE body, from its opening line to the closing `);`. */
const CREATE_TABLE = (() => {
  const start = MIGRATION.indexOf("create table if not exists public.llm_calls (");
  expect(start, "CREATE TABLE not found").toBeGreaterThan(-1);
  const end = MIGRATION.indexOf("\n);\n", start);
  expect(end, "CREATE TABLE has no closing").toBeGreaterThan(start);
  return MIGRATION.slice(start, end);
})();

/** Column names: two-space-indented lines before the first constraint. */
const MIGRATION_COLUMNS = (() => {
  const end = CREATE_TABLE.indexOf("\n  constraint ");
  expect(end, "no constraint section in CREATE TABLE").toBeGreaterThan(-1);
  return allMatches(CREATE_TABLE.slice(0, end), /^ {2}([a-z_]+) /gm);
})();

describe("account export: llm_calls", () => {
  const query = (() => {
    const start = SOURCE.indexOf('.from("llm_calls")');
    expect(start, "llm_calls query not found").toBeGreaterThan(-1);
    const end = SOURCE.indexOf("\n  ]);", start);
    return SOURCE.slice(start, end);
  })();

  it("filters by the verified caller's id", () => {
    expect(query).toContain('.eq("user_id", authUserId)');
  });

  it("selects the migration's columns, in order, minus user_id", () => {
    expect(MIGRATION_COLUMNS).toContain("id");
    expect(MIGRATION_COLUMNS).toContain("user_id");
    expect(MIGRATION_COLUMNS).toContain("session_id");

    const select = /\.select\(\s*"([^"]*)"\s*\)/.exec(query);
    expect(select, "llm_calls select list not found").not.toBeNull();
    const exported = (select as RegExpExecArray)[1].split(", ");

    expect(exported).toEqual(MIGRATION_COLUMNS.filter((c) => c !== "user_id"));
    expect(query).not.toContain('select("*")');
  });

  it("adds the section to the payload", () => {
    expect(SOURCE).toContain('["llm_calls", llmCallsRes]');
  });
});

describe("llm_calls migration: the DO block's expected CHECK names", () => {
  it("leave no CHECK in the CREATE TABLE without a constraint name", () => {
    // Every CHECK in this file sits on a `constraint <name>` line or on the
    // line right after one. A CHECK anywhere else (a column-level CHECK, or one
    // under a bare table-level CHECK) gets a generated name the DO block's list
    // cannot know, so it is rejected here.
    const lines = CREATE_TABLE.split("\n");
    const unnamed = lines.filter((line, i) => {
      if (!/\bcheck\s*\(/.test(line)) return false;
      if (/^\s+constraint [a-z_]+\s+check\s*\(/.test(line)) return false;
      return !(i > 0 && /^\s+constraint [a-z_]+\s*$/.test(lines[i - 1]));
    });
    expect(unnamed).toEqual([]);
  });

  it("are exactly the constraints the CREATE TABLE defines", () => {
    const defined = allMatches(CREATE_TABLE, /^\s+constraint ([a-z_]+)\b/gm);
    expect(defined.length).toBeGreaterThan(0);

    const doStart = MIGRATION.indexOf("\ndo $$");
    expect(doStart, "DO block not found").toBeGreaterThan(-1);
    const arrayStart = MIGRATION.indexOf(
      "v_expected_checks text[] := array[",
      doStart
    );
    expect(arrayStart, "expected CHECK array not found").toBeGreaterThan(-1);
    const arrayEnd = MIGRATION.indexOf("];", arrayStart);
    const expected = allMatches(
      MIGRATION.slice(arrayStart, arrayEnd),
      /'([a-z_]+)'/g
    );

    expect(new Set(expected).size).toBe(expected.length);
    expect([...expected].sort()).toEqual([...defined].sort());
  });

  it("are the list the DO block's EXCEPT query compares against", () => {
    expect(MIGRATION).toContain("select unnest(v_expected_checks)");
  });
});
