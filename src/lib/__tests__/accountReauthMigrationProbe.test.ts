import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the account reauthentication code migration. It cannot run
 * the SQL; it holds the lines whose loss would open the table or the functions
 * to client roles, let a function resolve names through a search_path, compare
 * a code before its attempt is counted, let one verification answer two
 * consuming checks, or drop the check that rolls the file back. Whether the
 * file is applied, and whether its DO block passed, is live state that only
 * the database can answer; the decisions themselves are checked with SQL
 * against a database.
 *
 * SQL line comments are stripped for every statement check, so a sentence in
 * the header cannot stand in for a statement. The header is read raw, once,
 * for the order it states.
 *
 * Mutations and the test each one turns red:
 *   security invoker changed to security definer on any function -> R1
 *   a set search_path line removed                                -> R2
 *   a table reference or now() left unqualified                   -> R3
 *   the client-role revoke, or the service_role grant, changed    -> R4
 *   a function revoke or EXECUTE grant removed                    -> R5
 *   RLS left off, or a policy added                               -> R6
 *   a limit, lifetime or window written as a literal              -> R7
 *   an argument check removed                                     -> R7
 *   the hash compared before the attempt is counted               -> R8
 *   the attempt limit dropped from the counting update            -> R8
 *   consumption split from the statement that finds the verification -> R9
 *   the purpose filter dropped from the check                     -> R9
 *   a new code that keeps the old attempts or verification        -> R10
 *   the cascade FK on user_id removed, pointed at public.users, or its check -> R11
 *   the DO block, a function in it, or the transaction removed    -> R12
 *   the header's order sentence or reversal removed               -> R13
 *   the session not stored on verification, not compared by a check
 *   path, a null session accepted, or the pairing constraint dropped -> R14
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261121130000_account_reauth_codes.sql"
);

const raw = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/--[^\n]*/g, "");

const ISSUE = "public.account_reauth_issue(uuid, text, text, integer, integer, integer)";
const VERIFY = "public.account_reauth_verify(uuid, text, text, uuid, integer)";
const CHECK = "public.account_reauth_check(uuid, text, uuid, integer, boolean)";
const FNS = [ISSUE, VERIFY, CHECK];

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

/** A function's body, between its opening and closing dollar quotes. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

/** The text from a function's create up to its body, its declared properties. */
function functionHead(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const open = sql.indexOf("as $$", start);
  return sql.slice(start, open);
}

function doBlock(): string {
  const start = sql.indexOf("do $$");
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start);
}

const NAMES = ["account_reauth_issue", "account_reauth_verify", "account_reauth_check"];

describe("account reauth codes migration", () => {
  it("R1 declares every function SECURITY INVOKER, never DEFINER", () => {
    for (const name of NAMES) {
      expect(functionHead(name), name).toContain("security invoker");
    }
    expect(occurrences("security invoker")).toBe(3);
    expect(sql.toLowerCase()).not.toContain("security definer");
  });

  it("R2 pins an empty search_path on every function", () => {
    for (const name of NAMES) {
      expect(functionHead(name), name).toContain("set search_path = ''");
    }
    expect(occurrences("set search_path = ''")).toBe(3);
  });

  it("R3 qualifies every table reference with public. and the clock with pg_catalog.", () => {
    expect(sql.match(/(^|[^.\w'])account_reauth_codes\b/g)).toBeNull();
    for (const name of NAMES) {
      const body = functionBody(name);
      expect(body.match(/(^|[^.\w])now\(\)/g), name).toBeNull();
      expect(body, name).toContain("pg_catalog.now()");
      expect(body, name).not.toMatch(/p_now|clock_timestamp|statement_timestamp/);
    }
  });

  it("R4 revokes from PUBLIC, anon and authenticated, and grants service_role three table privileges", () => {
    expect(sql).toContain(
      "revoke all on table public.account_reauth_codes from public, anon, authenticated;"
    );
    const revoke = sql.indexOf("revoke all on table public.account_reauth_codes from service_role;");
    const grant = sql.indexOf(
      "grant select, insert, update on table public.account_reauth_codes to service_role;"
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(occurrences("grant ")).toBe(4);
    expect(sql).not.toMatch(/grant [a-z, ]*delete[a-z, ]* on table/);
  });

  it("R5 revokes EXECUTE from PUBLIC, anon and authenticated and grants it to service_role, on each function", () => {
    for (const fn of FNS) {
      expect(sql, fn).toContain(`revoke all on function ${fn}\n  from public, anon, authenticated;`);
      expect(sql, fn).toContain(`grant execute on function ${fn}\n  to service_role;`);
    }
  });

  it("R6 turns RLS on and creates no policy", () => {
    expect(sql).toContain("alter table public.account_reauth_codes enable row level security;");
    expect(sql.toLowerCase()).not.toContain("create policy");
  });

  it("R7 takes every limit, lifetime and window from its arguments, and refuses a bad one", () => {
    for (const name of NAMES) {
      const body = functionBody(name);
      expect(body, name).not.toMatch(/c\.attempts < \d|c\.window_count < \d|interval '\d/);
      expect(body, name).toMatch(/raise exception '[a-z_]+: invalid arguments'\s+using errcode = '22023'/);
      expect(body, name).toContain("p_user_id is null");
      expect(body, name).toContain("p_purpose not in ('delete_account', 'export_data')");
    }
    const issue = functionBody("account_reauth_issue");
    expect(issue).toContain("or c.window_count < p_max_issues");
    expect(issue).toContain("pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds)");
    expect(issue).toContain("p_ttl_seconds is null or p_ttl_seconds < 1");
    expect(issue).toContain("p_max_issues is null or p_max_issues < 1");
    expect(issue).toContain("p_window_seconds is null or p_window_seconds < 1");
    expect(functionBody("account_reauth_verify")).toContain(
      "p_max_attempts is null or p_max_attempts < 1"
    );
    expect(functionBody("account_reauth_check")).toContain(
      "p_window_seconds is null or p_window_seconds < 1"
    );
  });

  it("R8 counts the attempt in the locking update before comparing the hash, under the attempt limit", () => {
    const body = functionBody("account_reauth_verify");
    const count = body.indexOf("set attempts = c.attempts + 1");
    const compare = body.indexOf("if v_hash = p_code_hash then");
    expect(count).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(count);
    const update = body.slice(count, body.indexOf(";", count));
    expect(update).toContain("and c.attempts < p_max_attempts");
    expect(update).toContain("and c.purpose = p_purpose");
    expect(update).toContain("and c.verified_at is null");
    expect(update).toContain("and c.expires_at > pg_catalog.now()");
    expect(update).toContain("returning c.code_hash, c.attempts into v_hash, v_attempts");
    // The hash is read only from the row the counting update returned.
    expect(body.split("code_hash").length - 1).toBe(4);
    expect(body).toMatch(/if v_hash = p_code_hash then\s+update public\.account_reauth_codes c\s+set verified_at = pg_catalog\.now\(\)/);
  });

  it("R9 the check filters by purpose and window, and consumes in the statement that finds the verification", () => {
    const body = functionBody("account_reauth_check");
    const consume = body.indexOf("if p_consume then");
    expect(consume).toBeGreaterThan(-1);
    const consuming = body.slice(consume, body.indexOf("return v_ok;", consume));
    expect(consuming).toMatch(
      /with consumed as \(\s+update public\.account_reauth_codes c\s+set verified_at = null,\s+verified_session_id = null,\s+expires_at = pg_catalog\.now\(\)\s+where c\.user_id = p_user_id\s+and c\.purpose = p_purpose\s+and c\.verified_session_id = p_session_id\s+and c\.verified_at is not null\s+and c\.verified_at > pg_catalog\.now\(\) - v_window\s+returning true\s+\)/
    );
    expect(consuming).not.toMatch(/\bselect exists \(\s+select 1\s+from public\.account_reauth_codes/);
    const reading = body.slice(body.indexOf("return v_ok;", consume) + 1);
    expect(reading).toContain("and c.purpose = p_purpose");
    expect(reading).toContain("and c.verified_at > pg_catalog.now() - v_window");
  });

  it("R14 a verification records its session, and only the same session's check passes", () => {
    expect(sql).toContain("  verified_session_id uuid,\n");
    expect(sql).toMatch(
      /constraint account_reauth_codes_verified_session_check\s+check \(\(verified_at is null\) = \(verified_session_id is null\)\)/
    );
    const verify = functionBody("account_reauth_verify");
    expect(verify).toContain("or p_session_id is null");
    expect(verify).toMatch(
      /if v_hash = p_code_hash then\s+update public\.account_reauth_codes c\s+set verified_at = pg_catalog\.now\(\),\s+verified_session_id = p_session_id\s+where c\.user_id = p_user_id;/
    );
    const check = functionBody("account_reauth_check");
    expect(check).toContain("or p_session_id is null");
    // Both the consuming and the reading path compare the session.
    expect(check.split("and c.verified_session_id = p_session_id").length - 1).toBe(2);
    expect(doBlock()).toContain("k.conname = 'account_reauth_codes_verified_session_check'");
  });

  it("R10 a new code replaces the old one's hash, lifetime, attempts and verification", () => {
    const body = functionBody("account_reauth_issue");
    const set = body.slice(body.indexOf("on conflict (user_id) do update"));
    expect(set).toContain("set purpose = excluded.purpose,");
    expect(set).toContain("code_hash = excluded.code_hash,");
    expect(set).toContain("expires_at = excluded.expires_at,");
    expect(set).toContain("attempts = 0,");
    expect(set).toContain("verified_at = null,");
    expect(set).toContain("verified_session_id = null,");
    expect(occurrences("on conflict (user_id) do update")).toBe(1);
    expect(body).toContain("select exists (select 1 from issued) into v_issued;");
  });

  it("R11 user_id cascades from auth.users, and the DO block checks that it does", () => {
    expect(sql).toContain(
      "user_id       uuid primary key references auth.users(id) on delete cascade,"
    );
    expect(sql).not.toContain("references public.users");
    const block = doBlock();
    expect(block).toContain("k.confrelid = 'auth.users'::regclass");
    expect(block).toContain("k.confdeltype = 'c'");
    expect(block).toContain("a.attname = 'user_id'");
    expect(block).toMatch(/if not v_fk_ok then\s+raise exception/);
    expect(block).toContain("has_table_privilege(c.relowner, v_table, 'DELETE')");
  });

  it("R12 runs in one transaction with a closing DO block that checks every function and the table", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(occurrences("do $$")).toBe(1);
    const block = doBlock();
    for (const fn of FNS) {
      expect(block, fn).toContain(`'${fn}'::regprocedure`);
    }
    expect(block).toContain("foreach v_fn in array v_fns loop");
    expect(block).toContain("has_function_privilege('anon', v_fn, 'EXECUTE')");
    expect(block).toContain("has_function_privilege('authenticated', v_fn, 'EXECUTE')");
    expect(block).toContain("has_function_privilege('service_role', v_fn, 'EXECUTE')");
    expect(block).toContain("if v_prosecdef then");
    expect(block).toContain(`'search_path=""' = any(v_proconfig)`);
    expect(block).toContain("relrowsecurity");
    expect(block).toContain("from pg_policy where polrelid = v_table");
    expect(block).toContain("a.grantee = 0");
    expect(block).toContain("p.privilege not in ('SELECT', 'INSERT', 'UPDATE')");
  });

  it("R13 the header states that the file is applied before the code that calls it, and how to reverse it", () => {
    const header = raw.slice(0, raw.indexOf("begin;"));
    expect(header).toMatch(
      /applied before the code that calls the functions or exports the table is\s*\n?--\s*deployed/
    );
    for (const fn of FNS) {
      expect(header, fn).toContain(`drop function if exists ${fn};`);
    }
    expect(header).toContain("drop table if exists public.account_reauth_codes;");
  });
});
