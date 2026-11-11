import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that adds the memory crons' retry and give-up
 * state to public.chat_sessions. It cannot run the SQL. It holds the columns
 * with their types, nullability and defaults, the checks with their exact
 * expressions, the property checks of the DO block and the rule that every
 * failed check rolls the file back, that the file writes no row and grants,
 * indexes and comments nothing, the reversal written in the header, and the
 * text rules the account export test's migration parser depends on. Whether
 * the file is applied, and whether its DO block passed, is live state that
 * only the database can answer.
 *
 * SQL line comments are stripped from `sql`, so the header (which quotes the
 * reversing statements) cannot stand in for a statement or trip a negative
 * check. The header itself is read from `raw`.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261111120000_add_cron_retry_state_to_chat_sessions.sql"
);

const raw = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/--[^\n]*/g, "");

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

function matches(pattern: RegExp): number {
  return (sql.match(pattern) || []).length;
}

const DO_START = "do $$";
const DO_END = "end\n$$;";

function doBlock(): { start: number; end: number; body: string } {
  const start = sql.indexOf(DO_START);
  if (start === -1) throw new Error("no DO block");
  const end = sql.indexOf(DO_END, start);
  if (end === -1) throw new Error("unterminated DO block");
  return { start, end, body: sql.slice(start, end) };
}

const PREFIXES = ["summary", "facts"] as const;

/** Each added column clause, exactly as the alter writes it. */
const COLUMN_CLAUSES = PREFIXES.flatMap((p) => [
  `add column ${p}_failures smallint not null default 0`,
  `add column ${p}_next_attempt_at timestamptz`,
  `add column ${p}_outcome text`,
  `add column ${p}_given_up_reason text`,
  `add column ${p}_given_up_at timestamptz`,
]);

const COLUMNS = PREFIXES.flatMap((p) => [
  `${p}_failures`,
  `${p}_next_attempt_at`,
  `${p}_outcome`,
  `${p}_given_up_reason`,
  `${p}_given_up_at`,
]);

/** Each added check clause, exactly as the alter writes it. */
const CHECK_CLAUSES = PREFIXES.flatMap((p) => [
  `add constraint chat_sessions_${p}_failures_check\n` +
    `    check (${p}_failures >= 0)`,
  `add constraint chat_sessions_${p}_outcome_check\n` +
    `    check (${p}_outcome in ('done', 'given_up'))`,
  `add constraint chat_sessions_${p}_given_up_reason_check\n` +
    `    check (${p}_given_up_reason in ('output_unusable', 'input_rejected'))`,
  `add constraint chat_sessions_${p}_given_up_pair_check\n` +
    `    check (\n` +
    `      (${p}_outcome is not distinct from 'given_up') = (${p}_given_up_reason is not null)\n` +
    `      and (${p}_given_up_reason is null) = (${p}_given_up_at is null)\n` +
    `    )`,
]);

const CHECK_NAMES = PREFIXES.flatMap((p) => [
  `chat_sessions_${p}_failures_check`,
  `chat_sessions_${p}_outcome_check`,
  `chat_sessions_${p}_given_up_reason_check`,
  `chat_sessions_${p}_given_up_pair_check`,
]);

/**
 * The definitions the DO block expects pg_get_constraintdef to print, as SQL
 * string literals (quotes doubled).
 */
const CHECK_DEFINITIONS = PREFIXES.flatMap((p) => [
  `'CHECK ((${p}_failures >= 0))'`,
  `'CHECK ((${p}_outcome = ANY (ARRAY[''done''::text, ''given_up''::text])))'`,
  `'CHECK ((${p}_given_up_reason = ANY (ARRAY[''output_unusable''::text, ''input_rejected''::text])))'`,
  `'CHECK ((((NOT (${p}_outcome IS DISTINCT FROM ''given_up''::text)) = (${p}_given_up_reason IS NOT NULL)) AND ((${p}_given_up_reason IS NULL) = (${p}_given_up_at IS NULL))))'`,
]);

const ALTER =
  "alter table public.chat_sessions\n" +
  [...COLUMN_CLAUSES, ...CHECK_CLAUSES].map((c) => `  ${c}`).join(",\n") +
  ";";

describe("chat_sessions cron state migration", () => {
  it("P1 adds each column with its type, nullability and default, in one alter", () => {
    expect(occurrences(ALTER)).toBe(1);
    for (const clause of COLUMN_CLAUSES) {
      expect(occurrences(clause)).toBe(1);
    }
    // Only the failures counters are not null, and only they have a default.
    expect(matches(/\bnot null default\b/g)).toBe(PREFIXES.length);
    expect(matches(/\bdefault 0\b/g)).toBe(PREFIXES.length);
    expect(matches(/\badd column\b/g)).toBe(COLUMN_CLAUSES.length);
  });

  it("P2 adds each check with its exact expression, the pair checks null-safe", () => {
    for (const clause of CHECK_CLAUSES) {
      expect(occurrences(clause)).toBe(1);
    }
    expect(matches(/\badd constraint\b/g)).toBe(CHECK_CLAUSES.length);
    // `=` against 'given_up' is null when the outcome is null, and a check
    // that evaluates to null passes; the pair checks must not use it.
    expect(matches(/_outcome\s*=\s*'given_up'/g)).toBe(0);
    expect(occurrences("is not distinct from 'given_up'")).toBe(PREFIXES.length);
  });

  it("P3 names each check in the alter and in the DO block, and the DO block lists each column", () => {
    const body = doBlock().body;
    for (const name of CHECK_NAMES) {
      expect(occurrences(`add constraint ${name}\n`)).toBe(1);
      expect(body.split(`'${name}'`).length - 1).toBe(1);
      expect(occurrences(name)).toBe(2);
    }
    for (const column of COLUMNS) {
      expect(body.split(`'${column}'`).length - 1).toBe(1);
    }
    for (const definition of CHECK_DEFINITIONS) {
      expect(body.split(definition).length - 1).toBe(1);
    }
  });

  it("P4 runs in one transaction with a lock timeout set before the alter", () => {
    const trimmed = sql.trim();
    expect(trimmed.startsWith("begin;")).toBe(true);
    expect(trimmed.endsWith("commit;")).toBe(true);
    expect(occurrences("begin;")).toBe(1);
    expect(occurrences("commit;")).toBe(1);
    expect(occurrences("set local lock_timeout = '5s';")).toBe(1);
    expect(matches(/\balter\s+table\b/gi)).toBe(1);
    expect(sql.indexOf("set local lock_timeout")).toBeLessThan(sql.indexOf(ALTER));
  });

  it("P5 checks the end state in one DO block after the alter, and every failed check raises", () => {
    const block = doBlock();
    expect(occurrences(DO_START)).toBe(1);
    expect(block.start).toBeGreaterThan(sql.indexOf(ALTER));
    expect(sql.indexOf("commit;")).toBeGreaterThan(block.end);
    // A raise below EXCEPTION, or a handler, would let a failed check commit.
    expect(block.body).not.toMatch(/\braise\s+(notice|warning|info|log|debug)\b/i);
    expect(block.body).not.toMatch(/\bexception\s+when\b/i);
    expect(block.body).not.toMatch(/\breturn\b/i);
    // Each property named in the header is checked.
    expect(block.body).toContain("format_type(a.atttypid, a.atttypmod)");
    expect(block.body).toContain("a.attnotnull");
    expect(block.body).toContain("pg_get_expr(d.adbin, d.adrelid)");
    expect(block.body).toContain("pg_get_constraintdef(k.oid), k.convalidated");
    expect(block.body).toContain("if not v_validated then");
    expect(block.body).toContain("'chat_sessions_select_own/r'");
    expect(block.body).toContain("has_table_privilege('anon', v_table, p.privilege)");
    expect(block.body).toContain(
      "has_any_column_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,REFERENCES')"
    );
    expect(block.body).toContain(
      "has_table_privilege('authenticated', v_table, p.privilege)"
    );
    expect(block.body).toContain(
      "has_any_column_privilege('authenticated', v_table, 'INSERT,UPDATE,REFERENCES')"
    );
    // Only the failures counters are not null and default to 0.
    expect(block.body).toContain(
      "true, false, false, false, false,\n    true, false, false, false, false"
    );
    expect(block.body).toContain(
      "'0', null, null, null, null,\n    '0', null, null, null, null"
    );
    expect(matches(/\braise exception\b/g)).toBeGreaterThanOrEqual(10);
  });

  it("P6 writes no row", () => {
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bupdate\s+(only\s+)?public\./i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\btruncate\b\s+(table\s+)?public\./i);
    expect(sql).not.toMatch(/\bcopy\b/i);
  });

  it("P7 adds no index, privilege, policy, trigger or function", () => {
    expect(sql).not.toMatch(/\bcreate\s+(unique\s+)?index\b/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).not.toMatch(/\brevoke\b/i);
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+policy\b/i);
    expect(sql).not.toMatch(/\b(create|drop)\s+trigger\b/i);
    expect(sql).not.toMatch(/\bcreate\s+(or\s+replace\s+)?function\b/i);
    expect(sql).not.toMatch(/\bsecurity\s+definer\b/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
  });

  it("P8 sets no comment", () => {
    expect(sql).not.toMatch(/\bcomment\s+on\b/i);
  });

  it("P9 carries the reversal, the deploy order, the limit on existing rows and the live-state rule in its header", () => {
    expect(raw).toContain("--   begin;\n--   alter table public.chat_sessions\n");
    for (const name of CHECK_NAMES) {
      expect(raw).toContain(`--     drop constraint ${name},\n`);
    }
    for (const column of COLUMNS) {
      const last = column === COLUMNS[COLUMNS.length - 1];
      expect(raw).toContain(`--     drop column ${column}${last ? ";" : ","}\n`);
    }
    expect(raw).toContain("--     drop column facts_given_up_at;\n--   commit;\n");
    // The constraints are dropped before the columns.
    expect(raw.indexOf("--     drop constraint")).toBeLessThan(
      raw.indexOf("--     drop column")
    );
    const header = raw
      .split("\n")
      .filter((line) => line.startsWith("--"))
      .map((line) => line.replace(/^--\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(header).toContain(
      "Deploy order: apply this file to a database before deploying code that selects these columns (src/lib/accountExport.ts) against it."
    );
    expect(header).toContain(
      "A session given up before this file was applied has its completion flag set and a null <p>_outcome, exactly like a session that finished normally."
    );
    expect(header).toContain("Existing rows are not filled in.");
    expect(header).toContain(
      "Whether this file has been applied to a given database is live state;"
    );
    expect(header).toContain(
      "Drop the columns only after no deployed code selects them"
    );
  });

  it("P10 keeps the text rules the account export's migration parser relies on", () => {
    // The parser reads an alter of public.chat_sessions up to its first `;`;
    // one inside the DO block would make it read the block as an alter.
    expect(doBlock().body).not.toMatch(/\balter\s+table\b/i);
    // The parser and this probe strip `--` to the end of the line; a `--`
    // that does not start a comment line (a trailing comment, or one inside
    // a string literal) would cut a statement short.
    const offending = raw
      .split("\n")
      .filter((line) => line.includes("--") && !/^\s*--/.test(line));
    expect(offending).toEqual([]);
    // Column names the parser can read: lower-case letters and underscores.
    for (const column of COLUMNS) {
      expect(column).toMatch(/^[a-z_]+$/);
    }
  });
});
