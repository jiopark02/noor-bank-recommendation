import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the household invites migration. It cannot run the SQL; it
 * holds the lines whose loss would open the new tables or functions to client
 * roles, widen what service_role may write on household_members, let a
 * function decide before it holds the household lock, let a caller whose
 * address does not match learn why, or let the closing DO block stop checking
 * a property. Whether the file is applied, whether its DO block passed, and
 * how the functions behave under concurrency are database behaviour, checked
 * by running the file against a database, not here.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   a new table's revoke from public, anon, authenticated removed  -> M1
 *   a new table's revoke from service_role removed                 -> M1
 *   an enable row level security line removed, or a policy added   -> M1
 *   UPDATE on household_members granted at table level             -> M2
 *   user_id or household_id added to the column UPDATE grant       -> M2
 *   a revoke on household_members added                            -> M2
 *   a function changed to security definer                         -> M3
 *   a set search_path line removed                                 -> M3
 *   a function's EXECUTE revoke or grant removed                   -> M3
 *   the household lock taken before the user lock                  -> M4
 *   must_leave_first, already_member or household_full answered
 *     before the address comparison                                -> M5
 *   the owner promotion in leave removed                           -> M6
 *   the owner-exists check in repair removed                       -> M7
 *   the promotion in repair removed                                -> M7
 *   a household lock line removed                                  -> M8
 *   the successor order removed from leave or repair               -> M9
 *   the leaving row set to 'left' before the promotion             -> M10
 *   an invite delete removed from create, cancel, accept or leave  -> M12
 *   the re-read under the household locks removed                  -> M13
 *   the foreign_key_violation handler removed                      -> M14
 *   the repair call removed from create, or moved before its lock  -> M15
 *   a trigger, a security definer or a drop added                  -> M16
 *   a create or replace of an existing household function added    -> M16
 *   a DO block check or its raise removed                          -> M17
 *   a dropped legacy table's name used in a function               -> M18
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261120120000_household_invites_and_membership_changes.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

const NEW_TABLES: Record<string, string> = {
  household_invites: "select, insert, delete",
  household_invite_issues: "select, insert, update",
};

const FUNCTIONS: Record<string, string> = {
  household_max_members: "",
  household_invite_claim: "uuid, integer, integer",
  household_repair_owner: "uuid",
  household_invite_create: "uuid, text, text, integer",
  household_invite_cancel: "uuid",
  household_invite_accept: "uuid, text, text",
  household_leave: "uuid",
  household_invites_prune_expired: "",
};

/** Functions that read a membership and then write under the two locks. */
const LOCKING = [
  "household_repair_owner",
  "household_invite_create",
  "household_invite_cancel",
  "household_invite_accept",
  "household_leave",
];

const USER_LOCK =
  "pg_catalog.hashtextextended('household:' || p_user_id::text, 0)";
const HOUSEHOLD_LOCK = "pg_catalog.hashtextextended('household_group:' ||";
const SUCCESSOR_ORDER = "order by s.joined_at asc, s.id asc";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A function body, between its opening and closing dollar quotes. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  expect(open, name).toBeGreaterThan(start);
  expect(close, name).toBeGreaterThan(open);
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

/** Every match of a global pattern, as [index, text] pairs. */
function matches(haystack: string, pattern: RegExp): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    out.push([m.index, m[0]]);
  }
  return out;
}

/** Position of needle in body, failing when it is absent. */
function at(body: string, needle: string, label: string): number {
  const i = body.indexOf(needle);
  expect(i, `${label}: ${needle}`).toBeGreaterThan(-1);
  return i;
}

describe("household invites migration", () => {
  it("M1 creates both tables once, closes them to client roles, grants service_role only what it uses, RLS on, no policy", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql.match(/\bcreate table\b/gi)?.length).toBe(Object.keys(NEW_TABLES).length);
    for (const [table, grants] of Object.entries(NEW_TABLES)) {
      expect(occurrences(sql, `create table if not exists public.${table} (`), table).toBe(1);
      const clients = sql.indexOf(
        `revoke all on table public.${table} from public, anon, authenticated;`
      );
      const service = sql.indexOf(`revoke all on table public.${table} from service_role;`);
      const grant = sql.indexOf(`grant ${grants} on table public.${table} to service_role;`);
      const rls = sql.indexOf(`alter table public.${table} enable row level security;`);
      expect(clients, table).toBeGreaterThan(-1);
      expect(service, table).toBeGreaterThan(clients);
      expect(grant, table).toBeGreaterThan(service);
      expect(rls, table).toBeGreaterThan(-1);
    }
    expect(sql.toLowerCase()).not.toContain("create policy");
    const tableGrants = (sql.match(/\bgrant\s+[^;]*\bon table\b[^;]*;/gi) ?? []);
    for (const g of tableGrants) {
      expect(g).toMatch(/to service_role;$/);
    }
    expect(sql).not.toMatch(/\bto\s+(anon|authenticated|public)\b/i);
  });

  it("M2 grants service_role UPDATE on household_members on status, left_at and role only, and revokes nothing there", () => {
    const grants = (sql.match(/\bgrant\s+[^;]*household_members[^;]*;/gi) ?? []);
    expect(grants).toEqual([
      "grant update (status, left_at, role) on table public.household_members to service_role;",
    ]);
    expect(sql).not.toMatch(/\brevoke\s+[^;]*household_members[^;]*;/i);
    const block = doBlock();
    expect(block).toContain("(a.attname in ('status', 'left_at', 'role'))");
    expect(block).toContain("has_column_privilege('service_role', v_table, a.attnum, 'UPDATE')");
    expect(block).toMatch(
      /if has_table_privilege\('service_role', v_table, 'UPDATE'\)\s+or has_table_privilege\('service_role', v_table, 'DELETE'\) then\s+raise exception/
    );
  });

  it("M3 every function is SECURITY INVOKER with an empty search_path, and only service_role executes it", () => {
    expect(sql).not.toMatch(/security definer/i);
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
    const functionGrants = sql.match(/\bgrant\s+execute\b[^;]*;/gi) ?? [];
    expect(functionGrants.length).toBe(Object.keys(FUNCTIONS).length);
  });

  it("M4 each locking function takes the user lock before any household lock", () => {
    for (const name of LOCKING) {
      const body = functionBody(name);
      expect(occurrences(body, USER_LOCK), name).toBe(1);
      const user = at(body, USER_LOCK, name);
      const household = at(body, HOUSEHOLD_LOCK, name);
      expect(household, name).toBeGreaterThan(user);
    }
    const accept = functionBody("household_invite_accept");
    expect(accept).toContain("least(v_current, v_target)::text");
    expect(accept.indexOf("least(v_current, v_target)")).toBeLessThan(
      accept.indexOf("greatest(v_current, v_target)")
    );
  });

  it("M5 accept answers nothing but refused or retry before the caller's address is compared", () => {
    const body = functionBody("household_invite_accept");
    const compare = at(body, "or v_invitee_email <> p_email then\n    return 'refused';", "accept");
    const before = body.slice(0, compare);
    const answers = (before.match(/return '([a-z_]+)'/g) ?? []).map((r) => r.slice(8, -1));
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(["refused", "retry"], answer).toContain(answer);
    }
    for (const later of ["already_member", "must_leave_first", "household_full", "accepted"]) {
      expect(body.indexOf(`return '${later}'`), later).toBeGreaterThan(compare);
    }
    expect(body).toContain("or v_expires_at <= pg_catalog.now()");
  });

  it("M6 leaving as the owner with another active member promotes one of them", () => {
    const body = functionBody("household_leave");
    const branch = at(body, "if v_role = 'owner' then", "leave");
    const promote = at(body, "update public.household_members\n       set role = 'owner'", "leave");
    expect(promote).toBeGreaterThan(branch);
    expect(body).toContain("and s.user_id <> p_user_id");
    const solo = at(body, "return 'solo';", "leave");
    expect(solo).toBeLessThan(branch);
  });

  it("M7 repair promotes only when the household has no active owner", () => {
    const body = functionBody("household_repair_owner");
    const check = at(
      body,
      "and m.role = 'owner'\n  ) then\n    return 'ok';",
      "repair"
    );
    const promote = at(body, "update public.household_members\n     set role = 'owner'", "repair");
    expect(promote).toBeGreaterThan(check);
    expect(body.indexOf("return 'repaired';")).toBeGreaterThan(promote);
  });

  it("M8 promotions and membership writes happen only after the household lock", () => {
    for (const name of LOCKING) {
      const body = functionBody(name);
      const household = at(body, HOUSEHOLD_LOCK, name);
      const writes = matches(
        body,
        /\bupdate public\.household_members\b|\binsert into public\.household_(members|invites)\b|\bdelete from public\.household_invites\b/g
      ).map(([index]) => index);
      expect(writes.length, name).toBeGreaterThan(0);
      for (const w of writes) {
        expect(w, name).toBeGreaterThan(household);
      }
    }
  });

  it("M9 the successor is the earliest-joined active member, ties broken by id", () => {
    expect(functionBody("household_leave")).toContain(SUCCESSOR_ORDER);
    expect(functionBody("household_repair_owner")).toContain(SUCCESSOR_ORDER);
  });

  it("M10 leave promotes the successor before it sets the leaving membership to left", () => {
    const body = functionBody("household_leave");
    const promote = at(body, "set role = 'owner'", "leave");
    const left = at(body, "set status = 'left'", "leave");
    expect(promote).toBeLessThan(left);
  });

  it("M12 create, cancel, accept and leave delete the invites they end", () => {
    const create = functionBody("household_invite_create");
    expect(create).toContain("delete from public.household_invites i\n   where i.household_id = v_household;");
    expect(create).toContain("delete from public.household_invites i\n   where i.expires_at <= pg_catalog.now();");
    expect(create.indexOf("where i.household_id = v_household;")).toBeLessThan(
      create.indexOf("insert into public.household_invites")
    );
    expect(functionBody("household_invite_cancel")).toContain(
      "delete from public.household_invites i\n   where i.household_id = v_household;"
    );
    const accept = functionBody("household_invite_accept");
    const inner = accept.slice(accept.lastIndexOf("  begin\n"));
    expect(inner.indexOf("delete from public.household_invites i")).toBeLessThan(
      inner.indexOf("insert into public.household_members")
    );
    expect(functionBody("household_leave")).toContain(
      "where i.invited_by = p_user_id\n      or i.household_id = v_household;"
    );
    expect(functionBody("household_invites_prune_expired")).toContain(
      "where i.expires_at <= pg_catalog.now();"
    );
  });

  it("M13 accept reads the membership again under the household locks and answers retry when it moved", () => {
    const body = functionBody("household_invite_accept");
    const lastLock = body.lastIndexOf(HOUSEHOLD_LOCK);
    const reread = at(body, "into v_reread", "accept");
    expect(reread).toBeGreaterThan(lastLock);
    expect(body).toContain("if v_reread is distinct from v_current then\n    return 'retry';");
    const invite = body.indexOf("into v_invite_id,");
    expect(invite).toBeGreaterThan(lastLock);
    const members = body.indexOf("into v_active");
    expect(members).toBeGreaterThan(lastLock);
  });

  it("M14 accept answers refused, with its writes rolled back, when the household disappeared", () => {
    const body = functionBody("household_invite_accept");
    expect(body).toMatch(
      /exception\n\s+when foreign_key_violation then\n\s+return 'refused';\n\s+end;\n\n\s+return 'accepted';/
    );
    const block = body.slice(body.lastIndexOf("  begin\n"), body.indexOf("  exception\n"));
    expect(block).toContain("delete from public.household_invites i");
    expect(block).toContain("set status = 'left'");
    expect(block).toContain("insert into public.household_members");
    expect(block).toContain("'member', 'active'");
  });

  it("M15 create runs the owner repair under its household lock, before it checks the caller's role", () => {
    const body = functionBody("household_invite_create");
    const lock = at(body, HOUSEHOLD_LOCK, "create");
    const repair = at(body, "perform public.household_repair_owner(p_user_id);", "create");
    const role = at(body, "if v_role is distinct from 'owner' then", "create");
    expect(repair).toBeGreaterThan(lock);
    expect(role).toBeGreaterThan(repair);
    expect(body).toContain("if v_active >= public.household_max_members() then");
  });

  it("M16 adds no trigger and no security definer, and leaves every existing object as it is", () => {
    expect(sql).not.toMatch(/\bcreate\s+(or\s+replace\s+)?trigger\b/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|function|trigger|index|type)\b/i);
    expect(sql).not.toMatch(/\balter\s+(function|trigger)\b/i);
    expect(sql).not.toMatch(/\bcascade\s*;/i);
    for (const existing of ["household_ensure_for_user", "household_delete_if_no_active_members"]) {
      expect(sql).not.toContain(`function public.${existing}`);
    }
    for (const existing of ["households", "household_members", "share_grants", "goals"]) {
      expect(sql).not.toContain(`create table if not exists public.${existing} (`);
      expect(sql).not.toMatch(new RegExp(`alter table public\\.${existing}\\b`));
    }
    const updates = matches(sql, /\bupdate\s+public\.household_members\b[^;]*;/gi);
    expect(updates.length).toBeGreaterThan(0);
    for (const [, statement] of updates) {
      const setClause = statement.slice(statement.indexOf(" set "), statement.indexOf(" where "));
      expect(setClause, statement).not.toMatch(/\b(user_id|household_id|id|joined_at)\s*=/);
      expect(setClause, statement).toMatch(/^ set (role = 'owner'|status = 'left',\s+left_at = pg_catalog\.now\(\))\n\s*$/);
    }
    expect((sql.match(/\binsert into public\.household_members\b[^;]*;/gi) ?? []).length).toBe(1);
  });

  it("M17 the DO block checks every property and raises on each", () => {
    const block = doBlock();
    const checks: Array<[string, RegExp]> = [
      ["client privileges", /has_any_column_privilege\(r\.role_name, v_table[\s\S]*?raise exception '%: client roles still hold privileges/],
      ["PUBLIC table privilege", /a\.grantee = 0\n\s+\) then\n\s+raise exception '%: PUBLIC still holds a table privilege'/],
      ["RLS", /relrowsecurity[\s\S]*?raise exception '%: row level security is not enabled'/],
      ["policies", /from pg_policy where polrelid = v_table;\n\s+if v_policies <> 0 then\n\s+raise exception/],
      ["service_role exact", /when 'household_invites' then array\['SELECT', 'INSERT', 'DELETE'\]\n\s+else array\['SELECT', 'INSERT', 'UPDATE'\][\s\S]*?raise exception '%: service_role privileges differ/],
      ["owner DELETE", /has_table_privilege\(c\.relowner, v_table, 'DELETE'\)[\s\S]*?raise exception '%: the table owner lacks DELETE'/],
      ["foreign keys", /k\.confdeltype = 'c'\n\s+\) into v_ok;\n\s+if not v_ok then\n\s+raise exception/],
      ["unique indexes", /i\.indisunique[\s\S]*?raise exception 'public\.household_invites: no unique index on %'/],
      ["members column UPDATE", /raise exception 'public\.household_members: service_role column UPDATE differs at: %'/],
      ["members client columns", /raise exception 'public\.household_members: client roles hold column privileges: %'/],
      ["members SELECT, INSERT kept", /raise exception 'public\.household_members: service_role lacks SELECT or INSERT'/],
      ["function client EXECUTE", /raise exception '%: anon or authenticated still holds EXECUTE'/],
      ["function PUBLIC EXECUTE", /v_proacl is null\n\s+or exists \(select 1 from aclexplode\(v_proacl\) a where a\.grantee = 0\) then\n\s+raise exception/],
      ["function invoker", /if v_prosecdef then\n\s+raise exception '%: expected SECURITY INVOKER'/],
      ["function search_path", /'search_path=""' = any\(v_proconfig\)\) then\n\s+raise exception/],
      ["function service_role EXECUTE", /raise exception '%: service_role lacks EXECUTE'/],
      ["max members", /if public\.household_max_members\(\) is distinct from 2 then\n\s+raise exception/],
      ["only the cleanup trigger", /t\.tgname = 'trg_household_members_cleanup'[\s\S]*?raise exception 'public\.household_members: expected only the cleanup trigger/],
      ["no trigger on new tables", /raise exception 'a new household table carries a trigger'/],
    ];
    for (const [label, pattern] of checks) {
      expect(block, label).toMatch(pattern);
    }
    for (const [name, args] of Object.entries(FUNCTIONS)) {
      expect(block, name).toContain(`'public.${name}(${args})'::regprocedure`);
    }
    for (const fk of [
      "('household_invites',       'household_id', 'public.households')",
      "('household_invites',       'invited_by',   'public.users')",
      "('household_invite_issues', 'user_id',      'public.users')",
    ]) {
      expect(block).toContain(fk);
    }
    expect(sql.indexOf("\ndo $$")).toBeLessThan(sql.lastIndexOf("commit;"));
    expect(occurrences(sql, "\ndo $$")).toBe(1);
  });

  it("M18 no function names a dropped legacy table", () => {
    const LEGACY = [
      "comments", "posts", "recommendations_new", "user_country_preferences",
      "country_checklist_items", "apartments", "bank_branches", "universities",
      "visa_types", "banks", "credit_cards", "deals", "jobs", "scholarships",
      "bank_accounts", "health_insurance_options", "required_documents",
    ];
    for (const name of Object.keys(FUNCTIONS)) {
      const text = `${functionHeader(name)}\n${functionBody(name)}`;
      for (const table of LEGACY) {
        expect(text, `${name}: ${table}`).not.toMatch(new RegExp(`\\b${table}\\b`, "i"));
      }
    }
  });
});
