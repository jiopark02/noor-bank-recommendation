import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the household share grants migration. It cannot run the
 * SQL; it holds the lines whose loss would let service_role update a grant,
 * leave a grant behind when its owner leaves the household or disconnects
 * the bank, let the share function decide before it holds the household
 * lock, or change what household_leave already did. Whether the file is
 * applied, whether its DO block passed, and how the functions behave under
 * concurrency are database behaviour, checked by running the file against a
 * database, not here.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   a grant of update (table or column) on either table added      -> S1
 *   a revoke from service_role or from client roles removed         -> S1
 *   an enable row level security line removed, or a policy added    -> S1
 *   on delete cascade removed from any foreign key                  -> S2
 *   the composite key's columns changed or reordered                -> S2
 *   the household lock taken before the user lock in either function -> S3
 *   a write in the share function moved before the household lock   -> S3
 *   the re-read under the household lock removed                    -> S3
 *   the connection lookup without the caller's user id              -> S4
 *   the stale-grantee delete removed                                -> S4
 *   the answer insert removed                                       -> S4
 *   the foreign_key_violation handler removed                       -> S4
 *   either delete removed from household_leave                      -> S5, S6
 *   a delete in leave widened to the whole household, or its
 *     owner or grantee condition dropped                            -> S5, S6
 *   any other line of household_leave changed (owner promotion,
 *     successor order, invite delete, a lock, an answer)            -> S6
 *   a function changed to security definer                          -> S7
 *   a set search_path line removed, or an EXECUTE revoke or grant   -> S7
 *   a trigger added                                                 -> S7
 *   a DO block check or its raise removed                           -> S8
 *   the precondition that share_grants is empty removed             -> S9
 */

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");

function readSql(file: string): string {
  return readFileSync(path.join(MIGRATIONS, file), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/--[^\n]*/g, "");
}

const sql = readSql("20261121120000_household_share_grants.sql");
const invitesSql = readSql("20261120120000_household_invites_and_membership_changes.sql");

const TABLES = ["share_grants", "share_prompt_answers"];

const FUNCTIONS: Record<string, string> = {
  household_share_set: "uuid, text, boolean",
  household_leave: "uuid",
};

const USER_LOCK =
  "pg_catalog.hashtextextended('household:' || p_user_id::text, 0)";
const HOUSEHOLD_LOCK = "pg_catalog.hashtextextended('household_group:' ||";

// Only the rows the person leaving gave or received in that household.
const LEAVE_GRANT_DELETE =
  "\n  delete from public.share_grants g\n   where g.household_id = v_household\n     and (g.owner_user_id = p_user_id or g.grantee_user_id = p_user_id);\n";
const LEAVE_ANSWER_DELETE =
  "\n  delete from public.share_prompt_answers a\n   where a.household_id = v_household\n     and (a.owner_user_id = p_user_id or a.grantee_user_id = p_user_id);\n";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A function body in the given text, between its dollar quotes. */
function functionBodyIn(text: string, name: string): string {
  const start = text.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const open = text.indexOf("as $$", start);
  const close = text.indexOf("$$;", open + 5);
  expect(open, name).toBeGreaterThan(start);
  expect(close, name).toBeGreaterThan(open);
  return text.slice(open + 5, close);
}

function functionBody(name: string): string {
  return functionBodyIn(sql, name);
}

function functionHeader(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("as $$", start));
}

/** The closing DO block: the last one in the file. */
function closingDoBlock(): string {
  const start = sql.lastIndexOf("\ndo $$");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start + 6);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

function at(body: string, needle: string, label: string): number {
  const i = body.indexOf(needle);
  expect(i, `${label}: ${needle}`).toBeGreaterThan(-1);
  return i;
}

describe("household share grants migration", () => {
  it("S1 both tables: closed to client roles, service_role holds exactly select, insert and delete, RLS on, no policy", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql.match(/\bcreate table\b/gi)?.length).toBe(1);
    expect(occurrences(sql, "create table if not exists public.share_prompt_answers (")).toBe(1);
    for (const table of TABLES) {
      const clients = sql.indexOf(
        `revoke all on table public.${table} from public, anon, authenticated;`
      );
      const service = sql.indexOf(`revoke all on table public.${table} from service_role;`);
      const grant = sql.indexOf(
        `grant select, insert, delete on table public.${table} to service_role;`
      );
      const rls = sql.indexOf(`alter table public.${table} enable row level security;`);
      expect(clients, table).toBeGreaterThan(-1);
      expect(service, table).toBeGreaterThan(clients);
      expect(grant, table).toBeGreaterThan(service);
      expect(rls, table).toBeGreaterThan(-1);
    }
    expect(sql.toLowerCase()).not.toContain("create policy");
    const tableGrants = sql.match(/\bgrant\s+[^;]*\bon table\b[^;]*;/gi) ?? [];
    expect(tableGrants).toEqual([
      "grant select, insert, delete on table public.share_grants to service_role;",
      "grant select, insert, delete on table public.share_prompt_answers to service_role;",
    ]);
    expect(sql).not.toMatch(/\bgrant\s+[^;]*\bupdate\b/i);
    expect(sql).not.toMatch(/\bto\s+(anon|authenticated|public)\b/i);
  });

  it("S2 every foreign key cascades on delete, and a grant names a connection of its own owner", () => {
    const fks = sql.match(/\breferences\s+public\.[a-z_]+\s*\([^)]*\)[^,;\n]*/gi) ?? [];
    expect(fks.length).toBe(6);
    for (const fk of fks) {
      expect(fk, fk).toMatch(/\bon delete cascade$/);
    }
    for (const table of TABLES) {
      const prefix = table === "share_grants" ? "share_grants" : "share_prompt_answers";
      expect(sql, table).toMatch(
        new RegExp(
          `constraint ${prefix}_connection_fkey\\s+foreign key \\(owner_user_id, resource_id\\)\\s+references public\\.plaid_connections \\(user_id, id\\) on delete cascade`
        )
      );
    }
    expect(sql).toContain(
      "foreign key (grantee_user_id) references public.users(id) on delete cascade;"
    );
    expect(sql).toContain(
      "create unique index if not exists plaid_connections_user_id_id_key\n  on public.plaid_connections (user_id, id);"
    );
    expect(sql).toContain("add column if not exists grantee_user_id uuid not null;");
    expect(occurrences(sql, "check (grantee_user_id <> owner_user_id)")).toBe(2);
    expect(sql).toContain(
      "constraint share_prompt_answers_pkey primary key (resource_id, grantee_user_id)"
    );
  });

  it("S3 both functions take the user lock, then the household lock, and the share function writes only after it", () => {
    for (const name of Object.keys(FUNCTIONS)) {
      const body = functionBody(name);
      expect(occurrences(body, USER_LOCK), name).toBe(1);
      expect(occurrences(body, HOUSEHOLD_LOCK), name).toBe(1);
      expect(at(body, HOUSEHOLD_LOCK, name)).toBeGreaterThan(at(body, USER_LOCK, name));
    }
    const body = functionBody("household_share_set");
    const lock = at(body, HOUSEHOLD_LOCK, "share");
    const reread = at(body, "into v_reread", "share");
    expect(reread).toBeGreaterThan(lock);
    expect(body).toContain("if v_reread is distinct from v_household then\n    return 'none';");
    for (const read of ["into v_others", "into v_partner", "into v_connection"]) {
      expect(at(body, read, "share"), read).toBeGreaterThan(reread);
    }
    const writes = body.match(/\b(insert into|delete from) public\.[a-z_]+/g) ?? [];
    expect(writes.length).toBe(4);
    let from = 0;
    for (const w of writes) {
      const i = body.indexOf(w, from);
      expect(i, w).toBeGreaterThan(lock);
      from = i + 1;
    }
  });

  it("S4 the share function finds the connection by the caller's id, clears stale grantees, records the answer and refuses on a vanished row", () => {
    const body = functionBody("household_share_set");
    expect(body).toContain(
      "from public.plaid_connections c\n   where c.user_id = p_user_id\n     and c.item_id = p_item_id;"
    );
    expect(body).toContain("if v_others <> 1 then\n    return 'solo';");
    const inner = body.slice(body.indexOf("  begin\n"), body.indexOf("  exception\n"));
    const stale = at(
      inner,
      "delete from public.share_grants g\n     where g.owner_user_id = p_user_id\n       and g.resource_id = v_connection\n       and g.grantee_user_id <> v_partner;",
      "share"
    );
    const answer = at(inner, "insert into public.share_prompt_answers", "share");
    const grant = at(inner, "insert into public.share_grants", "share");
    const unshare = inner.lastIndexOf("delete from public.share_grants g");
    expect(answer).toBeGreaterThan(stale);
    expect(grant).toBeGreaterThan(answer);
    expect(unshare).toBeGreaterThan(grant);
    expect(inner).toContain("values (p_user_id, v_partner, v_household, v_connection)");
    expect(inner).toContain(
      "values (p_user_id, v_partner, v_household, 'plaid_connection', v_connection, 'view')"
    );
    expect(inner).toContain("on conflict (resource_id, grantee_user_id) do nothing;");
    expect(body).toMatch(
      /exception\n\s+when foreign_key_violation then\n(\s+--[^\n]*\n)*\s+return 'refused';\n\s+end;\n\n\s+return 'unshared';/
    );
    const answers = (body.match(/return '([a-z_]+)'/g) ?? []).map((r) => r.slice(8, -1));
    expect(new Set(answers)).toEqual(
      new Set(["none", "solo", "no_connection", "refused", "shared", "unshared"])
    );
  });

  it("S5 household_leave deletes the grants and answers the person leaving gave or received there, after it ends the membership", () => {
    const body = functionBody("household_leave");
    const left = at(body, "set status = 'left'", "leave");
    const grants = at(body, LEAVE_GRANT_DELETE, "leave");
    const answers = at(body, LEAVE_ANSWER_DELETE, "leave");
    expect(grants).toBeGreaterThan(left);
    expect(answers).toBeGreaterThan(left);
    expect(at(body, "return 'left';", "leave")).toBeGreaterThan(Math.max(grants, answers));
    expect(at(body, HOUSEHOLD_LOCK, "leave")).toBeLessThan(Math.min(grants, answers));
  });

  it("S6 household_leave is the previous body plus the two deletes and nothing else", () => {
    // The previous body is the one 20261120120000 defines; its probe holds
    // the lock order, the owner promotion, the successor order, the
    // promotion-before-left order and the invite deletes. Equality keeps
    // every one of them here.
    const previous = functionBodyIn(invitesSql, "household_leave");
    const current = functionBody("household_leave");
    expect(occurrences(current, LEAVE_GRANT_DELETE)).toBe(1);
    expect(occurrences(current, LEAVE_ANSWER_DELETE)).toBe(1);
    const stripped = current.replace(LEAVE_GRANT_DELETE, "").replace(LEAVE_ANSWER_DELETE, "");
    expect(stripped).toBe(previous);
    const header = functionHeader("household_leave");
    expect(header).toBe(
      "create or replace function public.household_leave(p_user_id uuid)\nreturns text\nlanguage plpgsql\nvolatile\nsecurity invoker\nset search_path = ''\n"
    );
  });

  it("S7 both functions are SECURITY INVOKER with an empty search_path, only service_role executes them, and no trigger is added", () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).not.toMatch(/\bcreate\s+(or\s+replace\s+)?trigger\b/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|function|trigger|index|type)\b/i);
    expect(sql.match(/create or replace function/gi)?.length).toBe(
      Object.keys(FUNCTIONS).length
    );
    for (const [name, args] of Object.entries(FUNCTIONS)) {
      const header = functionHeader(name);
      expect(header, name).toMatch(/\n\s*security invoker\n/);
      expect(header, name).toContain("set search_path = ''");
      expect(sql, name).toContain(
        `revoke all on function public.${name}(${args})\n  from public, anon, authenticated;`
      );
      expect(sql, name).toContain(
        `grant execute on function public.${name}(${args}) to service_role;`
      );
    }
    expect((sql.match(/\bgrant\s+execute\b[^;]*;/gi) ?? []).length).toBe(
      Object.keys(FUNCTIONS).length
    );
  });

  it("S8 the closing DO block checks every property and raises on each", () => {
    const block = closingDoBlock();
    const checks: Array<[string, RegExp]> = [
      ["client privileges", /has_any_column_privilege\(r\.role_name, v_table[\s\S]*?raise exception '%: client roles still hold privileges/],
      ["PUBLIC table privilege", /a\.grantee = 0\n\s+\) then\n\s+raise exception '%: PUBLIC still holds a table privilege'/],
      ["RLS", /relrowsecurity[\s\S]*?raise exception '%: row level security is not enabled'/],
      ["policies", /from pg_policy where polrelid = v_table;\n\s+if v_policies <> 0 then\n\s+raise exception/],
      ["service_role exact", /array\['SELECT', 'INSERT', 'DELETE'\]\)\)\n\s+<> has_table_privilege\('service_role', v_table, p\.privilege\);[\s\S]*?raise exception '%: service_role privileges differ/],
      ["service_role column UPDATE", /has_any_column_privilege\('service_role', v_table, 'UPDATE,REFERENCES'\) then\n\s+raise exception/],
      ["owner DELETE", /has_table_privilege\(c\.relowner, v_table, 'DELETE'\)[\s\S]*?raise exception '%: the table owner lacks DELETE'/],
      ["no trigger on the tables", /raise exception '%: carries a trigger'/],
      ["foreign keys", /k\.confdeltype = 'c'[\s\S]*?\) into v_ok;\n\s+if not v_ok then\n\s+raise exception 'public\.%: % does not reference/],
      ["grantee not null", /a\.attnotnull[\s\S]*?raise exception '%: grantee_user_id is missing or nullable'/],
      ["grantee check", /'CHECK \(\(grantee_user_id <> owner_user_id\)\)'[\s\S]*?raise exception/],
      ["user_id, id index", /= array\['user_id', 'id'\][\s\S]*?raise exception 'public\.plaid_connections: no unique index on \(user_id, id\)'/],
      ["open grant index", /= '\(revoked_at IS NULL\)'[\s\S]*?raise exception 'public\.share_grants: share_grants_one_open_grant/],
      ["leave deletes", /strpos\(v_prosrc, 'delete from public\.share_grants g'\) = 0\n\s+or strpos\(v_prosrc, 'delete from public\.share_prompt_answers a'\) = 0 then\n\s+raise exception/],
      ["function client EXECUTE", /raise exception '%: anon or authenticated still holds EXECUTE'/],
      ["function PUBLIC EXECUTE", /v_proacl is null\n\s+or exists \(select 1 from aclexplode\(v_proacl\) a where a\.grantee = 0\) then\n\s+raise exception/],
      ["function invoker", /if v_prosecdef then\n\s+raise exception '%: expected SECURITY INVOKER'/],
      ["function search_path", /'search_path=""' = any\(v_proconfig\)\) then\n\s+raise exception/],
      ["function service_role EXECUTE", /raise exception '%: service_role lacks EXECUTE'/],
      ["only the cleanup trigger", /t\.tgname = 'trg_household_members_cleanup'[\s\S]*?raise exception 'public\.household_members: expected only the cleanup trigger/],
      ["user_id uuid", /raise exception 'public\.plaid_connections\.user_id is not a uuid';/],
      ["MAINTAIN guard", /server_version_num'\)::integer >= 170000 then\n\s+v_privileges := v_privileges \|\| 'MAINTAIN'::text;/],
    ];
    for (const [label, pattern] of checks) {
      expect(block, label).toMatch(pattern);
    }
    for (const [name, args] of Object.entries(FUNCTIONS)) {
      expect(block, name).toContain(`'public.${name}(${args})'::regprocedure`);
    }
    const fkRows = block.match(/\('share_(grants|prompt_answers)',\s+array\[[^\]]*\],\s+'public\.[a-z_]+',\s+array\[[^\]]*\]\)/g) ?? [];
    expect(fkRows.length).toBe(8);
    expect(sql.lastIndexOf("\ndo $$")).toBeLessThan(sql.lastIndexOf("commit;"));
    expect(occurrences(sql, "\ndo $$")).toBe(2);
  });

  it("S9 the file locks both tables and checks its preconditions before it changes anything", () => {
    const lockGrants = at(sql, "lock table public.share_grants in access exclusive mode;", "locks");
    const lockConnections = at(
      sql,
      "lock table public.plaid_connections in share row exclusive mode;",
      "locks"
    );
    const pre = sql.indexOf("\ndo $$");
    const firstChange = sql.search(/\n(alter table|create (unique )?index|create table)\b/);
    expect(lockGrants).toBeLessThan(pre);
    expect(lockConnections).toBeLessThan(pre);
    expect(pre).toBeLessThan(firstChange);
    const block = sql.slice(pre, sql.indexOf("\n$$;", pre));
    expect(block).toMatch(/is distinct from 'uuid' then\n\s+raise exception/);
    expect(block).toMatch(
      /and a\.attname = 'grantee_user_id'[\s\S]*?\) and exists \(select 1 from public\.share_grants\) then\n\s+raise exception/
    );
  });
});
