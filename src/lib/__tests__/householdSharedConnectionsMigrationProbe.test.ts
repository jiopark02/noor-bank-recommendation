import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that defines household_shared_connections,
 * the function that answers which bank connections another household member
 * shares with a person. It cannot run the SQL; it holds each condition whose
 * loss would return a row the person must not read, and the access the
 * function is given. Whether the file is applied and whether its DO block
 * passed are database behaviour, checked by running the file against a
 * database and calling the function, not here.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   the grant's household id dropped from either membership check, or the
 *     check compared with another household                         -> M1
 *   the revoked_at condition removed                                -> M2
 *   either membership check, or its status = 'active', removed       -> M3
 *   the grantee condition removed, or set on the owner instead       -> M4
 *   the owner-is-not-the-caller condition removed                    -> M4
 *   the connection status condition removed                         -> M5
 *   the join without the owner, or without the connection id         -> M5
 *   the resource type or scope condition removed                     -> M5
 *   security definer, a search_path other than empty, a volatility
 *     other than stable, or plpgsql                                  -> M6
 *   an EXECUTE grant to anyone but service_role, or the revoke from
 *     public, anon and authenticated removed                         -> M6
 *   a write, a lock, a table, a policy or a trigger added            -> M6
 *   a DO block check or its raise removed                            -> M6
 */

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");
const FILE = "20261123120000_household_shared_connections.sql";

const sql = readFileSync(path.join(MIGRATIONS, FILE), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");

const SIGNATURE = "public.household_shared_connections(uuid)";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The function's body, between its dollar quotes. */
function functionBody(): string {
  const start = sql.indexOf("create or replace function public.household_shared_connections(");
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

function functionHeader(): string {
  const start = sql.indexOf("create or replace function public.household_shared_connections(");
  expect(start).toBeGreaterThan(-1);
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

/** The where clause: everything after the join, up to the order by. */
function whereClause(): string {
  const body = functionBody();
  const where = body.indexOf("\n   where ");
  const order = body.indexOf("\n   order by ");
  expect(where).toBeGreaterThan(-1);
  expect(order).toBeGreaterThan(where);
  return body.slice(where, order);
}

const MEMBER = (person: "owner_user_id" | "grantee_user_id") =>
  "exists (\n       select 1\n         from public.household_members m\n" +
  "        where m.household_id = g.household_id\n" +
  `          and m.user_id = g.${person}\n` +
  "          and m.status = 'active'\n     )";

describe("household shared connections migration", () => {
  it("M1 both membership checks are read for the grant's own household", () => {
    const where = whereClause();
    expect(occurrences(where, "m.household_id = g.household_id")).toBe(2);
    expect(where).not.toMatch(/m\.household_id\s*(<>|!=|is distinct from)/i);
    expect(occurrences(where, "from public.household_members m")).toBe(2);
  });

  it("M2 a revoked grant returns no row", () => {
    expect(occurrences(whereClause(), "\n     and g.revoked_at is null\n")).toBe(1);
  });

  it("M3 a person who left, owner or grantee, returns no row", () => {
    const where = whereClause();
    expect(occurrences(where, MEMBER("owner_user_id"))).toBe(1);
    expect(occurrences(where, MEMBER("grantee_user_id"))).toBe(1);
    expect(occurrences(where, "m.status = 'active'")).toBe(2);
  });

  it("M4 only the grantee of the grant gets the row, never its owner", () => {
    const where = whereClause();
    expect(where.startsWith("\n   where g.grantee_user_id = p_user_id\n")).toBe(true);
    expect(occurrences(where, "\n     and g.owner_user_id <> p_user_id\n")).toBe(1);
    expect(where).not.toMatch(/g\.owner_user_id\s*=\s*p_user_id/);
    // p_user_id is compared with nothing else.
    expect(occurrences(functionBody(), "p_user_id")).toBe(2);
  });

  it("M5 only an active connection of the grant's owner, for a view grant of a connection", () => {
    const body = functionBody();
    expect(body).toContain(
      "\n    from public.share_grants g\n    join public.plaid_connections c\n      on c.user_id = g.owner_user_id\n     and c.id = g.resource_id\n"
    );
    const where = whereClause();
    expect(occurrences(where, "\n     and c.status = 'active'\n")).toBe(1);
    expect(occurrences(where, "\n     and g.resource_type = 'plaid_connection'\n")).toBe(1);
    expect(occurrences(where, "\n     and g.scope = 'view'\n")).toBe(1);
    expect(occurrences(body, " join ")).toBe(1);
    expect(body).not.toMatch(/\b(left|right|full|cross)\s+join\b/i);
  });

  it("M6 STABLE SQL, SECURITY INVOKER, empty search_path, only service_role executes it, nothing else changes, and the DO block checks each", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(functionHeader()).toBe(
      "create or replace function public.household_shared_connections(p_user_id uuid)\n" +
        "returns table (\n  owner_user_id uuid,\n  connection_id bigint,\n  item_id text,\n" +
        "  access_token text,\n  institution_name text\n)\n" +
        "language sql\nstable\nsecurity invoker\nset search_path = ''\n"
    );
    expect(sql).not.toMatch(/security definer/i);
    expect(sql.match(/create or replace function/gi)?.length).toBe(1);
    expect(sql).toContain(
      `revoke all on function ${SIGNATURE}\n  from public, anon, authenticated;`
    );
    expect(sql.match(/\bgrant\b[^;]*;/gi) ?? []).toEqual([
      `grant execute on function ${SIGNATURE} to service_role;`,
    ]);
    expect(sql).not.toMatch(
      /\b(insert into|update public|delete from|truncate|create table|alter table|create policy|create (or replace )?trigger|create (unique )?index|lock table|drop )\b/i
    );
    expect(functionBody()).not.toMatch(/\b(for update|for share|pg_advisory)/i);

    const block = closingDoBlock();
    const checks: Array<[string, RegExp]> = [
      ["client EXECUTE", /has_function_privilege\('anon', v_fn, 'EXECUTE'\)\n\s+or has_function_privilege\('authenticated', v_fn, 'EXECUTE'\) then\n\s+raise exception/],
      ["PUBLIC EXECUTE", /v_proacl is null\n\s+or exists \(select 1 from aclexplode\(v_proacl\) a where a\.grantee = 0\) then\n\s+raise exception/],
      ["invoker", /if v_prosecdef then\n\s+raise exception '%: expected SECURITY INVOKER'/],
      ["search_path", /'search_path=""' = any\(v_proconfig\)\) then\n\s+raise exception/],
      ["stable", /if v_provolatile <> 's' then\n\s+raise exception/],
      ["service_role EXECUTE", /if not has_function_privilege\('service_role', v_fn, 'EXECUTE'\) then\n\s+raise exception/],
      ["service_role SELECT", /if not has_table_privilege\('service_role', v_table, 'SELECT'\) then\n\s+raise exception/],
    ];
    for (const [label, pattern] of checks) {
      expect(block, label).toMatch(pattern);
    }
    expect(block).toContain(`'${SIGNATURE}'::regprocedure`);
    for (const table of ["share_grants", "household_members", "plaid_connections"]) {
      expect(block, table).toContain(`'public.${table}'::regclass`);
    }
    expect(occurrences(sql, "\ndo $$")).toBe(2);
  });

  it("M6 the preconditions run before the function is created", () => {
    const pre = sql.indexOf("\ndo $$");
    const create = sql.indexOf("create or replace function");
    expect(pre).toBeGreaterThan(-1);
    expect(pre).toBeLessThan(create);
    const block = sql.slice(pre, sql.indexOf("\n$$;", pre));
    expect(block).toMatch(/is distinct from 'uuid' then\n\s+raise exception/);
    expect(block).toMatch(/a\.attname = 'grantee_user_id'[\s\S]*?\) then\n\s+raise exception/);
  });
});
