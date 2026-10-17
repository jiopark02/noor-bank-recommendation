import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that leaves client roles read-only on the
 * chat memory tables. It cannot run the SQL; it holds the lines whose loss
 * would reopen a client write path, or give anon access, on chat_sessions,
 * chat_messages, chat_summaries or user_facts. Whether the file is applied,
 * and whether its DO block passed, is live state that only the database can
 * answer.
 *
 * SQL line comments are stripped first, so a sentence in the header (which
 * quotes the reversing grants) cannot stand in for a statement or trip a
 * negative check.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261017120000_restrict_client_writes_on_chat_tables.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

const TABLES = ["chat_sessions", "chat_messages", "chat_summaries", "user_facts"];

const REVOKE =
  "revoke all on table public.chat_sessions, public.chat_messages, public.chat_summaries, public.user_facts from public, anon, authenticated;";
const GRANT =
  "grant select on table public.chat_sessions, public.chat_messages, public.chat_summaries, public.user_facts to authenticated;";

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

function matches(pattern: RegExp): number {
  return (sql.match(pattern) || []).length;
}

describe("chat memory tables: client write migration", () => {
  it("drops the insert, update and delete policy of every table", () => {
    for (const table of TABLES) {
      for (const op of ["insert", "update", "delete"]) {
        expect(occurrences(`drop policy if exists ${table}_${op}_own on public.${table};`)).toBe(1);
      }
    }
  });

  it("keeps every select policy and creates none", () => {
    for (const table of TABLES) {
      expect(sql).not.toContain(`${table}_select_own on`);
    }
    expect(sql.toLowerCase()).not.toContain("create policy");
  });

  it("revokes everything from PUBLIC, anon and authenticated, then grants SELECT to authenticated only", () => {
    expect(occurrences(REVOKE)).toBe(1);
    expect(occurrences(GRANT)).toBe(1);
    expect(sql.indexOf(GRANT)).toBeGreaterThan(sql.indexOf(REVOKE));
    expect(matches(/\bgrant\b/g)).toBe(1);
    expect(matches(/\bgrant\b[^;]*\banon\b/g)).toBe(0);
  });

  it("names service_role in no revoke or grant", () => {
    expect(matches(/\b(revoke|grant)\b[^;]*service_role/g)).toBe(0);
  });

  it("checks anon holds nothing, SELECT and column privileges included", () => {
    expect(sql).toContain("v_all := array_prepend('SELECT', v_denied);");
    expect(sql).toContain("from unnest(v_all) as p(privilege)\n     where has_table_privilege('anon', v_table, p.privilege);");
    expect(sql).toContain("has_any_column_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,REFERENCES')");
  });

  it("checks authenticated holds SELECT and no write privilege, table or column", () => {
    expect(sql).toContain("from unnest(v_denied) as p(privilege)\n     where has_table_privilege('authenticated', v_table, p.privilege);");
    expect(sql).toContain("has_any_column_privilege('authenticated', v_table, 'INSERT,UPDATE,REFERENCES')");
    expect(sql).toContain("if not has_table_privilege('authenticated', v_table, 'SELECT') then");
    expect(sql).toContain("'MAINTAIN'");
  });

  it("checks PUBLIC, RLS, the remaining policy and service_role", () => {
    expect(sql).toContain("and a.grantee = 0");
    expect(sql).toContain("select c.relrowsecurity into v_rls");
    expect(sql).toContain("format('%s_select_own/r', v_name)");
    expect(sql).toContain("where not has_table_privilege('service_role', v_table, p.privilege);");
  });

  it("runs in one transaction", () => {
    const trimmed = sql.trim();
    expect(trimmed.startsWith("begin;")).toBe(true);
    expect(trimmed.endsWith("commit;")).toBe(true);
  });
});
