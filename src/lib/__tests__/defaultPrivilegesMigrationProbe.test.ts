import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that closes the default privileges postgres
 * gives client roles in schema public. It cannot run the SQL; it holds the
 * statements whose loss would leave new objects open to anon, authenticated
 * or PUBLIC, holds that service_role and supabase_admin are named in no
 * statement, and holds that the DO block checks the end state by property and
 * by creating test objects, drops them, and fails every check by raising an
 * exception that nothing catches. Whether the file is applied, and whether
 * its DO block passed, is live state that only the database can answer.
 *
 * SQL line comments are stripped first, so a sentence in the header (which
 * quotes the reversing grants) cannot stand in for a statement or trip a
 * negative check. The reversing grants are read from the raw file.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261107140000_close_default_privileges_for_client_roles.sql"
);

const raw = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/--[^\n]*/g, "");

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

function matches(pattern: RegExp): number {
  return (sql.match(pattern) || []).length;
}

const REVOKE_TABLES =
  "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;";
const REVOKE_SEQUENCES =
  "alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;";
const REVOKE_FUNCTIONS =
  "alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;";
const REVOKE_PUBLIC_EXECUTE =
  "alter default privileges for role postgres revoke execute on functions from public;";

const REVERSE = [
  "--   alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;",
  "--   alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;",
  "--   alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;",
  "--   alter default privileges for role postgres grant execute on functions to public;",
];

// The DO block body: from `do $$` to the `$$;` that closes it. The inner
// function body uses `$probe$`, which neither marker matches.
const DO_START = sql.indexOf("do $$");
const DO_END = sql.indexOf("\n$$;", DO_START);

describe("default privileges: client role migration", () => {
  it("revokes table privileges from both client roles in public", () => {
    expect(occurrences(REVOKE_TABLES)).toBe(1);
  });

  it("revokes sequence privileges from both client roles in public", () => {
    expect(occurrences(REVOKE_SEQUENCES)).toBe(1);
  });

  it("revokes function EXECUTE from both client roles in public", () => {
    expect(occurrences(REVOKE_FUNCTIONS)).toBe(1);
  });

  it("revokes function EXECUTE from PUBLIC globally, not only in public", () => {
    expect(occurrences(REVOKE_PUBLIC_EXECUTE)).toBe(1);
    // Exactly the four statements above, and every one before the check.
    expect(matches(/\balter\s+default\s+privileges\b/gi)).toBe(4);
    for (const statement of [REVOKE_TABLES, REVOKE_SEQUENCES, REVOKE_FUNCTIONS, REVOKE_PUBLIC_EXECUTE]) {
      expect(sql.indexOf(statement)).toBeLessThan(DO_START);
    }
  });

  it("names service_role and supabase_admin in no revoke or grant, and alters only postgres", () => {
    expect(matches(/\b(revoke|grant)\b[^;]*(service_role|supabase_admin)/gi)).toBe(0);
    expect(matches(/\bgrant\b/gi)).toBe(0);
    expect(matches(/\bfor\s+role\s+(\w+)/gi)).toBe(matches(/\bfor\s+role\s+postgres\b/gi));
  });

  it("checks the postgres entries by property: no client role in public, no PUBLIC EXECUTE globally", () => {
    expect(sql).toContain("lateral aclexplode(d.defaclacl) a");
    expect(sql).toContain("and d.defaclnamespace = 'public'::regnamespace");
    expect(sql).toContain("and d.defaclobjtype in ('r', 'S', 'f')");
    expect(sql).toContain("and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid);");
    expect(sql).toContain("and d.defaclnamespace = 0");
    expect(sql).toContain("and d.defaclobjtype = 'f';\n  if not found then");
    expect(sql).toContain("from aclexplode(v_acl) a\n     where a.grantee = 0\n       and a.privilege_type = 'EXECUTE'");
  });

  it("creates test objects and checks the privileges they were given, with service_role as the positive control", () => {
    expect(sql).toContain("create table public.default_privileges_probe (id bigserial primary key);");
    expect(sql).toContain("create function public.default_privileges_probe_fn() returns integer");
    expect(sql).toContain("if v_seq is null then");
    expect(sql).toContain("foreach v_role in array array['anon', 'authenticated'] loop");
    expect(sql).toContain("where has_table_privilege(v_role, v_table, p.privilege);");
    expect(sql).toContain("where has_sequence_privilege(v_role, v_seq, p.privilege);");
    expect(sql).toContain("if has_function_privilege(v_role, v_fn, 'EXECUTE') then");
    expect(sql).toContain("lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a");
    expect(sql).toContain("where not has_table_privilege('service_role', v_table, p.privilege);");
    expect(sql).toContain("if not has_sequence_privilege('service_role', v_seq, 'USAGE') then");
    expect(sql).toContain("if not has_function_privilege('service_role', v_fn, 'EXECUTE') then");
    expect(occurrences("v_denied := array_append(v_denied, 'MAINTAIN');")).toBe(1);
    expect(sql).toContain("current_setting('server_version_num')::integer >= 170000");
  });

  it("refuses to run as any role other than postgres, before anything else in the block", () => {
    const guard = sql.indexOf("if current_user <> 'postgres' then");
    expect(guard).toBeGreaterThan(DO_START);
    expect(guard).toBeLessThan(sql.indexOf("create table"));
    expect(guard).toBeLessThan(sql.indexOf("from pg_default_acl"));
  });

  it("drops both test objects after the last check", () => {
    const dropFn = sql.indexOf("drop function public.default_privileges_probe_fn();");
    const dropTable = sql.indexOf("drop table public.default_privileges_probe;");
    expect(dropFn).toBeGreaterThan(-1);
    expect(dropTable).toBeGreaterThan(-1);
    const lastRaise = sql.lastIndexOf("raise exception");
    expect(dropFn).toBeGreaterThan(lastRaise);
    expect(dropTable).toBeGreaterThan(lastRaise);
  });

  it("fails every check with an uncaught exception, so a failed check rolls the file back", () => {
    // One per `if <condition> then raise exception` check in the DO block.
    // Change it together with the block.
    const CHECKS_IN_DO_BLOCK = 12;
    expect(matches(/\bthen\s+raise\s+exception\b/gi)).toBe(CHECKS_IN_DO_BLOCK);
    expect(matches(/\braise\s+exception\b/gi)).toBe(CHECKS_IN_DO_BLOCK);
    expect(matches(/\braise\s+(notice|warning|info|log|debug)\b/gi)).toBe(0);
    expect(matches(/\braise\b/gi)).toBe(CHECKS_IN_DO_BLOCK);
    expect(matches(/\bexception\s+when\b/gi)).toBe(0);
  });

  it("changes no rows, and creates and drops objects only inside the DO block", () => {
    expect(
      matches(/\b(insert\s+into|update\s+[\w."]+\s+set|delete\s+from|truncate\s+(table\b|[\w"]+\.)|merge\s+into|copy\s+[\w."]+\s+(from|to))\b/gi)
    ).toBe(0);
    expect(DO_START).toBeGreaterThan(-1);
    expect(DO_END).toBeGreaterThan(DO_START);
    expect(matches(/\bdo\s+\$\$/gi)).toBe(1);
    const ddl = /\b(create|drop|alter)\s+(or\s+replace\s+)?(table|function|procedure|sequence|view|index|trigger|type|schema|policy|role)\b/gi;
    let found: RegExpExecArray | null;
    let seen = 0;
    while ((found = ddl.exec(sql)) !== null) {
      seen += 1;
      expect(found.index).toBeGreaterThan(DO_START);
      expect(found.index).toBeLessThan(DO_END);
    }
    // The two creates and the two drops of the test objects.
    expect(seen).toBe(4);
  });

  it("runs in one transaction with a lock timeout", () => {
    const trimmed = sql.trim();
    expect(trimmed.startsWith("begin;")).toBe(true);
    expect(trimmed.endsWith("commit;")).toBe(true);
    expect(matches(/\bbegin\s*;/gi)).toBe(1);
    expect(matches(/\bcommit\s*;/gi)).toBe(1);
    expect(occurrences("set local lock_timeout = '5s';")).toBe(1);
  });

  it("states the reversing grants in the header", () => {
    for (const line of REVERSE) {
      expect(raw.split(line).length - 1).toBe(1);
    }
  });
});
