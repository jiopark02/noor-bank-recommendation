import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the crisis notice daily count migration. It cannot run the
 * SQL; it holds the lines whose loss would open the count to client roles or
 * let a row identify a user, a session, or a time finer than a day. Whether
 * the file is applied, and whether its DO block passed, is live state that
 * only the database can answer.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement. Matching is case-sensitive on the lower-case
 * statements, so a raise message that names a property does not count either.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261027120000_create_chat_crisis_notice_daily.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

describe("chat crisis notice daily count migration", () => {
  it("declares the function SECURITY INVOKER, never DEFINER", () => {
    expect(occurrences("security invoker")).toBe(1);
    expect(sql.toLowerCase()).not.toContain("security definer");
  });

  it("pins an empty search_path on the function", () => {
    expect(occurrences("set search_path = ''")).toBe(1);
  });

  it("revokes from PUBLIC, anon and authenticated on the table and the function", () => {
    expect(occurrences("from public, anon, authenticated")).toBe(2);
  });

  it("grants nothing to PUBLIC, anon or authenticated", () => {
    expect(sql).not.toMatch(/\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i);
  });

  it("cuts service_role back before granting it three table privileges", () => {
    const revoke = sql.indexOf(
      "revoke all on table public.chat_crisis_notice_daily from service_role;"
    );
    const grant = sql.indexOf(
      "grant select, insert, update on table public.chat_crisis_notice_daily to service_role;"
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it("turns RLS on and creates no policy", () => {
    expect(sql).toContain(
      "alter table public.chat_crisis_notice_daily enable row level security;"
    );
    expect(sql.toLowerCase()).not.toContain("create policy");
  });

  it("carries no user, session or generation identifier and no time finer than a day", () => {
    expect(sql).not.toMatch(/user_id|session_id|generation_id/);
    expect(sql.toLowerCase()).not.toContain("timestamptz");
  });

  it("runs in one transaction with a closing DO block", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(occurrences("do $$")).toBe(1);
  });
});
