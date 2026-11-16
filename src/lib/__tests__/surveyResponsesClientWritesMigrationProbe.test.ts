import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that leaves client roles read-only on
 * survey_responses. It cannot run the SQL; it holds the lines whose loss would
 * reopen a client write path on the table, take SELECT away from a client
 * role, or touch service_role. It also holds that every check in the DO block
 * fails by raising an exception that nothing catches, so a failed check rolls
 * back the whole file rather than printing a message and committing. Whether
 * the file is applied, and whether its DO block passed, is live state that
 * only the database can answer.
 *
 * SQL line comments are stripped first, so a sentence in the header (which
 * quotes the reversing grants and policies) cannot stand in for a statement or
 * trip a negative check.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261107120000_restrict_client_writes_on_survey_responses.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

const WRITE_POLICIES = [
  '"Users can insert their own survey"',
  '"Users can update their own survey"',
  "survey_insert_own",
  "survey_update_own",
];

const REVOKE = "revoke all on table public.survey_responses from public, anon, authenticated;";
const GRANT = "grant select on table public.survey_responses to anon, authenticated;";

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

function matches(pattern: RegExp): number {
  return (sql.match(pattern) || []).length;
}

// The privileges the DO block requires each client role not to hold, before
// MAINTAIN is appended on PostgreSQL 17 or later.
const DENIED = ["DELETE", "INSERT", "REFERENCES", "TRIGGER", "TRUNCATE", "UPDATE"];

// The privileges the DO block requires service_role to hold.
const SERVICE_ROLE_REQUIRED = ["DELETE", "INSERT", "SELECT", "UPDATE"];

// The one `v_denied text[] := array[ ... ];` declaration.
const DENIED_DECLARATION = /\bv_denied\s+text\[\]\s*:=\s*array\s*\[([^\]]*)\]\s*;/i;

// The array the service_role check walks: `unnest(array[ ... ]) as
// p(privilege)` directly followed by `where not has_table_privilege(
// 'service_role', ...`.
const SERVICE_ROLE_ARRAY =
  /\bunnest\s*\(\s*array\s*\[([^\]]*)\]\s*\)\s*as\s+p\s*\(\s*privilege\s*\)\s*where\s+not\s+has_table_privilege\s*\(\s*'service_role'/i;

/**
 * The privilege names in the array literal that `anchor` captures as its
 * first group, upper-cased and sorted. Throws when the anchor matches no place
 * or more than one, or when an element is not a single-quoted word, so an
 * expression cannot hide a privilege from the comparison.
 */
function quotedArray(anchor: RegExp): string[] {
  const count = matches(new RegExp(anchor.source, "gi"));
  const found = anchor.exec(sql);
  if (count !== 1 || !found) {
    throw new Error(`expected one match of ${anchor.source}, found ${count}`);
  }
  return found[1]
    .split(",")
    .map((element) => {
      const literal = /^'([A-Za-z]+)'$/.exec(element.trim());
      if (!literal) {
        throw new Error(`array element is not a quoted privilege name: ${element.trim()}`);
      }
      return literal[1].toUpperCase();
    })
    .sort();
}

describe("survey_responses: client write migration", () => {
  it("drops the insert and update policies under both the repository and the live names", () => {
    for (const name of WRITE_POLICIES) {
      expect(occurrences(`drop policy if exists ${name} on public.survey_responses;`)).toBe(1);
    }
  });

  it("keeps the select policy and creates none", () => {
    // Any drop of the select policy under either name, whatever the case,
    // quoting, schema or IF EXISTS, within one statement.
    expect(matches(/\bdrop\s+policy\b[^;]*(select_own|view\s+their\s+own\s+survey)/gi)).toBe(0);
    expect(sql.toLowerCase()).not.toContain("create policy");
  });

  it("revokes everything from PUBLIC, anon and authenticated, then grants SELECT back to both", () => {
    expect(occurrences(REVOKE)).toBe(1);
    expect(occurrences(GRANT)).toBe(1);
    expect(sql.indexOf(GRANT)).toBeGreaterThan(sql.indexOf(REVOKE));
    expect(matches(/\bgrant\b/gi)).toBe(1);
  });

  it("names service_role in no revoke or grant", () => {
    expect(matches(/\b(revoke|grant)\b[^;]*service_role/gi)).toBe(0);
  });

  it("checks both client roles hold SELECT and no other privilege, table or column", () => {
    expect(sql).toContain("foreach v_role in array array['anon', 'authenticated'] loop");
    expect(sql).toContain("from unnest(v_denied) as p(privilege)\n     where has_table_privilege(v_role, v_table, p.privilege);");
    expect(sql).toContain("has_any_column_privilege(v_role, v_table, 'INSERT,UPDATE,REFERENCES')");
    expect(sql).toContain("if not has_table_privilege(v_role, v_table, 'SELECT') then");
    // The exact set, not each name somewhere in the file: INSERT, UPDATE and
    // DELETE also appear in the service_role check, and DELETE has no
    // column-level check behind it.
    expect(quotedArray(DENIED_DECLARATION)).toEqual(DENIED);
    // The declaration is the only place the list is set, apart from MAINTAIN
    // being appended on versions that have it.
    expect(matches(/\bv_denied\s*:=/gi)).toBe(1);
    expect(matches(/\binto\s+v_denied\b/gi)).toBe(0);
    expect(occurrences("v_denied := array_append(v_denied, 'MAINTAIN');")).toBe(1);
    expect(sql).toContain("current_setting('server_version_num')::integer >= 170000");
  });

  it("checks PUBLIC, RLS and service_role", () => {
    expect(sql).toContain("and a.grantee = 0");
    expect(sql).toContain("select c.relrowsecurity into v_rls");
    expect(sql).toContain("where not has_table_privilege('service_role', v_table, p.privilege);");
    // The exact set the service_role check walks: a name dropped from it is
    // no longer checked, and a name added is one this file must not require.
    expect(quotedArray(SERVICE_ROLE_ARRAY)).toEqual(SERVICE_ROLE_REQUIRED);
  });

  it("checks the remaining policy by property, not by name", () => {
    expect(sql).toContain("count(*) filter (where p.polcmd <> 'r')");
    expect(sql).toContain("if v_policy_count <> 1 or v_non_select <> 0 then");
    expect(sql).not.toContain("select_own");
    expect(matches(/view\s+their\s+own\s+survey/gi)).toBe(0);
  });

  it("fails every check with an uncaught exception, so a failed check rolls the file back", () => {
    // One per `if <condition> then raise exception` check in the DO block.
    // Change it together with the block.
    const CHECKS_IN_DO_BLOCK = 7;
    // Each check's `then` is followed directly by its raise: a raise that is
    // removed, downgraded or moved away from its check lowers this count.
    expect(matches(/\bthen\s+raise\s+exception\b/gi)).toBe(CHECKS_IN_DO_BLOCK);
    expect(matches(/\braise\s+exception\b/gi)).toBe(CHECKS_IN_DO_BLOCK);
    // A raise at any other level only reports and lets the file commit.
    expect(matches(/\braise\s+(notice|warning|info|log|debug)\b/gi)).toBe(0);
    expect(matches(/\braise\b/gi)).toBe(CHECKS_IN_DO_BLOCK);
    // An exception handler in the DO block would catch the raise and let the
    // file commit.
    expect(matches(/\bexception\s+when\b/gi)).toBe(0);
  });

  it("runs in one transaction with a lock timeout", () => {
    const trimmed = sql.trim();
    expect(trimmed.startsWith("begin;")).toBe(true);
    expect(trimmed.endsWith("commit;")).toBe(true);
    expect(occurrences("set local lock_timeout = '5s';")).toBe(1);
  });
});
