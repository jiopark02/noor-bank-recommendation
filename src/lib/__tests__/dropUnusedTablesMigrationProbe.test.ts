import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that drops the unused legacy tables. It cannot
 * run the SQL; it holds the lines whose loss would let the drop take unknown
 * dependents with it, drop a parent before its child, or let the closing check
 * miss a table. Whether the file is applied, and whether its DO block passed,
 * is live state that only the database can answer.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   cascade added to any drop                      -> D2
 *   comments dropped after posts                   -> D3
 *   universities dropped before apartments         -> D3
 *   a table removed from the DO block's array      -> D4
 *   a drop removed or written twice                -> D1
 *   begin or commit removed                        -> D5
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261104130000_drop_unused_legacy_tables.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

const TABLES = [
  "comments",
  "posts",
  "recommendations_new",
  "user_country_preferences",
  "apartments",
  "bank_branches",
  "universities",
  "visa_types",
  "banks",
  "credit_cards",
  "deals",
  "jobs",
  "scholarships",
  "bank_accounts",
  "health_insurance_options",
  "required_documents",
];

function dropStatement(table: string): string {
  return `drop table if exists public.${table};`;
}

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

function dropAt(table: string): number {
  const at = sql.indexOf(dropStatement(table));
  expect(at, table).toBeGreaterThan(-1);
  return at;
}

describe("drop unused legacy tables migration", () => {
  it("D1 drops each table exactly once, and drops nothing else", () => {
    for (const table of TABLES) {
      expect(occurrences(dropStatement(table)), table).toBe(1);
    }
    const drops = sql.match(/\bdrop\s+table\b/gi) ?? [];
    expect(drops.length).toBe(TABLES.length);
    expect(sql).not.toMatch(/\bdrop\s+(function|view|schema|type|trigger)\b/i);
  });

  it("D2 never cascades", () => {
    expect(sql.toLowerCase()).not.toContain("cascade");
  });

  it("D3 drops each child before the table it references", () => {
    expect(dropAt("comments")).toBeLessThan(dropAt("posts"));
    expect(dropAt("user_country_preferences")).toBeLessThan(dropAt("visa_types"));
    expect(dropAt("user_country_preferences")).toBeLessThan(dropAt("banks"));
    expect(dropAt("apartments")).toBeLessThan(dropAt("universities"));
    expect(dropAt("bank_branches")).toBeLessThan(dropAt("universities"));
  });

  it("D4 the DO block checks exactly the dropped tables, and raises on any that remain", () => {
    const doStart = sql.indexOf("\ndo $$");
    expect(doStart).toBeGreaterThan(-1);
    const arrayStart = sql.indexOf("v_tables text[] := array[", doStart);
    expect(arrayStart).toBeGreaterThan(doStart);
    const arrayEnd = sql.indexOf("];", arrayStart);
    const listed = (sql.slice(arrayStart, arrayEnd).match(/'([a-z_]+)'/g) ?? []).map(
      (quoted) => quoted.slice(1, -1)
    );
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...TABLES].sort());

    const body = sql.slice(arrayEnd);
    expect(body).toContain("foreach v_name in array v_tables loop");
    expect(body).toContain("if to_regclass('public.' || v_name) is not null then");
    expect(body).toContain("raise exception");
  });

  it("D5 runs in one transaction with a lock timeout, the check before commit", () => {
    const begin = sql.indexOf("\nbegin;\n");
    const lock = sql.indexOf("set local lock_timeout = '5s';");
    const firstDrop = sql.indexOf("drop table");
    const check = sql.indexOf("\ndo $$");
    const commit = sql.lastIndexOf("\ncommit;");
    expect(begin).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(begin);
    expect(firstDrop).toBeGreaterThan(lock);
    expect(check).toBeGreaterThan(firstDrop);
    expect(commit).toBeGreaterThan(check);
    expect(occurrences("\nbegin;\n")).toBe(1);
    expect(occurrences("\ncommit;")).toBe(1);
  });
});
