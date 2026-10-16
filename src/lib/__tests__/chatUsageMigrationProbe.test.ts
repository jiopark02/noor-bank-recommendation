import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the chat usage ledger migration. It cannot run the SQL; it
 * holds the lines whose loss would leave the ledger or its functions open to
 * client roles. Whether the file is applied, and whether its DO block passed,
 * is live state that only the database can answer.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement. Matching is case-sensitive on the lower-case
 * statements, so a raise message that names a property does not count either.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261016120000_create_chat_usage_reservations.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

describe("chat usage ledger migration", () => {
  it("declares both functions SECURITY INVOKER, never DEFINER", () => {
    expect(occurrences("security invoker")).toBe(2);
    expect(sql.toLowerCase()).not.toContain("security definer");
  });

  it("pins an empty search_path on both functions", () => {
    expect(occurrences("set search_path = ''")).toBe(2);
  });

  it("revokes from PUBLIC, anon and authenticated on the table and both functions", () => {
    expect(occurrences("from public, anon, authenticated")).toBe(3);
  });

  it("cuts service_role back before granting it three table privileges", () => {
    const revoke = sql.indexOf(
      "revoke all on table public.chat_usage_reservations from service_role;"
    );
    const grant = sql.indexOf(
      "grant select, insert, update on table public.chat_usage_reservations to service_role;"
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it("turns RLS on and creates no policy", () => {
    expect(sql).toContain(
      "alter table public.chat_usage_reservations enable row level security;"
    );
    expect(sql.toLowerCase()).not.toContain("create policy");
  });

  it("cascades user_id from auth.users", () => {
    expect(sql).toContain("references auth.users(id) on delete cascade");
  });

  it("runs in one transaction with a closing DO block", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(occurrences("do $$")).toBe(1);
  });
});
