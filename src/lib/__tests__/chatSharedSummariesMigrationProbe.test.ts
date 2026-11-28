import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that adds the summaries of the part of a chat
 * session that carries another household member's shared bank data: the two
 * tables, the state columns on chat_sessions, the one function that stores a
 * summary with its links, and the purge on share_grants extended to delete
 * such a summary when a grant ends. It cannot run the SQL; it holds the shape
 * of the tables and their access, the lock the saving function shares with
 * the purge, the order in which it locks and decides, the purge body being
 * the earlier body plus one statement, and the checks of the closing DO
 * block. Whether the file is applied and whether its DO block passed are
 * database behaviour, checked by running the file against a database, not
 * here.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   a foreign key added to the link's owner or connection, the link's
 *     foreign key no longer naming (id, user_id), or a cascade removed     -> M1
 *   UPDATE or DELETE on either table granted to service_role, a policy
 *     created, or row level security not enabled                           -> M1
 *   a state column or its check dropped, or the column grant to
 *     service_role removed or widened                                      -> M2
 *   the lock key changed, or no longer the same as the purge's             -> M3
 *   a later advisory lock taken by waiting instead of trying               -> M3
 *   a row lock taken by waiting (nowait removed), an open session
 *     accepted, or the session check without its owner                     -> M4
 *   the marks checked before the locks, or an insert moved before the
 *     checks, or the check for a mark beyond the pairs removed             -> M4
 *   the function writing anything but the two tables                       -> M4
 *   a line of the purge's earlier body changed or removed                  -> M5
 *   the purge's delete of summaries no longer limited to the grantee, or
 *     to the deleted grant's owner and connection                          -> M5
 *   security definer on the saving function, a search_path other than
 *     empty, EXECUTE granted to anyone but service_role, or EXECUTE on the
 *     purge function given to a role                                       -> M6
 *   a DO block check or its raise removed                                  -> M7
 *   a precondition removed, or moved after the first change                -> M8
 *   the removal of summaries without a grant dropped or moved              -> M8
 */

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");
const FILE = "20261128120000_chat_shared_summaries.sql";
const SOURCES_FILE = "20261122120000_chat_shared_sources.sql";
const TURN_SAVE_FILE = "20261124120000_chat_shared_turn_save.sql";

const normalize = (text: string): string => text.replace(/\r\n/g, "\n");
const strip = (text: string): string => normalize(text).replace(/--[^\n]*/g, "");

const raw = normalize(readFileSync(path.join(MIGRATIONS, FILE), "utf8"));
const sql = strip(raw);
const sourcesRaw = normalize(readFileSync(path.join(MIGRATIONS, SOURCES_FILE), "utf8"));
const turnSaveSql = strip(readFileSync(path.join(MIGRATIONS, TURN_SAVE_FILE), "utf8"));

const ARGS = "uuid, uuid, uuid[], bigint[], text, text[], integer, text";
const KEY =
  "'chat_shared_source:plaid_connection:' || v_owners[i]::text || ':' || v_resources[i]::text, 0";
const PURGE_HEAD =
  "create or replace function public.chat_shared_sources_purge_on_grant_delete()";
const SAVE_HEAD = "create or replace function public.chat_shared_summary_save(";

/** The statement this file adds to the purge function, with its comment. */
const PURGE_ADDED =
  "  -- Every summary of the grantee made from this connection, whatever\n" +
  "  -- session it belongs to. Its links go with it by their foreign key.\n" +
  "  delete from public.chat_shared_summaries x\n" +
  "   where x.user_id = old.grantee_user_id\n" +
  "     and exists (\n" +
  "           select 1\n" +
  "             from public.chat_shared_summary_sources l\n" +
  "            where l.summary_id = x.id\n" +
  "              and l.user_id = old.grantee_user_id\n" +
  "              and l.owner_user_id = old.owner_user_id\n" +
  "              and l.resource_type = old.resource_type\n" +
  "              and l.resource_id = old.resource_id\n" +
  "         );\n" +
  "\n";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A function's statement in `text`, from its head to the end of its body. */
function functionStatement(text: string, head: string): string {
  const start = text.indexOf(head);
  expect(start).toBeGreaterThan(-1);
  const open = text.indexOf("as $$", start);
  const close = text.indexOf("$$;", open + 5);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return text.slice(start, close + 3);
}

function bodyOf(statement: string): string {
  const open = statement.indexOf("as $$");
  return statement.slice(open + 5, statement.length - 3);
}

function saveBody(): string {
  return bodyOf(functionStatement(sql, SAVE_HEAD));
}

/** The closing DO block: the last one in the file. */
function closingDoBlock(): string {
  const start = sql.lastIndexOf("\ndo $$");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start + 6);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("chat shared summaries migration", () => {
  it("M1 creates the two tables with their keys, and gives service_role SELECT and INSERT only", () => {
    expect(sql).toContain(
      "create table if not exists public.chat_shared_summaries (\n" +
        "  id                  uuid primary key default gen_random_uuid(),\n" +
        "  session_id          uuid not null references public.chat_sessions(id) on delete cascade,\n" +
        "  user_id             uuid not null references public.users(id) on delete cascade,\n" +
        "  summary             text not null,\n" +
        "  topics              text[] not null default '{}',\n" +
        "  message_count       integer not null,\n" +
        "  generated_by_model  text,\n" +
        "  created_at          timestamptz not null default now(),\n" +
        "  constraint chat_shared_summaries_session_key unique (session_id),\n" +
        "  constraint chat_shared_summaries_id_user_key unique (id, user_id),\n" +
        "  constraint chat_shared_summaries_message_count_check check (message_count > 0)\n" +
        ");"
    );
    expect(sql).toContain(
      "create table if not exists public.chat_shared_summary_sources (\n" +
        "  id             uuid primary key default gen_random_uuid(),\n" +
        "  summary_id     uuid not null,\n" +
        "  user_id        uuid not null,\n" +
        "  owner_user_id  uuid not null,\n" +
        "  resource_type  text not null,\n" +
        "  resource_id    bigint not null,\n" +
        "  created_at     timestamptz not null default now(),\n" +
        "  constraint chat_shared_summary_sources_summary_fkey\n" +
        "    foreign key (summary_id, user_id)\n" +
        "    references public.chat_shared_summaries (id, user_id) on delete cascade,\n" +
        "  constraint chat_shared_summary_sources_resource_type_check check (resource_type = 'plaid_connection'),\n" +
        "  constraint chat_shared_summary_sources_owner_not_user check (owner_user_id <> user_id),\n" +
        "  constraint chat_shared_summary_sources_summary_source_key\n" +
        "    unique (summary_id, owner_user_id, resource_type, resource_id)\n" +
        ");"
    );
    expect(occurrences(sql, "create table")).toBe(2);
    // Three foreign keys in all: the summary's two and the link's one.
    expect(occurrences(sql.slice(0, sql.indexOf(SAVE_HEAD)), "references public.")).toBe(3);

    for (const table of ["chat_shared_summaries", "chat_shared_summary_sources"]) {
      expect(sql).toContain(
        `revoke all on table public.${table} from public, anon, authenticated;`
      );
      expect(sql).toContain(`revoke all on table public.${table} from service_role;`);
      expect(sql).toContain(`grant select, insert on table public.${table} to service_role;`);
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      // The revoke comes before the grant, or the grant would be taken back.
      expect(sql.indexOf(`revoke all on table public.${table} from service_role;`)).toBeLessThan(
        sql.indexOf(`grant select, insert on table public.${table} to service_role;`)
      );
    }
    // Every grant in the file: the two tables, the state columns, the function.
    expect(sql.match(/^grant [^;]*;/gm)).toHaveLength(4);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/create trigger/i);
    expect(sql).not.toMatch(/drop (table|trigger|index|type|function)/i);
  });

  it("M2 adds the state columns and their checks to chat_sessions, and grants service_role UPDATE on exactly those columns", () => {
    expect(sql).toContain(
      "alter table public.chat_sessions\n" +
        "  add column if not exists shared_summarized boolean not null default false,\n" +
        "  add column if not exists shared_summary_failures smallint not null default 0,\n" +
        "  add column if not exists shared_summary_next_attempt_at timestamptz,\n" +
        "  add column if not exists shared_summary_outcome text,\n" +
        "  add column if not exists shared_summary_given_up_reason text,\n" +
        "  add column if not exists shared_summary_given_up_at timestamptz,\n"
    );
    expect(sql).toContain(
      "  add constraint chat_sessions_shared_summary_failures_check\n" +
        "    check (shared_summary_failures >= 0),\n" +
        "  add constraint chat_sessions_shared_summary_outcome_check\n" +
        "    check (shared_summary_outcome in ('done', 'given_up')),\n" +
        "  add constraint chat_sessions_shared_summary_given_up_reason_check\n" +
        "    check (shared_summary_given_up_reason in ('output_unusable', 'input_rejected')),\n" +
        "  add constraint chat_sessions_shared_summary_given_up_pair_check\n" +
        "    check (\n" +
        "      (shared_summary_outcome is not distinct from 'given_up') = (shared_summary_given_up_reason is not null)\n" +
        "      and (shared_summary_given_up_reason is null) = (shared_summary_given_up_at is null)\n" +
        "    );"
    );
    expect(occurrences(sql, "add column")).toBe(6);
    expect(sql).toContain(
      "grant update (\n" +
        "  shared_summarized,\n" +
        "  shared_summary_failures,\n" +
        "  shared_summary_next_attempt_at,\n" +
        "  shared_summary_outcome,\n" +
        "  shared_summary_given_up_reason,\n" +
        "  shared_summary_given_up_at\n" +
        ") on table public.chat_sessions to service_role;"
    );
    expect(occurrences(sql, "grant update")).toBe(1);

    // The closing check asserts the grant for every added column.
    const block = closingDoBlock();
    expect(block).toMatch(
      /v_columns text\[\] := array\[\s*'shared_summarized',\s*'shared_summary_failures',\s*'shared_summary_next_attempt_at',\s*'shared_summary_outcome',\s*'shared_summary_given_up_reason',\s*'shared_summary_given_up_at'\s*\];/
    );
    expect(block).toMatch(
      /for v_i in 1 \.\. cardinality\(v_columns\) loop\s+if not has_column_privilege\('service_role', 'public\.chat_sessions', v_columns\[v_i\], 'UPDATE'\) then\s+raise exception 'chat_sessions: service_role lacks UPDATE on %', v_columns\[v_i\];/
    );
    expect(block).toMatch(
      /has_column_privilege\('anon', 'public\.chat_sessions', v_columns\[v_i\], 'UPDATE'\)\s+or has_column_privilege\('authenticated', 'public\.chat_sessions', v_columns\[v_i\], 'UPDATE'\) then\s+raise exception/
    );
  });

  it("M3 takes the purge's lock for each pair, waiting only for the first", () => {
    const body = saveBody();
    // The purge keys its lock by resource type, owner and connection; the
    // only resource type is 'plaid_connection', so the keys are the same.
    expect(functionStatement(sql, PURGE_HEAD)).toContain(
      "'chat_shared_source:' || old.resource_type || ':' || old.owner_user_id::text || ':' || old.resource_id::text, 0"
    );
    // And the same key the turn-saving function takes.
    expect(turnSaveSql).toContain(KEY);
    expect(occurrences(body, KEY)).toBe(2);
    expect(occurrences(body, "pg_catalog.hashtextextended(")).toBe(2);
    expect(body).toMatch(
      /if i = 1 then\n\s+begin\n\s+perform pg_catalog\.pg_advisory_xact_lock\(\n\s+pg_catalog\.hashtextextended\([^;]*\)\);\n\s+exception when sqlstate '55P03' then\n\s+return 'busy';\n\s+end;/
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

  it("M4 after every advisory lock, locks the rows without waiting, accepts only the person's closed session, and writes only after the marks are checked", () => {
    const body = saveBody();
    const lastLock = body.indexOf("end loop;");
    const unavailable = body.indexOf("return 'session_unavailable';");
    const exists = body.indexOf("return 'exists';");
    const gone = body.indexOf("return 'source_gone';");
    const goneAgain = body.lastIndexOf("return 'source_gone';");
    const firstInsert = body.indexOf("insert into ");
    expect(lastLock).toBeGreaterThan(body.indexOf("pg_try_advisory_xact_lock("));
    expect(body).toContain(
      "  begin\n    perform 1\n       from public.chat_sessions c\n" +
        "      where c.id = p_session_id\n        and c.user_id = p_user_id\n" +
        "        and c.ended_at is not null\n        for key share nowait;\n" +
        "    v_closed := found;\n    if v_closed then\n      perform 1\n" +
        "         from public.users u\n        where u.id = p_user_id\n" +
        "          for key share nowait;\n      v_closed := found;\n    end if;\n" +
        "  exception when sqlstate '55P03' then\n    return 'busy';\n  end;\n" +
        "  if not v_closed then\n    return 'session_unavailable';\n  end if;"
    );
    expect(body.indexOf("from public.chat_sessions c")).toBeGreaterThan(lastLock);
    expect(unavailable).toBeGreaterThan(lastLock);
    expect(exists).toBeGreaterThan(unavailable);
    expect(gone).toBeGreaterThan(exists);
    expect(goneAgain).toBeGreaterThan(gone);
    expect(firstInsert).toBeGreaterThan(goneAgain);
    // These two are the only row locks, and neither waits.
    expect(body.match(/\bfor (no key update|update|share|key share)\b[^;]*;/gi)).toEqual([
      "for key share nowait;",
      "for key share nowait;",
    ]);
    expect(occurrences(body, "'busy'")).toBe(3);

    // Every pair must still be marked on the session, for this person.
    expect(body).toContain(
      "         from public.chat_shared_sources m\n" +
        "        where m.session_id = p_session_id\n" +
        "          and m.user_id = p_user_id\n" +
        "          and m.resource_type = 'plaid_connection'\n" +
        "          and m.owner_user_id = k.owner_user_id\n" +
        "          and m.resource_id = k.resource_id"
    );
    // And the session carries no mark beyond the pairs.
    expect(body).toContain(
      "      from public.chat_shared_sources m\n" +
        "     where m.session_id = p_session_id\n" +
        "       and not exists ("
    );

    // It writes the two tables and nothing else, and never reads the grants
    // itself: the marks stand for them under the lock.
    expect(body.match(/insert into public\.[a-z_]+/g)).toEqual([
      "insert into public.chat_shared_summaries",
      "insert into public.chat_shared_summary_sources",
    ]);
    expect(body).not.toMatch(/update public\./);
    expect(body).not.toMatch(/delete from/);
    expect(body).not.toContain("share_grants");
    expect(body).toContain(
      "  select v_summary_id, p_user_id, k.owner_user_id, 'plaid_connection', k.resource_id\n" +
        "    from unnest(v_owners, v_resources) as k(owner_user_id, resource_id);"
    );
  });

  it("M5 the purge function is its earlier definition with one statement added, limited to the grantee and the deleted grant's connection", () => {
    // Compared with comments kept, line for line: nothing of the earlier
    // definition is changed, and what is added is exactly PURGE_ADDED.
    const earlier = functionStatement(sourcesRaw, PURGE_HEAD);
    const now = functionStatement(raw, PURGE_HEAD);
    expect(occurrences(now, PURGE_ADDED)).toBe(1);
    expect(now.replace(PURGE_ADDED, "")).toBe(earlier);
    // It is added after the loop over the marks and before the return.
    expect(now.indexOf(PURGE_ADDED)).toBeGreaterThan(now.indexOf("  end loop;\n"));
    expect(now.slice(now.indexOf(PURGE_ADDED) + PURGE_ADDED.length)).toBe(
      "  return null;\nend;\n$$;"
    );
    // The earlier writes, in order, then the new one.
    expect(bodyOf(now).match(/(delete from|update) public\.[a-z_]+/g)).toEqual([
      "delete from public.chat_messages",
      "update public.chat_sessions",
      "delete from public.chat_shared_sources",
      "delete from public.chat_shared_summaries",
    ]);
    expect(sql).toContain(
      "revoke all on function public.chat_shared_sources_purge_on_grant_delete()\n" +
        "  from public, anon, authenticated, service_role;"
    );
  });

  it("M6 the saving function is SECURITY INVOKER with an empty search_path and its own lock_timeout, executable by service_role only", () => {
    const statement = functionStatement(sql, SAVE_HEAD);
    expect(statement.slice(0, statement.indexOf("as $$"))).toBe(
      "create or replace function public.chat_shared_summary_save(\n" +
        "  p_session_id uuid,\n" +
        "  p_user_id uuid,\n" +
        "  p_owner_user_ids uuid[],\n" +
        "  p_resource_ids bigint[],\n" +
        "  p_summary text,\n" +
        "  p_topics text[],\n" +
        "  p_message_count integer,\n" +
        "  p_model text\n" +
        ")\n" +
        "returns text\n" +
        "language plpgsql\n" +
        "volatile\n" +
        "security invoker\n" +
        "set search_path = ''\n" +
        "set lock_timeout = '1s'\n"
    );
    expect(sql).toContain(
      `revoke all on function public.chat_shared_summary_save(\n  ${ARGS})\n  from public, anon, authenticated;`
    );
    expect(sql).toContain(
      `grant execute on function public.chat_shared_summary_save(\n  ${ARGS})\n  to service_role;`
    );
    expect(occurrences(sql, "grant execute")).toBe(1);
    expect(occurrences(sql, "create or replace function")).toBe(2);
    expect(occurrences(sql, "security definer")).toBe(1);
  });

  it("M7 the closing DO block checks the end state and raises", () => {
    const block = closingDoBlock();
    const checks: RegExp[] = [
      /foreach v_table in array array\[v_summaries, v_links\] loop/,
      /if v_remaining is not null then\s+raise exception '%: client roles still hold privileges: %'/,
      /a\.grantee = 0\s+\) then\s+raise exception '%: PUBLIC still holds a table privilege'/,
      /if v_rls is distinct from true then\s+raise exception '%: row level security is not enabled'/,
      /if v_policies <> 0 then\s+raise exception '%: expected no policies, found %'/,
      /\(p\.privilege = any\(array\['SELECT', 'INSERT'\]\)\)\s+<> has_table_privilege\('service_role', v_table, p\.privilege\)/,
      /raise exception '%: service_role privileges differ from SELECT, INSERT at: %'/,
      /if has_any_column_privilege\('service_role', v_table, 'UPDATE,REFERENCES'\) then\s+raise exception/,
      /raise exception '%: the table owner lacks DELETE'/,
      /and not t\.tgisinternal\s+\) then\s+raise exception '%: carries a trigger'/,
      /\('public\.chat_shared_summary_sources', array\['summary_id', 'user_id'\], 'public\.chat_shared_summaries', array\['id', 'user_id'\]\)/,
      /and k\.confdeltype = 'c'/,
      /if not v_ok then\s+raise exception '%: % does not reference %\(%\) with on delete cascade'/,
      /if v_count <> 2 then\s+raise exception '%: expected two foreign keys, found %'/,
      /if v_count <> 1 then\s+raise exception '%: expected one foreign key, found %'/,
      /raise exception '%: no unique constraint chat_shared_summaries_session_key on \(session_id\)'/,
      /raise exception 'chat_sessions: column % is missing'/,
      /raise exception 'chat_sessions: column % is of type %, expected %'/,
      /raise exception 'chat_sessions: column % defaults to %, expected %'/,
      /raise exception 'chat_sessions: check % is missing'/,
      /if v_definition is distinct from v_definitions\[v_i\] then\s+raise exception/,
      /raise exception '%: anon or authenticated still holds EXECUTE', v_fn/,
      /raise exception '%: PUBLIC still holds EXECUTE', v_fn/,
      /if v_prosecdef then\s+raise exception '%: expected SECURITY INVOKER', v_fn/,
      /raise exception '%: expected an empty search_path, found %', v_fn/,
      /if not \('lock_timeout=1s' = any\(v_proconfig\)\) then\s+raise exception/,
      /if not has_function_privilege\('service_role', v_fn, 'EXECUTE'\) then\s+raise exception/,
      /raise exception '%: service_role lacks SELECT on %', v_fn, v_rel/,
      /raise exception '%: service_role lacks UPDATE on chat_sessions, which locking its row needs'/,
      /raise exception '%: service_role lacks UPDATE on users, which locking its row needs'/,
      /raise exception '%: does not lock with the purge''s key', v_fn/,
      /\/ length\('for key share nowait'\) <> 2 then\s+raise exception '%: a row lock may be waited for'/,
      /\/ length\('exception when sqlstate ''55P03'' then'\) <> 2 then\s+raise exception/,
      /if v_prosecdef is distinct from true then\s+raise exception '%: expected SECURITY DEFINER', v_purge/,
      /raise exception '%: a role other than its owner holds EXECUTE', v_purge/,
      /if has_function_privilege\('service_role', v_purge, 'EXECUTE'\) then\s+raise exception/,
      /position\('delete from public\.chat_shared_summaries x' in v_purge_src\) = 0 then\s+raise exception/,
      /'public\.chat_shared_summaries'::regclass,\s+'public\.chat_shared_summary_sources'::regclass\s+\];/,
      /raise exception '%: not owned by the owner of %', v_purge, v_rel/,
      /raise exception '%: row level security is forced on its owner', v_rel/,
      /if not has_table_privilege\(v_proowner, v_summaries, 'DELETE'\) then\s+raise exception/,
      /and t\.tgfoid = v_purge\s+and t\.tgenabled = 'O'\s+and t\.tgtype = 9/,
      /raise exception 'public\.share_grants: expected only the enabled AFTER DELETE row trigger/,
      /if v_count <> 0 then\s+raise exception '%: % rows have no link or a link with no share grant'/,
      /if v_answer is distinct from 'session_unavailable' then\s+raise exception/,
      /raise exception '%: wrote a row for a refused call', v_fn/,
      /raise exception '%: accepted a pair owned by the person', v_fn;\s+exception when sqlstate '22023' then/,
      /raise exception '%: accepted pair arrays of different lengths', v_fn;\s+exception when sqlstate '22023' then/,
      /raise exception '%: accepted a call without a pair', v_fn;\s+exception when sqlstate '22023' then/,
    ];
    for (const check of checks) {
      expect(block, String(check)).toMatch(check);
    }
    expect(occurrences(sql, "\ndo $$")).toBe(2);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("M8 checks what it needs before it changes anything, and removes summaries without a grant just before the closing check", () => {
    const precondition = sql.indexOf("\ndo $$");
    const firstCreate = sql.indexOf("create table");
    expect(sql.indexOf("begin;")).toBeLessThan(precondition);
    expect(sql.indexOf("lock table public.share_grants in share row exclusive mode;")).toBeLessThan(
      precondition
    );
    expect(precondition).toBeLessThan(firstCreate);
    const first = sql.slice(precondition, firstCreate);
    expect(first).toMatch(/to_regclass\('public\.chat_shared_sources'\) is null then\s+raise exception/);
    expect(first).toMatch(/t\.tgname = 'trg_share_grants_purge_chat'\s+and t\.tgenabled = 'O'\s+and t\.tgtype = 9\s+\) then\s+raise exception/);
    expect(first).toMatch(/to_regprocedure\('public\.chat_shared_turn_save\([^']*\)'\) is null then\s+raise exception/);
    expect(first).toMatch(/a\.attname = 'summary_outcome'[\s\S]*?\) then\s+raise exception/);

    const cleanup =
      "delete from public.chat_shared_summaries x\n" +
      " where not exists (\n" +
      "         select 1\n" +
      "           from public.chat_shared_summary_sources l\n" +
      "          where l.summary_id = x.id\n" +
      "       )\n" +
      "    or exists (\n" +
      "         select 1\n" +
      "           from public.chat_shared_summary_sources l\n" +
      "          where l.summary_id = x.id\n" +
      "            and not exists (\n" +
      "                  select 1\n" +
      "                    from public.share_grants g\n" +
      "                   where g.owner_user_id = l.owner_user_id\n" +
      "                     and g.resource_type = l.resource_type\n" +
      "                     and g.resource_id = l.resource_id\n" +
      "                     and g.grantee_user_id = l.user_id\n" +
      "                )\n" +
      "       );";
    expect(occurrences(sql, cleanup)).toBe(1);
    const purgeEnd = sql.indexOf(PURGE_HEAD);
    expect(sql.indexOf(cleanup)).toBeGreaterThan(purgeEnd);
    expect(sql.indexOf(cleanup)).toBeLessThan(sql.lastIndexOf("\ndo $$"));
  });
});
