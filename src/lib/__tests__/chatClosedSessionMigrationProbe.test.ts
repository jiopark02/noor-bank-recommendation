import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { PG_CHAT_SESSION_CLOSED } from "../aiMemory";

/**
 * Source probe of the migration that makes an insert into chat_messages fail
 * for a closed session. It cannot run the SQL; it holds the lines whose loss
 * would let a closed session take a turn again, or would change who the
 * trigger function runs as, and it holds that the SQLSTATE the file raises is
 * the one the application recognizes. Whether the file is applied, whether
 * its DO block passed, and what the database does with the statement are live
 * state that only the database can answer.
 *
 * SQL line comments are stripped first, so a sentence in the header (the
 * statement to reverse the file included) cannot stand in for a statement.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261110120000_reject_chat_messages_on_closed_session.sql"
);

const sql = readFileSync(MIGRATION, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

function occurrences(needle: string): number {
  return sql.split(needle).length - 1;
}

/** The function definition: from `create or replace function` to its closing `$$;`. */
function functionDefinition(): string {
  const start = sql.indexOf("create or replace function public.bump_chat_session_on_message()");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("closed-session insert migration", () => {
  it("replaces the one existing trigger function and defines nothing else", () => {
    expect(occurrences("create or replace function")).toBe(1);
    expect(sql.toLowerCase()).not.toContain("create trigger");
    expect(sql.toLowerCase()).not.toContain("drop trigger");
    expect(sql.toLowerCase()).not.toContain("create table");
    expect(sql.toLowerCase()).not.toContain("alter table");
  });

  it("updates the session only while it is open", () => {
    const fn = functionDefinition();
    expect(fn).toContain("where id = new.session_id\n    and ended_at is null;");
    expect(occurrences("update public.chat_sessions")).toBe(1);
  });

  it("still maintains the session's counters as before", () => {
    const fn = functionDefinition();
    expect(fn).toContain("message_count = message_count + 1,");
    expect(fn).toContain("last_message_at = new.created_at");
    expect(fn).toContain("return new;");
  });

  it("raises when no session row was updated", () => {
    const fn = functionDefinition();
    const update = fn.indexOf("update public.chat_sessions");
    const notFound = fn.indexOf("if not found then");
    const raise = fn.indexOf("raise exception");
    expect(notFound).toBeGreaterThan(update);
    expect(raise).toBeGreaterThan(notFound);
    expect(fn.indexOf("return new;")).toBeGreaterThan(raise);
  });

  it("raises the SQLSTATE the application maps to a closed session", () => {
    expect(PG_CHAT_SESSION_CLOSED).toBe("NR001");
    expect(functionDefinition()).toContain(
      `using errcode = '${PG_CHAT_SESSION_CLOSED}';`
    );
  });

  it("puts no value from the row into the error message", () => {
    const fn = functionDefinition();
    expect(fn).toContain("raise exception 'chat_messages: the session is closed'");
    // A format placeholder would mean a session or user value in the message.
    expect(fn.slice(fn.indexOf("raise exception"))).not.toContain("%");
  });

  it("keeps the function SECURITY INVOKER with no configuration", () => {
    expect(sql.toLowerCase()).not.toContain("security definer");
    expect(functionDefinition().toLowerCase()).not.toMatch(/\bset\s+search_path\b/);
    expect(functionDefinition()).toContain("returns trigger\nlanguage plpgsql\nas $$");
  });

  it("adds, changes or removes no grant and no policy", () => {
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).not.toMatch(/\brevoke\b/i);
    expect(sql.toLowerCase()).not.toContain("policy");
    expect(sql.toLowerCase()).not.toContain("alter function");
  });

  it("changes no row", () => {
    // The only data statement is the UPDATE inside the trigger function.
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    const outside = sql.replace(functionDefinition(), "");
    expect(outside).not.toMatch(/\bupdate\s+public\./i);
  });

  it("runs in one transaction with a closing DO block that checks the end state", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(occurrences("do $$")).toBe(1);
    expect(sql).toContain("if v_prosecdef then");
    expect(sql).toContain("if v_proconfig is not null then");
    expect(sql).toContain("position('and ended_at is null' in v_prosrc) = 0");
    expect(sql).toContain("position('errcode = ''NR001''' in v_prosrc) = 0");
    expect(sql).toContain("if v_tgtype <> 5 then");
  });
});
