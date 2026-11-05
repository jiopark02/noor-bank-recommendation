import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that drops the unused legacy tables. It cannot
 * run the SQL; it holds the lines whose loss would let the drop take unknown
 * dependents with it, drop a parent before its child, or let the closing check
 * miss a table or a function. Whether the file is applied, and whether its DO
 * block passed, is live state that only the database can answer.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * The functions to drop are not listed here by hand: D6 derives them from the
 * repository's other migrations — every function whose definition names a
 * dropped table — with the argument types each definition declares.
 *
 * Mutations and the test each one turns red:
 *   cascade added to any drop                          -> D2
 *   comments dropped after posts                       -> D3
 *   universities dropped before apartments             -> D3
 *   a table removed from the DO block's array          -> D4
 *   a drop removed or written twice                    -> D1
 *   any other drop function, view, schema, type        -> D1
 *   begin or commit removed                            -> D5
 *   a function drop moved after the first table drop   -> D6
 *   a function drop's argument types changed           -> D1, D6
 *   a function removed from the DO block's checks      -> D4
 *   either loop's raise removed or weakened            -> D4
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const MIGRATION_FILE = "20261104130000_drop_unused_legacy_tables.sql";

function stripLineComments(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
}

const sql = stripLineComments(
  readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8")
);

const TABLES = [
  "comments",
  "posts",
  "recommendations_new",
  "user_country_preferences",
  "country_checklist_items",
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

/** name(argument types), as the migration writes it after public. */
const FUNCTIONS = [
  "get_bank_branches_by_university(varchar, varchar)",
  "get_banks_by_country(varchar)",
  "get_banks_no_tax_id(varchar)",
  "get_country_data(varchar)",
];

function dropStatement(table: string): string {
  return `drop table if exists public.${table};`;
}

function dropFunctionStatement(signature: string): string {
  return `drop function if exists public.${signature};`;
}

/** Splits on commas outside parentheses, so numeric(10, 2) stays whole. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < list.length; i++) {
    const ch = list.charAt(i);
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
}

/** "p_country VARCHAR(2) DEFAULT NULL" -> "varchar" */
function argumentType(parameter: string): string {
  const tokens = parameter
    .replace(/\s+default\s[\s\S]*$/i, "")
    .replace(/\(\s*\d+(\s*,\s*\d+)?\s*\)/g, "")
    .trim()
    .toLowerCase()
    .split(/\s+/);
  const type = tokens.slice(1).join(" ");
  return type === "character varying" ? "varchar" : type;
}

/**
 * Every function another migration in this repository creates whose
 * definition (return type or body) names a table this migration drops.
 */
function functionsOverDroppedTables(): string[] {
  const found = new Set<string>();
  const definition =
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(((?:[^()]|\([^()]*\))*)\)([\s\S]*?)(\$[a-z_]*\$)([\s\S]*?)\4/gi;
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql") || file === MIGRATION_FILE) continue;
    const text = stripLineComments(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    let match: RegExpExecArray | null;
    definition.lastIndex = 0;
    while ((match = definition.exec(text)) !== null) {
      const header = match[3];
      const body = match[5];
      const names = TABLES.some((table) =>
        new RegExp(`\\b(?:public\\.)?${table}\\b`, "i").test(`${header}\n${body}`)
      );
      if (!names) continue;
      const types = splitTopLevel(match[2]).map(argumentType);
      found.add(`${match[1].toLowerCase()}(${types.join(", ")})`);
    }
  }
  return Array.from(found).sort();
}

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

/**
 * The text between a foreach header, found at or after `from`, and the first
 * end loop after it. Fails when either is missing, so a lost end loop cannot
 * widen the cut to the rest of the file.
 */
function loopBody(header: string, from: number): string {
  const start = sql.indexOf(header, from);
  expect(start, header).toBeGreaterThan(-1);
  const bodyStart = start + header.length;
  const end = sql.indexOf("end loop;", bodyStart);
  expect(end, header).toBeGreaterThan(bodyStart);
  return sql.slice(bodyStart, end);
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

    for (const signature of FUNCTIONS) {
      expect(occurrences(dropFunctionStatement(signature)), signature).toBe(1);
    }
    const functionDrops = sql.match(/\bdrop\s+(function|procedure|routine)\b/gi) ?? [];
    expect(functionDrops.length).toBe(FUNCTIONS.length);
    expect(sql).not.toMatch(/\bdrop\s+(view|materialized|schema|type|trigger|policy|index)\b/i);
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

    // Each loop is cut from its foreach to its own end loop, and the check and
    // its raise are asserted inside that cut, raise directly in the if: a
    // raise elsewhere in the block must not stand in for this one.
    const tableLoop = loopBody("foreach v_name in array v_tables loop", doStart);
    expect(tableLoop).toMatch(
      /^\s*if to_regclass\('public\.' \|\| v_name\) is not null then\s+raise exception [^;]*;\s+end if;\s*$/
    );

    const functionsStart = sql.indexOf("v_functions text[] := array[", doStart);
    expect(functionsStart).toBeGreaterThan(arrayEnd);
    const functionsEnd = sql.indexOf("];", functionsStart);
    const checked = (
      sql.slice(functionsStart, functionsEnd).match(/'public\.([^']+)'/g) ?? []
    ).map((quoted) => quoted.slice("'public.".length, -1));
    expect([...checked].sort()).toEqual([...FUNCTIONS].sort());

    const functionLoop = loopBody("foreach v_name in array v_functions loop", functionsEnd);
    expect(functionLoop).toMatch(
      /^\s*if to_regprocedure\(v_name\) is not null then\s+raise exception [^;]*;\s+end if;\s*$/
    );

    const functionChecks = sql.slice(functionsEnd);

    // The same functions by name, so a definition with other argument types
    // is caught too.
    const byNameStart = functionChecks.indexOf("p.proname in (");
    expect(byNameStart).toBeGreaterThan(-1);
    const byNameEnd = functionChecks.indexOf(")", byNameStart);
    const byName = (
      functionChecks.slice(byNameStart, byNameEnd).match(/'([a-z_]+)'/g) ?? []
    ).map((quoted) => quoted.slice(1, -1));
    expect([...byName].sort()).toEqual(FUNCTIONS.map((s) => s.slice(0, s.indexOf("("))).sort());
    expect(functionChecks).toContain("n.nspname = 'public'");
    expect(functionChecks.slice(byNameEnd)).toMatch(
      /if v_name is not null then\s+raise exception/
    );
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

  it("D6 drops, before any table and under the lock timeout, every function another migration defines over a dropped table", () => {
    const derived = functionsOverDroppedTables();
    // An empty derivation would pass the comparison below vacuously.
    expect(derived.length).toBeGreaterThan(0);
    expect(derived).toContain("get_banks_by_country(varchar)");

    const dropped: string[] = [];
    const dropFunction = /drop function if exists public\.([a-z_][a-z0-9_]*\([^)]*\));/g;
    let match: RegExpExecArray | null;
    while ((match = dropFunction.exec(sql)) !== null) dropped.push(match[1]);
    dropped.sort();
    expect(dropped).toEqual(derived);

    const lock = sql.indexOf("set local lock_timeout = '5s';");
    const firstTableDrop = sql.indexOf("drop table");
    for (const signature of dropped) {
      const at = sql.indexOf(dropFunctionStatement(signature));
      expect(at, signature).toBeGreaterThan(lock);
      expect(at, signature).toBeLessThan(firstTableDrop);
    }
  });
});
