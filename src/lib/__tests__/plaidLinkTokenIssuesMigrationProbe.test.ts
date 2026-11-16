import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the link-token issue limit migration. It cannot run the
 * SQL; it holds the lines whose loss would open the table or the function to
 * client roles, let the function resolve names through a search_path, move
 * the decision off the database clock, or drop the check that rolls the file
 * back. Whether the file is applied, and whether its DO block passed, is live
 * state that only the database can answer; the decision itself (the count,
 * the window edge, a repeat run) is checked with SQL against a database.
 *
 * SQL line comments are stripped for every statement check, so a sentence in
 * the header cannot stand in for a statement. The header is read raw, once,
 * for the order it states.
 *
 * Mutations and the test each one turns red:
 *   security invoker changed to security definer           -> L1
 *   the set search_path line removed                         -> L2
 *   a table reference or now() left unqualified              -> L3
 *   the client-role revoke, or the service_role grant, removed -> L4
 *   the function revoke or the EXECUTE grant removed         -> L5
 *   RLS left off, or a policy added                          -> L6
 *   the count or window taken from anything but the arguments -> L7
 *   the argument check removed                               -> L7
 *   the decision split out of the one upsert                 -> L8
 *   the cascade FK on user_id removed, or its check          -> L9
 *   the DO block or the transaction removed                  -> L10
 *   the header's order sentence removed                      -> L11
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261113120000_plaid_link_token_issues.sql"
);

const raw = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/--[^\n]*/g, "");

const FN = "public.plaid_link_token_claim(uuid, integer, integer)";

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

/** The function body, between its opening and closing dollar quotes. */
function functionBody(): string {
  const start = sql.indexOf("create or replace function public.plaid_link_token_claim(");
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

/** The closing DO block. */
function doBlock(): string {
  const start = sql.indexOf("do $$");
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start);
}

describe("plaid link token issues migration", () => {
  it("L1 declares the function SECURITY INVOKER, never DEFINER", () => {
    expect(occurrences("security invoker")).toBe(1);
    expect(sql.toLowerCase()).not.toContain("security definer");
  });

  it("L2 pins an empty search_path on the function", () => {
    expect(occurrences("set search_path = ''")).toBe(1);
  });

  it("L3 qualifies every table reference with public. and the clock with pg_catalog.", () => {
    expect(sql.match(/(^|[^.\w'])plaid_link_token_issues\b/g)).toBeNull();
    const body = functionBody();
    expect(body).toContain("insert into public.plaid_link_token_issues as s");
    expect(body.match(/(^|[^.\w])now\(\)/g)).toBeNull();
    expect(body).toContain("pg_catalog.now()");
    expect(body).toContain("pg_catalog.make_interval(secs => p_window_seconds)");
    // The database clock decides; nothing from the caller stands in for it.
    expect(body).not.toMatch(/p_now|clock_timestamp|statement_timestamp/);
  });

  it("L4 revokes from PUBLIC, anon and authenticated, and grants service_role three table privileges", () => {
    expect(sql).toContain(
      "revoke all on table public.plaid_link_token_issues from public, anon, authenticated;"
    );
    const revoke = sql.indexOf(
      "revoke all on table public.plaid_link_token_issues from service_role;"
    );
    const grant = sql.indexOf(
      "grant select, insert, update on table public.plaid_link_token_issues to service_role;"
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(occurrences("grant ")).toBe(2);
  });

  it("L5 revokes EXECUTE from PUBLIC, anon and authenticated and grants it to service_role", () => {
    expect(sql).toContain(
      `revoke all on function ${FN}\n  from public, anon, authenticated;`
    );
    expect(sql).toContain(`grant execute on function ${FN} to service_role;`);
  });

  it("L6 turns RLS on and creates no policy", () => {
    expect(sql).toContain(
      "alter table public.plaid_link_token_issues enable row level security;"
    );
    expect(sql.toLowerCase()).not.toContain("create policy");
  });

  it("L7 takes the count and the window from its arguments, and refuses a bad one", () => {
    const body = functionBody();
    expect(body).toContain("or s.window_count < p_max_count");
    expect(occurrences("pg_catalog.now() - v_window")).toBe(3);
    // No limit value of its own: the application holds the values.
    expect(body).not.toMatch(/window_count < \d/);
    expect(body).not.toMatch(/interval '\d/);
    expect(body).toMatch(
      /if p_user_id is null\s+or p_max_count is null or p_max_count < 1\s+or p_window_seconds is null or p_window_seconds < 1 then\s+raise exception/
    );
    expect(body).toContain("using errcode = '22023'");
  });

  it("L8 decides in one upsert and answers whether it wrote", () => {
    const body = functionBody();
    expect(occurrences("on conflict (user_id) do update")).toBe(1);
    expect(body).toContain("returning true");
    expect(body).toContain("select exists (select 1 from claimed) into v_claimed;");
    expect(body).toContain("return v_claimed;");
  });

  it("L9 user_id cascades from auth.users, and the DO block checks that it does", () => {
    expect(sql).toContain(
      "user_id       uuid primary key references auth.users(id) on delete cascade,"
    );
    const block = doBlock();
    expect(block).toContain("k.confrelid = 'auth.users'::regclass");
    expect(block).toContain("k.confdeltype = 'c'");
    expect(block).toContain("a.attname = 'user_id'");
    expect(block).toMatch(/if not v_fk_ok then\s+raise exception/);
    expect(block).toContain("has_table_privilege(c.relowner, v_table, 'DELETE')");
  });

  it("L10 runs in one transaction with a closing DO block that checks every property", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(occurrences("do $$")).toBe(1);
    const block = doBlock();
    expect(block).toContain(`v_fn regprocedure := '${FN}'::regprocedure;`);
    expect(block).toContain("has_function_privilege('anon', v_fn, 'EXECUTE')");
    expect(block).toContain("has_function_privilege('authenticated', v_fn, 'EXECUTE')");
    expect(block).toContain("has_function_privilege('service_role', v_fn, 'EXECUTE')");
    expect(block).toContain("if v_prosecdef then");
    expect(block).toContain(`'search_path=""' = any(v_proconfig)`);
    expect(block).toContain("relrowsecurity");
    expect(block).toContain("from pg_policy where polrelid = v_table");
    expect(block).toContain("a.grantee = 0");
  });

  it("L11 the header states that the file is applied before the code that calls it", () => {
    const header = raw.slice(0, raw.indexOf("begin;"));
    expect(header).toMatch(
      /this file is applied before the code\s*\n?--\s*that calls the function or exports the table is deployed/
    );
    expect(header).toContain(
      "drop function if exists public.plaid_link_token_claim(uuid, integer, integer);"
    );
    expect(header).toContain("drop table if exists public.plaid_link_token_issues;");
  });
});
