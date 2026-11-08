import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the households migration. It cannot run the SQL; it holds
 * the lines whose loss would open the new tables or functions to client
 * roles, let a users delete be refused or leave orphans, allow a second
 * active household per user, or let the closing DO block stop checking a
 * property. Whether the file is applied, and whether its DO block passed, is
 * live state that only the database can answer. Concurrency and cascade
 * order are database behaviour too, and are checked by running the file
 * against a database, not here.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   "if not exists" removed from a create table             -> H1
 *   a grant to anon or authenticated added                  -> H2
 *   a table's revoke from public, anon, authenticated removed -> H2
 *   service_role granted more than the listed privileges    -> H2
 *   an enable row level security line removed               -> H3
 *   a create policy added                                   -> H3
 *   on delete removed from a key to public.users            -> H4
 *   on delete restrict / no action on a key to public.users -> H4
 *   created_by changed from set null to cascade             -> H4
 *   the where clause of the active-membership index removed -> H5
 *   the goals owner check removed                           -> H6
 *   an amount column changed from bigint to numeric         -> H6
 *   a progress or accumulated column added to goals         -> H6
 *   a second resource_type value admitted                   -> H7
 *   ensure changed to security definer                      -> H8
 *   cleanup changed back to security invoker                -> H8
 *   a second security definer added                         -> H8
 *   a set search_path line removed                          -> H8
 *   a function's EXECUTE revoke or grant removed            -> H8
 *   service_role dropped from the cleanup function's revoke -> H8
 *   a grant on the cleanup function added                   -> H8
 *   a D-m check or its raise removed                        -> H11
 *   a public. prefix removed from the cleanup body          -> H17
 *   an insert, update or second delete added to cleanup     -> H17
 *   the cleanup delete's where clause changed               -> H17
 *   the schema prefix removed from a drop                   -> H9
 *   cascade added anywhere                                  -> H9
 *   the DO block moved after commit                         -> H10
 *   a DO block check or its raise removed                   -> H11
 *   an insert added outside the ensure function             -> H12
 *   the advisory lock removed or moved after the lookup     -> H13
 *   a second scope value admitted, or its DO check removed  -> H14
 *   a goals status value added or removed, or its DO check removed -> H15
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261108120000_create_households_and_goals.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

const TABLES = ["households", "household_members", "share_grants", "goals"];

const SERVICE_ROLE_GRANTS: Record<string, string> = {
  households: "select, insert",
  household_members: "select, insert",
  share_grants: "select",
  goals: "select",
};

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

/** The create table statement for a table, through its closing "\n);". */
function createTable(table: string): string {
  const head = `create table if not exists public.${table} (`;
  const start = sql.indexOf(head);
  expect(start, table).toBeGreaterThan(-1);
  const end = sql.indexOf("\n);", start);
  expect(end, table).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** A function body, between its opening and closing dollar quotes. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

/** A function's header, from create to its opening dollar quote. */
function functionHeader(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("as $$", start));
}

function doBlock(): string {
  const start = sql.indexOf("\ndo $$");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start + 6);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("households migration", () => {
  it("H1 creates each table once, idempotently, in the form the export test parses", () => {
    for (const table of TABLES) {
      expect(occurrences(`create table if not exists public.${table} (`), table).toBe(1);
      expect(sql, table).not.toMatch(
        new RegExp(`create table public\\.${table}\\b`)
      );
    }
    expect(sql.match(/\bcreate table\b/gi)?.length).toBe(TABLES.length);
  });

  it("H2 closes every table to client roles and grants service_role only what this stage uses", () => {
    for (const table of TABLES) {
      const clients = sql.indexOf(
        `revoke all on table public.${table} from public, anon, authenticated;`
      );
      const service = sql.indexOf(`revoke all on table public.${table} from service_role;`);
      const grant = sql.indexOf(
        `grant ${SERVICE_ROLE_GRANTS[table]} on table public.${table} to service_role;`
      );
      expect(clients, table).toBeGreaterThan(-1);
      expect(service, table).toBeGreaterThan(clients);
      expect(grant, table).toBeGreaterThan(service);
    }
    const grants = sql.match(/\bgrant\s+[^;]*;/gi) ?? [];
    expect(grants.length).toBe(TABLES.length + 1);
    for (const grant of grants) {
      expect(grant).toMatch(/to service_role;$/);
    }
  });

  it("H3 turns RLS on for every table and creates no policy", () => {
    for (const table of TABLES) {
      const revoke = sql.indexOf(`revoke all on table public.${table} from service_role;`);
      const rls = sql.indexOf(`alter table public.${table} enable row level security;`);
      expect(rls, table).toBeGreaterThan(revoke);
    }
    expect(sql.toLowerCase()).not.toContain("create policy");
  });

  it("H4 states on delete on every key to public.users, never restrict or no action", () => {
    const keys = sql.match(/references public\.users\(id\)[^,\n]*/g) ?? [];
    expect(keys.length).toBe(4);
    for (const key of keys) {
      expect(key).toMatch(/ on delete (cascade|set null)$/);
    }
    expect(sql.toLowerCase()).not.toMatch(/on delete (restrict|no action)/);
    expect(createTable("household_members")).toContain(
      "user_id       uuid not null references public.users(id) on delete cascade,"
    );
    expect(createTable("share_grants")).toContain(
      "owner_user_id  uuid not null references public.users(id) on delete cascade,"
    );
    expect(createTable("goals")).toContain(
      "owner_user_id         uuid references public.users(id) on delete cascade,"
    );
    expect(createTable("goals")).toContain(
      "created_by            uuid references public.users(id) on delete set null,"
    );
    const householdKeys = sql.match(/references public\.households\(id\)[^,\n]*/g) ?? [];
    expect(householdKeys.length).toBe(3);
    for (const key of householdKeys) {
      expect(key).toMatch(/ on delete cascade$/);
    }
  });

  it("H5 allows at most one active membership per user", () => {
    expect(sql).toContain(
      "create unique index if not exists household_members_one_active_per_user\n" +
        "  on public.household_members (user_id)\n" +
        "  where status = 'active';"
    );
  });

  it("H6 goals: exactly one owner matching the kind, integer cents, no progress columns", () => {
    const goals = createTable("goals");
    expect(goals).toContain(
      "  constraint goals_owner_matches_kind check (\n" +
        "    (kind = 'personal' and owner_user_id is not null and household_id is null)\n" +
        "    or (kind = 'joint' and household_id is not null and owner_user_id is null)\n" +
        "  )"
    );
    expect(goals).toContain(
      "target_amount_cents   bigint not null check (target_amount_cents > 0),"
    );
    expect(goals).toContain("monthly_amount_cents  bigint check (monthly_amount_cents > 0),");
    expect(goals).not.toMatch(/\bnumeric\b|\breal\b|\bdouble\b/);
    expect(goals).not.toMatch(/progress|accumulated|saved|current_amount|suggested/);
    expect(goals).not.toMatch(/monthly_amount_cents is not null or target_date is not null/);
  });

  it("H7 share_grants admits only the bank connection resource type", () => {
    expect(createTable("share_grants")).toContain(
      "resource_type  text not null check (resource_type in ('plaid_connection')),"
    );
  });

  it("H8 ensure is SECURITY INVOKER and only service_role executes it; cleanup is SECURITY DEFINER and nobody executes it; both pin an empty search_path", () => {
    for (const name of ["household_ensure_for_user", "household_delete_if_no_active_members"]) {
      expect(functionHeader(name), name).toContain("set search_path = ''");
    }
    const ensure = functionHeader("household_ensure_for_user");
    expect(ensure).toContain("security invoker");
    expect(ensure).not.toContain("security definer");
    const cleanup = functionHeader("household_delete_if_no_active_members");
    expect(cleanup).toContain("security definer");
    expect(cleanup).not.toContain("security invoker");
    // Declarations only: the DO block's raise message also names it.
    expect(sql.match(/^\s*security definer\s*$/gim)?.length).toBe(1);
    expect(sql).toMatch(
      /revoke all on function public\.household_ensure_for_user\(uuid\)\s+from public, anon, authenticated;/
    );
    expect(sql).toContain(
      "grant execute on function public.household_ensure_for_user(uuid) to service_role;"
    );
    expect(sql).toMatch(
      /revoke all on function public\.household_delete_if_no_active_members\(\)\s+from public, anon, authenticated, service_role;/
    );
    expect(sql).not.toMatch(
      /grant [^;]*household_delete_if_no_active_members/
    );
  });

  it("H9 drops the two legacy objects in the public schema only, and never cascades", () => {
    expect(occurrences("drop function if exists public.update_updated_at_column();")).toBe(1);
    expect(occurrences("drop type if exists public.account_type;")).toBe(1);
    expect(sql).not.toMatch(/drop function[^;]*storage\./i);
    expect(sql).not.toMatch(/drop function if exists update_updated_at_column/i);
    expect(sql).not.toMatch(/drop type if exists account_type/i);
    expect(sql.match(/\bdrop\s+(function|type)\b/gi)?.length).toBe(2);
    expect(sql.match(/\bdrop\s+table\b/gi)).toBeNull();
    expect(sql.toLowerCase()).not.toMatch(/\bcascade\s*;/);
    expect(sql.toLowerCase()).not.toMatch(/drop [^;]*cascade/);
  });

  it("H10 runs in one transaction: begin, lock timeout, DDL, DO block, commit", () => {
    const begin = sql.indexOf("\nbegin;\n");
    const lock = sql.indexOf("set local lock_timeout = '5s';");
    const firstCreate = sql.indexOf("create table");
    const check = sql.indexOf("\ndo $$");
    const commit = sql.lastIndexOf("\ncommit;");
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(lock).toBeGreaterThan(begin);
    expect(firstCreate).toBeGreaterThan(lock);
    expect(check).toBeGreaterThan(sql.lastIndexOf("drop type"));
    expect(commit).toBeGreaterThan(check);
    expect(occurrences("\ndo $$")).toBe(1);
  });

  it("H11 the DO block checks every property and raises on each", () => {
    const block = doBlock();
    expect(block).toContain(
      "v_tables text[] := array['households', 'household_members', 'share_grants', 'goals'];"
    );
    const checks: Array<[string, RegExp]> = [
      ["D-a client privileges", /has_any_column_privilege\(r\.role_name, v_table[^;]*;\s+if v_remaining is not null then\s+raise exception/],
      ["D-b PUBLIC", /a\.grantee = 0\s+\) then\s+raise exception '%: PUBLIC still holds a table privilege'/],
      ["D-c RLS", /if v_rls is distinct from true then\s+raise exception/],
      ["D-c policies", /if v_policies <> 0 then\s+raise exception/],
      ["D-d service_role", /<> has_table_privilege\('service_role', v_table, p\.privilege\);\s+if v_remaining is not null then\s+raise exception/],
      ["D-j owner DELETE", /has_table_privilege\(c\.relowner, v_table, 'DELETE'\)\s+\) then\s+raise exception/],
      ["D-e keys", /k\.confdeltype::text = v_fk\.action\s+\) into v_ok;\s+if not v_ok then\s+raise exception/],
      ["D-e no restrict", /k\.confdeltype not in \('c', 'n'\)\s+\) then\s+raise exception/],
      ["D-f index", /pg_get_expr\(i\.indpred, i\.indrelid\) = '\(status = ''active''::text\)'\s+\) into v_ok;\s+if not v_ok then\s+raise exception/],
      ["D-g EXECUTE", /has_function_privilege\('authenticated', v_fn, 'EXECUTE'\) then\s+raise exception/],
      ["D-g PUBLIC EXECUTE", /a\.grantee = 0\) then\s+raise exception '%: PUBLIC still holds EXECUTE'/],
      ["D-g ensure invoker", /where p\.oid = 'public\.household_ensure_for_user\(uuid\)'::regprocedure;\s+if v_prosecdef then\s+raise exception 'public\.household_ensure_for_user\(uuid\): expected SECURITY INVOKER'/],
      ["D-g search_path", /'search_path=""' = any\(v_proconfig\)\) then\s+raise exception/],
      ["D-g service_role", /'EXECUTE'\) then\s+raise exception 'public\.household_ensure_for_user\(uuid\): service_role lacks EXECUTE'/],
      ["D-m definer", /if v_prosecdef is distinct from true then\s+raise exception '%: expected SECURITY DEFINER'/],
      ["D-m owner", /if v_proowner is distinct from \(\s+select c\.relowner from pg_class c where c\.oid = 'public\.households'::regclass\s+\) then\s+raise exception/],
      ["D-m owner DELETE", /if not has_table_privilege\(v_proowner, 'public\.households'::regclass, 'DELETE'\) then\s+raise exception/],
      ["D-m EXECUTE holders", /if v_proacl is null\s+or exists \(\s+select 1 from aclexplode\(v_proacl\) a where a\.grantee <> v_proowner\s+\) then\s+raise exception/],
      ["D-m service_role", /if has_function_privilege\('service_role', v_fn, 'EXECUTE'\) then\s+raise exception/],
      ["D-h trigger", /\(t\.tgtype & 16\) = 16\s+\) into v_ok;\s+if not v_ok then\s+raise exception/],
      ["D-i public function", /p\.proname = 'update_updated_at_column'\s+\) then\s+raise exception 'public\.update_updated_at_column still exists'/],
      ["D-i type", /if to_regtype\('public\.account_type'\) is not null then\s+raise exception/],
      ["D-i storage", /n\.nspname = 'storage'[\s\S]*?\) then\s+raise exception 'storage\.update_updated_at_column is missing'/],
    ];
    for (const [label, pattern] of checks) {
      expect(block, label).toMatch(pattern);
    }
    // The D-m checks read the cleanup function, assigned once just before them.
    const dmTarget = block.indexOf(
      "v_fn := 'public.household_delete_if_no_active_members()'::regprocedure;"
    );
    expect(dmTarget).toBeGreaterThan(-1);
    expect(block.indexOf("expected SECURITY DEFINER")).toBeGreaterThan(dmTarget);
    expect(block.split("v_fn :=").length - 1).toBe(1);
    for (const row of [
      "('household_members', 'household_id',  'public.households', 'c')",
      "('household_members', 'user_id',       'public.users',      'c')",
      "('share_grants',      'owner_user_id', 'public.users',      'c')",
      "('share_grants',      'household_id',  'public.households', 'c')",
      "('goals',             'owner_user_id', 'public.users',      'c')",
      "('goals',             'household_id',  'public.households', 'c')",
      "('goals',             'created_by',    'public.users',      'n')",
    ]) {
      expect(block, row).toContain(row);
    }
    expect(block).toContain(
      "when v_name in ('households', 'household_members') then array['SELECT', 'INSERT']"
    );
  });

  it("H12 writes no row outside the ensure function (no backfill)", () => {
    const body = functionBody("household_ensure_for_user");
    const inserts = sql.match(/\binsert\s+into\b/gi) ?? [];
    const insideBody = body.match(/\binsert\s+into\b/gi) ?? [];
    expect(insideBody.length).toBe(2);
    expect(inserts.length).toBe(insideBody.length);
    expect(sql).not.toMatch(/\bupdate\s+public\./i);
  });

  it("H13 the ensure function takes the per-user lock before it looks for a membership", () => {
    const body = functionBody("household_ensure_for_user");
    const lock = body.indexOf(
      "perform pg_catalog.pg_advisory_xact_lock(\n" +
        "    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));"
    );
    const lookup = body.indexOf("from public.household_members m");
    const insert = body.indexOf("insert into public.households default values");
    expect(lock).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(lookup);
    expect(body).toContain("and m.status = 'active';");
    expect(body).toContain("values (v_household_id, p_user_id, 'owner', 'active');");
  });

  it("H14 share_grants.scope admits exactly 'view', and the DO block checks it", () => {
    expect(createTable("share_grants")).toContain(
      "scope          text not null check (scope in ('view')),"
    );
    expect(doBlock()).toMatch(
      /pg_get_constraintdef\(k\.oid\) = 'CHECK \(\(scope = ''view''::text\)\)'\s+\) into v_ok;\s+if not v_ok then\s+raise exception/
    );
  });

  it("H15 goals.status admits exactly active, completed and archived, and the DO block checks it", () => {
    expect(createTable("goals")).toContain(
      "status                text not null default 'active' check (status in ('active', 'completed', 'archived')),"
    );
    expect(doBlock()).toMatch(
      /= 'CHECK \(\(status = ANY \(ARRAY\[''active''::text, ''completed''::text, ''archived''::text\]\)\)\)'\s+\) into v_ok;\s+if not v_ok then\s+raise exception/
    );
  });

  it("H16 the cleanup trigger is AFTER DELETE OR UPDATE OF status, row level, on household_members", () => {
    expect(sql).toContain(
      "create trigger trg_household_members_cleanup\n" +
        "after delete or update of status on public.household_members\n" +
        "for each row execute function public.household_delete_if_no_active_members();"
    );
    const body = functionBody("household_delete_if_no_active_members");
    expect(body).toContain("delete from public.households h");
    expect(body).toContain("and m.status = 'active'");
  });

  it("H17 the SECURITY DEFINER cleanup body names only qualified tables and deletes only OLD's household when it has no active member", () => {
    const body = functionBody("household_delete_if_no_active_members");
    // Every table name is schema-qualified.
    expect(body.match(/(^|[^.\w])households\b/g)).toBeNull();
    expect(body.match(/(^|[^.\w])household_members\b/g)).toBeNull();
    // "is not distinct from new.status" compares a value; it names no table.
    expect(
      body.match(/(?<!distinct )\b(from|into|update|join)\s+(?!public\.)[a-z_]+/gi)
    ).toBeNull();
    // One delete, and no other write.
    expect(body.match(/\bdelete\s+from\b/gi)?.length).toBe(1);
    expect(body).not.toMatch(/\binsert\b|\bupdate\s+public\.|\btruncate\b|\bexecute\b/i);
    // The delete's target and condition.
    expect(body).toContain(
      "  delete from public.households h\n" +
        "   where h.id = old.household_id\n" +
        "     and not exists (\n" +
        "       select 1\n" +
        "         from public.household_members m\n" +
        "        where m.household_id = old.household_id\n" +
        "          and m.status = 'active'\n" +
        "     );"
    );
  });
});
