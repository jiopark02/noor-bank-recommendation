import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that defines chat_shared_turn_save, the one
 * function that stores a chat turn whose prompt carried bank data another
 * household member shares, together with the mark the purge and the memory
 * jobs decide on. It cannot run the SQL; it holds the lock the function shares
 * with the purge, the order in which it locks and decides, the single moment
 * it writes, the access it is given and the checks of the closing DO block.
 * Whether the file is applied and whether its DO block passed are database
 * behaviour, checked by running the file against a database, not here.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   the lock key changed, or no longer the same as the purge's            -> S1
 *   a later lock taken by waiting instead of trying                       -> S1
 *   the session or sharing check moved before the advisory locks          -> S2
 *   the session row or the users row locked by waiting (nowait removed),
 *     or either lock removed, or a held row not answered 'busy'           -> S2
 *   the sharing check made before the row locks, or through anything but
 *     household_shared_connections, or the session check without its owner
 *     or open condition                                                   -> S2
 *   the clock read before the locks, or the moment taken from an argument -> S3
 *   the earliest moment no longer kept                                    -> S3
 *   the two messages inserted by two statements, or the user's
 *     created_at not the recorded moment                                  -> S3
 *   security definer, a search_path other than empty, a volatility other
 *     than volatile, or EXECUTE granted to anyone but service_role         -> S4
 *   the recording function this file replaces no longer dropped           -> S4
 *   a DO block check or its raise removed                                 -> S5
 *   a precondition removed, or moved after the function is created        -> S6
 */

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");
const FILE = "20261124120000_chat_shared_turn_save.sql";
const PURGE_FILE = "20261122120000_chat_shared_sources.sql";

const strip = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");

const sql = strip(readFileSync(path.join(MIGRATIONS, FILE), "utf8"));
const purgeSql = strip(readFileSync(path.join(MIGRATIONS, PURGE_FILE), "utf8"));

const ARGS =
  "uuid, uuid, uuid[], bigint[], uuid, uuid, text, text, text, integer, integer";
const KEY = "'chat_shared_source:plaid_connection:' || v_owners[i]::text || ':' || v_resources[i]::text, 0";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The function's body, between its dollar quotes. */
function functionBody(): string {
  const start = sql.indexOf("create or replace function public.chat_shared_turn_save(");
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

function functionHeader(): string {
  const start = sql.indexOf("create or replace function public.chat_shared_turn_save(");
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

describe("chat shared turn save migration", () => {
  it("S1 takes the purge's lock for each pair, waiting only for the first", () => {
    const body = functionBody();
    // The purge keys its lock by resource type, owner and connection; the
    // only resource type is 'plaid_connection', so the keys are the same.
    expect(purgeSql).toContain(
      "'chat_shared_source:' || old.resource_type || ':' || old.owner_user_id::text || ':' || old.resource_id::text, 0"
    );
    expect(occurrences(body, KEY)).toBe(2);
    expect(occurrences(body, "pg_catalog.hashtextextended(")).toBe(2);
    expect(body).toMatch(
      /if i = 1 then\n\s+perform pg_catalog\.pg_advisory_xact_lock\(\n\s+pg_catalog\.hashtextextended\(/
    );
    expect(body).toMatch(
      /elsif not pg_catalog\.pg_try_advisory_xact_lock\(\n\s+pg_catalog\.hashtextextended\([^;]*\)\) then\n\s+return 'busy';/
    );
    expect(occurrences(body, "pg_advisory_xact_lock(")).toBe(1);
    expect(occurrences(body, "pg_try_advisory_xact_lock(")).toBe(1);
    // The pairs are deduplicated and sorted before any lock.
    expect(body).toContain("order by k.owner_user_id, k.resource_id");
    expect(body.indexOf("select distinct u.owner_user_id, u.resource_id")).toBeLessThan(
      body.indexOf("pg_advisory_xact_lock(")
    );
  });

  it("S2 after every advisory lock, locks the session and users rows without waiting, answers a held row 'busy', and decides only then", () => {
    const body = functionBody();
    const lastLock = body.indexOf("end loop;");
    const session = body.indexOf("from public.chat_sessions c");
    const users = body.indexOf("from public.users u");
    const busy = body.indexOf("exception when sqlstate '55P03' then");
    const closed = body.indexOf("return 'session_closed';");
    const shared = body.indexOf("from public.household_shared_connections(p_user_id) s");
    expect(lastLock).toBeGreaterThan(body.indexOf("pg_try_advisory_xact_lock("));
    expect(session).toBeGreaterThan(lastLock);
    expect(users).toBeGreaterThan(session);
    expect(busy).toBeGreaterThan(users);
    expect(closed).toBeGreaterThan(busy);
    expect(shared).toBeGreaterThan(closed);
    expect(body).toContain(
      "  begin\n    perform 1\n       from public.chat_sessions c\n" +
        "      where c.id = p_session_id\n        and c.user_id = p_user_id\n" +
        "        and c.ended_at is null\n        for no key update nowait;\n" +
        "    v_open := found;\n    if v_open then\n      perform 1\n" +
        "         from public.users u\n        where u.id = p_user_id\n" +
        "          for key share nowait;\n      v_open := found;\n    end if;\n" +
        "  exception when sqlstate '55P03' then\n    return 'busy';\n  end;\n" +
        "  if not v_open then\n    return 'session_closed';\n  end if;"
    );
    // These two are the only row locks, and neither waits.
    expect(body.match(/\bfor (no key update|update|share|key share)\b[^;]*;/gi)).toEqual([
      "for no key update nowait;",
      "for key share nowait;",
    ]);
    expect(occurrences(body, "return 'busy';")).toBe(2);
    expect(body).toContain(
      "where s.owner_user_id = k.owner_user_id\n          and s.connection_id = k.resource_id\n     )\n  ) then\n    return 'not_shared';"
    );
    // The grant is decided only by the shared-connections function.
    expect(body).not.toMatch(/\b(share_grants|household_members|plaid_connections)\b/);
    // A pair owned by the person is refused before anything else.
    expect(body).toContain("or k.owner_user_id = p_user_id");
    expect(body.indexOf("or k.owner_user_id = p_user_id")).toBeLessThan(
      body.indexOf("pg_advisory_xact_lock(")
    );
  });

  it("S3 writes one moment, read under the locks, to the mark and the user message, in one insert of both messages", () => {
    const body = functionBody();
    const clock = body.indexOf("v_now := pg_catalog.clock_timestamp();");
    expect(clock).toBeGreaterThan(body.indexOf("return 'not_shared';"));
    expect(occurrences(body, "v_now :=")).toBe(1);
    expect(body).not.toMatch(/\bnow\(\)|current_timestamp|transaction_timestamp|statement_timestamp/i);
    expect(functionHeader()).not.toMatch(/timestamptz/);

    const sources = body.indexOf("insert into public.chat_shared_sources as s");
    const messages = body.indexOf("insert into public.chat_messages");
    expect(sources).toBeGreaterThan(clock);
    expect(messages).toBeGreaterThan(sources);
    expect(body).toContain(
      "select p_session_id, p_user_id, k.owner_user_id, 'plaid_connection', k.resource_id, v_now\n"
    );
    expect(body).toContain(
      "on conflict on constraint chat_shared_sources_session_source_key\n  do update set first_shared_at = least(s.first_shared_at, excluded.first_shared_at);"
    );
    expect(occurrences(body, "insert into public.chat_messages")).toBe(1);
    expect(body).toContain(
      "(p_user_message_id, p_session_id, p_user_id, 'user', p_user_content,\n     null, null, null, v_now),"
    );
    expect(body).toContain("v_now + pg_catalog.make_interval(secs => 0.1));");
    expect(body.trimEnd().endsWith("return 'saved';\nend;")).toBe(true);
    // Nothing is updated or deleted directly.
    expect(body).not.toMatch(/\b(update public|delete from)\b/i);
  });

  it("S4 VOLATILE plpgsql, SECURITY INVOKER, empty search_path, only service_role executes it, and the recording function is dropped", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(functionHeader()).toBe(
      "create or replace function public.chat_shared_turn_save(\n" +
        "  p_session_id uuid,\n  p_user_id uuid,\n  p_owner_user_ids uuid[],\n" +
        "  p_resource_ids bigint[],\n  p_user_message_id uuid,\n  p_assistant_message_id uuid,\n" +
        "  p_user_content text,\n  p_assistant_content text,\n  p_model text,\n" +
        "  p_input_tokens integer,\n  p_output_tokens integer\n)\n" +
        "returns text\nlanguage plpgsql\nvolatile\nsecurity invoker\nset search_path = ''\n"
    );
    expect(sql).not.toMatch(/security definer/i);
    expect(sql.match(/create or replace function/gi)?.length).toBe(1);
    expect(sql).toContain(
      `revoke all on function public.chat_shared_turn_save(\n  ${ARGS})\n  from public, anon, authenticated;`
    );
    expect(sql.match(/\bgrant\b[^;]*;/gi) ?? []).toEqual([
      `grant execute on function public.chat_shared_turn_save(\n  ${ARGS})\n  to service_role;`,
    ]);
    expect(sql.match(/\bdrop\b[^;]*;/gi) ?? []).toEqual([
      "drop function if exists public.chat_shared_source_record(uuid, uuid, uuid, bigint, timestamptz);",
    ]);
    expect(sql).not.toMatch(
      /\b(truncate|create table|alter table|create policy|create (or replace )?trigger|create (unique )?index|lock table)\b/i
    );
  });

  it("S5 the closing DO block checks every property, calls the function with refused arguments, and raises on each", () => {
    const block = closingDoBlock();
    expect(block).toContain(`'public.chat_shared_turn_save(${ARGS})'::regprocedure`);
    const checks: Array<[string, RegExp]> = [
      ["client EXECUTE", /has_function_privilege\('anon', v_fn, 'EXECUTE'\)\n\s+or has_function_privilege\('authenticated', v_fn, 'EXECUTE'\) then\n\s+raise exception/],
      ["PUBLIC EXECUTE", /v_proacl is null\n\s+or exists \(select 1 from aclexplode\(v_proacl\) a where a\.grantee = 0\) then\n\s+raise exception/],
      ["invoker", /if v_prosecdef then\n\s+raise exception '%: expected SECURITY INVOKER'/],
      ["search_path", /'search_path=""' = any\(v_proconfig\)\) then\n\s+raise exception/],
      ["volatile", /if v_provolatile <> 'v' then\n\s+raise exception/],
      ["service_role EXECUTE", /if not has_function_privilege\('service_role', v_fn, 'EXECUTE'\) then\n\s+raise exception/],
      ["shared connections EXECUTE", /has_function_privilege\('service_role', 'public\.household_shared_connections\(uuid\)'::regprocedure, 'EXECUTE'\) then\n\s+raise exception/],
      ["messages INSERT", /has_table_privilege\('service_role', 'public\.chat_messages'::regclass, 'INSERT'\) then\n\s+raise exception/],
      ["SELECT", /if not has_table_privilege\('service_role', v_table, 'SELECT'\) then\n\s+raise exception/],
      ["sources INSERT", /has_table_privilege\('service_role', 'public\.chat_shared_sources'::regclass, 'INSERT'\) then\n\s+raise exception/],
      ["moment UPDATE", /has_column_privilege\('service_role', 'public\.chat_shared_sources'::regclass, 'first_shared_at', 'UPDATE'\) then\n\s+raise exception/],
      ["sessions UPDATE", /has_table_privilege\('service_role', 'public\.chat_sessions'::regclass, 'UPDATE'\) then\n\s+raise exception/],
      ["users SELECT", /'public\.chat_shared_sources'::regclass,\n\s+'public\.users'::regclass\n\s+\] loop\n\s+if not has_table_privilege\('service_role', v_table, 'SELECT'\)/],
      ["users UPDATE", /has_table_privilege\('service_role', 'public\.users'::regclass, 'UPDATE'\) then\n\s+raise exception/],
      ["row locks never wait", /position\('for no key update nowait' in v_prosrc\) = 0\n\s+or position\('for key share nowait' in v_prosrc\) = 0\n\s+or position\('exception when sqlstate ''55P03'' then' in v_prosrc\) = 0 then\n\s+raise exception/],
      ["lock key", /position\('''chat_shared_source:plaid_connection:''' in v_prosrc\) = 0 then\n\s+raise exception/],
      ["purge key", /position\('''chat_shared_source:''' in \([\s\S]*?\)\) = 0 then\n\s+raise exception/],
      ["purge trigger", /t\.tgfoid = v_purge\n\s+and t\.tgenabled = 'O'\n\s+and t\.tgtype = 9\n\s+\) then\n\s+raise exception/],
      ["recording function gone", /to_regprocedure\('public\.chat_shared_source_record\(uuid, uuid, uuid, bigint, timestamptz\)'\) is not null then\n\s+raise exception/],
      ["unknown session", /if v_answer is distinct from 'session_closed' then\n\s+raise exception/],
      ["no rows written", /where s\.session_id = v_session\n\s+\) then\n\s+raise exception '%: wrote rows for a refused call'/],
      ["owner is the person", /array\[v_user\], array\[1::bigint\],[\s\S]*?raise exception '%: accepted a pair owned by the person', v_fn;\n\s+exception when sqlstate '22023' then/],
      ["arrays of different lengths", /array\[v_owner\], array\[1::bigint, 2::bigint\],[\s\S]*?raise exception '%: accepted pair arrays of different lengths', v_fn;\n\s+exception when sqlstate '22023' then/],
    ];
    for (const [label, pattern] of checks) {
      expect(block, label).toMatch(pattern);
    }
    expect(occurrences(sql, "\ndo $$")).toBe(2);
  });

  it("S6 the preconditions run before the function is created", () => {
    const pre = sql.indexOf("\ndo $$");
    const create = sql.indexOf("create or replace function");
    expect(pre).toBeGreaterThan(-1);
    expect(pre).toBeLessThan(create);
    const block = sql.slice(pre, sql.indexOf("\n$$;", pre));
    expect(block).toMatch(/to_regclass\('public\.chat_shared_sources'\) is null then\n\s+raise exception/);
    expect(block).toMatch(/k\.conname = 'chat_shared_sources_session_source_key'[\s\S]*?\) then\n\s+raise exception/);
    expect(block).toMatch(/t\.tgname = 'trg_share_grants_purge_chat'\n\s+and t\.tgenabled = 'O'\n\s+and t\.tgtype = 9\n\s+\) then\n\s+raise exception/);
    expect(block).toMatch(/to_regprocedure\('public\.household_shared_connections\(uuid\)'\) is null then\n\s+raise exception/);
    expect(block).toMatch(/p\.prosrc like '%NR001%'\n\s+\) then\n\s+raise exception/);
  });
});
