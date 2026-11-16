import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the confirmation-send limit migration. It cannot run the
 * SQL; it holds the lines whose loss would open the table or the function to
 * client roles, let the function resolve names through a search_path, or
 * change the limits. Whether the file is applied, and whether its DO block
 * passed, is live state that only the database can answer.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   M19 the 60-second gap changed (to 0, say)          -> P7
 *   M22 the set search_path line removed               -> P2
 *   M23 the service_role table or EXECUTE grant removed -> P4, P5
 *   M24 security invoker changed to security definer   -> P1
 *   the cascade FK on user_id removed, or its check    -> P10
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261104120000_email_confirmation_sends.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

/** The function body, between its opening and closing dollar quotes. */
function functionBody(): string {
  const start = sql.indexOf("create or replace function public.email_confirmation_claim");
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

describe("email confirmation sends migration", () => {
  it("P1 declares the function SECURITY INVOKER, never DEFINER", () => {
    expect(occurrences("security invoker")).toBe(1);
    expect(sql.toLowerCase()).not.toContain("security definer");
  });

  it("P2 pins an empty search_path on the function", () => {
    expect(occurrences("set search_path = ''")).toBe(1);
  });

  it("P3 qualifies every table reference with public. and now() with pg_catalog.", () => {
    const unqualified = sql.match(/(^|[^.\w])email_confirmation_sends\b/g);
    expect(unqualified).toBeNull();
    const body = functionBody();
    expect(body).toContain("public.email_confirmation_sends");
    expect(body.match(/(^|[^.\w])now\(\)/g)).toBeNull();
    expect(body).toContain("pg_catalog.now()");
  });

  it("P4 revokes from PUBLIC, anon and authenticated, and grants service_role three table privileges", () => {
    expect(sql).toContain(
      "revoke all on table public.email_confirmation_sends from public, anon, authenticated;"
    );
    const revoke = sql.indexOf(
      "revoke all on table public.email_confirmation_sends from service_role;"
    );
    const grant = sql.indexOf(
      "grant select, insert, update on table public.email_confirmation_sends to service_role;"
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it("P5 revokes EXECUTE from PUBLIC, anon and authenticated and grants it to service_role", () => {
    expect(sql).toMatch(
      /revoke all on function public\.email_confirmation_claim\(uuid\)\s+from public, anon, authenticated;/
    );
    expect(sql).toContain(
      "grant execute on function public.email_confirmation_claim(uuid) to service_role;"
    );
  });

  it("P6 turns RLS on and creates no policy", () => {
    expect(sql).toContain(
      "alter table public.email_confirmation_sends enable row level security;"
    );
    expect(sql.toLowerCase()).not.toContain("create policy");
  });

  it("P7 holds the limits: a 60-second gap, a 24-hour window, 5 sends", () => {
    const body = functionBody();
    expect(body).toContain(
      "s.last_sent_at <= pg_catalog.now() - interval '60 seconds'"
    );
    expect(occurrences("interval '24 hours'")).toBe(3);
    expect(body).toContain("s.window_count < 5");
  });

  it("P8 decides in one upsert and answers whether it wrote", () => {
    const body = functionBody();
    expect(occurrences("on conflict (user_id) do update")).toBe(1);
    expect(body).toContain("returning true");
    expect(body).toContain("select exists (select 1 from claimed);");
  });

  it("P10 user_id cascades from auth.users, and the DO block checks that it does", () => {
    expect(sql).toContain(
      "user_id       uuid primary key references auth.users(id) on delete cascade,"
    );
    const block = sql.slice(sql.indexOf("do $$"));
    expect(block).toContain("k.confrelid = 'auth.users'::regclass");
    expect(block).toContain("k.confdeltype = 'c'");
    expect(block).toContain("a.attname = 'user_id'");
    expect(block).toMatch(/if not v_fk_ok then\s+raise exception/);
    expect(block).toContain("has_table_privilege(c.relowner, v_table, 'DELETE')");
  });

  it("P9 runs in one transaction with a closing DO block", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(occurrences("do $$")).toBe(1);
  });
});
