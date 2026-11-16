import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that adds the status column to public.users,
 * points public.users.id at auth.users with on delete cascade, and turns
 * plaid_connections.user_id into a uuid that references public.users with on
 * delete restrict. It cannot run the SQL. It holds the statements and their
 * order, the property checks of both DO blocks, the rule that every failed
 * check rolls the file back, and the reversal written in the header. Whether
 * the file is applied, and whether its DO blocks passed, is live state that
 * only the database can answer.
 *
 * SQL line comments are stripped from `sql`, so the header (which quotes the
 * reversing statements) cannot stand in for a statement or trip a negative
 * check. The reversal itself is read from `raw`.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261107130000_add_integrity_constraints_users_plaid_connections.sql"
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

/** The two DO blocks, in file order. */
function doBlocks(): { start: number; end: number; body: string }[] {
  const blocks: { start: number; end: number; body: string }[] = [];
  let from = 0;
  for (;;) {
    const start = sql.indexOf(DO_START, from);
    if (start === -1) break;
    const end = sql.indexOf(DO_END, start);
    if (end === -1) throw new Error("unterminated DO block");
    blocks.push({ start, end, body: sql.slice(start, end) });
    from = end + DO_END.length;
  }
  return blocks;
}

const CANONICAL_CHECK =
  "where p.user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';";

const STATUS =
  "alter table public.users\n" +
  "  add column status text not null default 'active',\n" +
  "  add constraint users_status_check check (status in ('active', 'suspended'));";

const USERS_FK =
  "alter table public.users\n" +
  "  add constraint users_id_fkey\n" +
  "  foreign key (id) references auth.users(id) on delete cascade;";

const TYPE_CHANGE =
  "alter table public.plaid_connections\n" +
  "  alter column user_id type uuid using user_id::uuid;";

const PLAID_FK =
  "alter table public.plaid_connections\n" +
  "  add constraint plaid_connections_user_id_fkey\n" +
  "  foreign key (user_id) references public.users(id) on delete restrict;";

describe("users / plaid_connections integrity migration", () => {
  it("has exactly two DO blocks, one before every alter and one after", () => {
    const blocks = doBlocks();
    expect(blocks).toHaveLength(2);
    const firstAlter = sql.search(/\balter\s+table\b/i);
    const lastAlter = sql.lastIndexOf(PLAID_FK);
    expect(firstAlter).toBeGreaterThan(-1);
    expect(blocks[0].end).toBeLessThan(firstAlter);
    expect(blocks[1].start).toBeGreaterThan(lastAlter);
  });

  it("refuses before any change unless every row already fits the new constraints", () => {
    const pre = doBlocks()[0].body;
    // Lower-case canonical only: uuid::text returns that form, and the
    // encrypted tokens are bound to the user id as text.
    expect(pre.split(CANONICAL_CHECK).length - 1).toBe(1);
    expect(pre).toContain("where u.id::text = p.user_id");
    expect(pre).toContain("select 1 from auth.users a where a.id = u.id");
    expect(pre.match(/<>\s*0\s+then\s+raise\s+exception\b/gi) || []).toHaveLength(3);
  });

  it("adds status as not null, default active, limited to active and suspended", () => {
    expect(occurrences(STATUS)).toBe(1);
  });

  it("points public.users.id at auth.users with on delete cascade", () => {
    expect(occurrences(USERS_FK)).toBe(1);
  });

  it("makes user_id a uuid, then points it at public.users with on delete restrict", () => {
    expect(occurrences(TYPE_CHANGE)).toBe(1);
    expect(occurrences(PLAID_FK)).toBe(1);
    expect(sql.indexOf(TYPE_CHANGE)).toBeLessThan(sql.indexOf(PLAID_FK));
    // A cascade on plaid_connections would delete token rows whose Items were
    // never revoked; the only cascade is the one from auth.users. Counted
    // outside the DO blocks, whose messages quote both actions.
    let statements = sql;
    for (const block of doBlocks().reverse()) {
      statements = statements.slice(0, block.start) + statements.slice(block.end);
    }
    expect((statements.match(/\bon\s+delete\s+cascade\b/gi) || []).length).toBe(1);
    expect((statements.match(/\bon\s+delete\s+restrict\b/gi) || []).length).toBe(1);
  });

  it("checks the end state by property, not by constraint name", () => {
    const post = doBlocks()[1].body;
    expect(post).toContain("and k.confrelid = 'auth.users'::regclass\n       and k.confdeltype = 'c'");
    expect(post).toContain("and k.confrelid = v_users\n       and k.confdeltype = 'r'");
    expect(post).toContain("and a.atttypid = 'uuid'::regtype");
    expect(post).toContain("and a.attnotnull");
    expect(post).toContain("pg_get_expr(d.adbin, d.adrelid) = '''active''::text'");
    expect(post).toContain(
      "= 'CHECK ((status = ANY (ARRAY[''active''::text, ''suspended''::text])))'"
    );
    expect(post).not.toMatch(/\bconname\b/i);
    for (const name of ["users_id_fkey", "plaid_connections_user_id_fkey", "users_status_check"]) {
      expect(post).not.toContain(name);
    }
  });

  it("checks that the owner of public.users can run the cascade from auth.users", () => {
    const post = doBlocks()[1].body;
    expect(post).toContain("has_table_privilege(c.relowner, v_users, 'DELETE')");
  });

  it("checks client roles hold no write on public.users, table or column", () => {
    const post = doBlocks()[1].body;
    expect(post).toContain("cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as p(privilege)\n   where has_table_privilege(r.role_name, v_users, p.privilege);");
    expect(post).toContain("and has_column_privilege(r.role_name, v_users, a.attname, p.privilege);");
  });

  it("checks plaid_connections keeps no policy and no client table privilege", () => {
    const post = doBlocks()[1].body;
    expect(post).toContain("select count(*) into v_policies from pg_policy where polrelid = v_plaid;");
    expect(post).toContain("where has_table_privilege(r.role_name, v_plaid, p.privilege);");
    expect(post).toContain("v_plaid_privileges := array_append(v_plaid_privileges, 'MAINTAIN');");
  });

  it("fails every check with an uncaught exception, so a failed check rolls the file back", () => {
    // Three checks in the first DO block and eleven in the second. Change it
    // together with the blocks.
    const CHECKS = 14;
    expect(matches(/\bthen\s+raise\s+exception\b/gi)).toBe(CHECKS);
    expect(matches(/\braise\s+exception\b/gi)).toBe(CHECKS);
    expect(matches(/\braise\s+(notice|warning|info|log|debug)\b/gi)).toBe(0);
    expect(matches(/\braise\b/gi)).toBe(CHECKS);
    expect(matches(/\bexception\s+when\b/gi)).toBe(0);
  });

  it("writes no row", () => {
    expect(matches(/\bdelete\s+from\b/gi)).toBe(0);
    expect(matches(/\binsert\s+into\b/gi)).toBe(0);
    expect(matches(/\bupdate\s+[a-z_."]+\s+set\b/gi)).toBe(0);
    expect(matches(/\btruncate\s+(table\s+)?[a-z_"]/gi)).toBe(0);
  });

  it("runs in one transaction with a lock timeout", () => {
    const trimmed = sql.trim();
    expect(trimmed.startsWith("begin;")).toBe(true);
    expect(trimmed.endsWith("commit;")).toBe(true);
    expect(occurrences("set local lock_timeout = '5s';")).toBe(1);
  });

  it("locks plaid_connections once, after the lock timeout and before the first DO block reads it", () => {
    // Without the lock, a row inserted between the check and the type change
    // is converted unchecked, and an upper-case id comes back lower-case: its
    // token stops decrypting with no error anywhere.
    const LOCK = "lock table public.plaid_connections in access exclusive mode;";
    expect(occurrences(LOCK)).toBe(1);
    expect(matches(/\block\s+table\b/gi)).toBe(1);
    expect(sql.indexOf(LOCK)).toBeGreaterThan(sql.indexOf("set local lock_timeout = '5s';"));
    expect(sql.indexOf(LOCK)).toBeLessThan(doBlocks()[0].start);
  });

  it("carries the reversal in its header, dropping the restrict key before the type goes back", () => {
    const reverse = [
      "--   alter table public.plaid_connections drop constraint plaid_connections_user_id_fkey;",
      "--   alter table public.users drop constraint users_id_fkey;",
      "--   alter table public.plaid_connections alter column user_id type text using user_id::text;",
      "--   alter table public.users drop constraint users_status_check;",
      "--   alter table public.users drop column status;",
    ];
    for (const line of reverse) {
      expect(raw.split(line).length - 1).toBe(1);
    }
    expect(raw.indexOf(reverse[0])).toBeLessThan(raw.indexOf(reverse[2]));
  });
});
