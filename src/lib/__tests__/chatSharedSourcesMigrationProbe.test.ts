import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the chat shared sources migration. It cannot run the SQL;
 * it holds the lines whose loss would let a source row be removed before the
 * purge trigger reads it, let the recording function write without a grant
 * or decide before it holds the lock, let the purge delete messages from
 * before the recorded moment or of someone other than the grantee, or let
 * the purge run with the privileges of whoever issued the delete. Whether
 * the file is applied, whether its DO block passed, whether a cascaded
 * delete fires the trigger and how the functions behave under concurrency
 * are database behaviour, checked by running the file against a database,
 * not here.
 *
 * SQL line comments are stripped first, so a sentence in the header cannot
 * stand in for a statement.
 *
 * Mutations and the test each one turns red:
 *   a foreign key added on the owner or the connection                -> C1
 *   on delete cascade removed from the session or user foreign key    -> C1
 *   a grant of delete, or of update beyond first_shared_at            -> C1
 *   a revoke, the row level security line removed, or a policy added  -> C1
 *   the unique constraint's columns changed                           -> C1
 *   a read in the recording function moved above its lock             -> C2
 *   the session check without the owner or without the open condition -> C2
 *   a grant condition dropped (owner, type, connection, grantee,
 *     not revoked, either membership)                                 -> C2
 *   the stored moment replaced on conflict instead of the earlier one -> C2
 *   the bound on a past moment, or the cap on a future one, removed   -> C2
 *   the purge function changed to security invoker                    -> C3
 *   the purge deleting from before the moment (>= changed to >), or
 *     without the session or the user condition                       -> C3
 *   the grantee condition dropped from the purge                      -> C3
 *   the session lock removed or moved after the delete                -> C3
 *   the two functions locking on different keys                       -> C3
 *   EXECUTE on the purge function left to service_role                -> C3
 *   the trigger on another event, before, or per statement            -> C4
 *   the trigger named or defined differently from what the share
 *     grants file accepts                                             -> C4
 *   a DO block check or its raise removed                             -> C5
 *   the cleanup of rows without a grant removed, moved after the DO
 *     block, or without its moment condition                          -> C6
 *   the precondition or the table lock removed                        -> C6
 */

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");

function readSql(file: string): string {
  return readFileSync(path.join(MIGRATIONS, file), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/--[^\n]*/g, "");
}

const sql = readSql("20261122120000_chat_shared_sources.sql");
const shareSql = readSql("20261121120000_household_share_grants.sql");

const TABLE = "chat_shared_sources";
const RECORD = "chat_shared_source_record";
const RECORD_ARGS = "uuid, uuid, uuid, bigint, timestamptz";
const PURGE = "chat_shared_sources_purge_on_grant_delete";
const TRIGGER = "trg_share_grants_purge_chat";

const RECORD_LOCK =
  "pg_catalog.hashtextextended(\n      'chat_shared_source:plaid_connection:' || p_owner_user_id::text || ':' || p_resource_id::text, 0));";
const PURGE_LOCK =
  "pg_catalog.hashtextextended(\n      'chat_shared_source:' || old.resource_type || ':' || old.owner_user_id::text || ':' || old.resource_id::text, 0));";

const SOURCE_MATCH = (indent: string) =>
  `where s.owner_user_id = old.owner_user_id\n${indent}and s.resource_type = old.resource_type\n${indent}and s.resource_id = old.resource_id\n${indent}and s.user_id = old.grantee_user_id\n`;

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  expect(open, name).toBeGreaterThan(start);
  expect(close, name).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

function functionHeader(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
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

function at(body: string, needle: string, label: string): number {
  const i = body.indexOf(needle);
  expect(i, `${label}: ${needle}`).toBeGreaterThan(-1);
  return i;
}

describe("chat shared sources migration", () => {
  it("C1 the table: no foreign key on the owner or the connection, closed to client roles, service_role inserts and may update only the moment", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql.match(/\bcreate table\b/gi)?.length).toBe(1);
    const head = `create table if not exists public.${TABLE} (`;
    const start = at(sql, head, "table");
    const table = sql.slice(start, sql.indexOf("\n);", start) + 3);
    expect(table).toBe(
      [
        head,
        "  id               uuid primary key default gen_random_uuid(),",
        "  session_id       uuid not null references public.chat_sessions(id) on delete cascade,",
        "  user_id          uuid not null references public.users(id) on delete cascade,",
        "  owner_user_id    uuid not null,",
        "  resource_type    text not null,",
        "  resource_id      bigint not null,",
        "  first_shared_at  timestamptz not null,",
        "  created_at       timestamptz not null default now(),",
        "  constraint chat_shared_sources_resource_type_check check (resource_type = 'plaid_connection'),",
        "  constraint chat_shared_sources_owner_not_user check (owner_user_id <> user_id),",
        "  constraint chat_shared_sources_session_source_key",
        "    unique (session_id, owner_user_id, resource_type, resource_id)",
        ");",
      ].join("\n")
    );
    // Outside the table definition nothing adds a key: no alter table adds a
    // constraint, and the only "references" are the two above.
    expect(sql.match(/\breferences\s+public\./gi)?.length).toBe(2);
    expect(sql).not.toMatch(/\bforeign key\b/i);
    expect(sql).not.toMatch(/\badd constraint\b/i);

    const clients = at(
      sql,
      `revoke all on table public.${TABLE} from public, anon, authenticated;`,
      "revoke"
    );
    const service = at(sql, `revoke all on table public.${TABLE} from service_role;`, "revoke");
    expect(service).toBeGreaterThan(clients);
    const tableGrants = sql.match(/\bgrant\s+[^;]*\bon table\b[^;]*;/gi) ?? [];
    expect(tableGrants).toEqual([
      `grant select, insert on table public.${TABLE} to service_role;`,
      `grant update (first_shared_at) on table public.${TABLE} to service_role;`,
    ]);
    expect(sql.indexOf(tableGrants[0])).toBeGreaterThan(service);
    expect(sql).toContain(`alter table public.${TABLE} enable row level security;`);
    expect(sql.toLowerCase()).not.toContain("create policy");
    expect(sql).not.toMatch(/\bto\s+(anon|authenticated|public)\b/i);
  });

  it("C2 the recording function decides under its lock, requires an open session of the grantee and a grant between two active members, and keeps the earliest moment", () => {
    expect(functionHeader(RECORD)).toBe(
      `create or replace function public.${RECORD}(\n  p_session_id uuid,\n  p_user_id uuid,\n  p_owner_user_id uuid,\n  p_resource_id bigint,\n  p_shared_at timestamptz\n)\nreturns text\nlanguage plpgsql\nvolatile\nsecurity invoker\nset search_path = ''\n`
    );
    const body = functionBody(RECORD);
    expect(body).toContain(
      "if p_session_id is null or p_user_id is null or p_owner_user_id is null\n     or p_resource_id is null or p_shared_at is null then\n    raise exception 'chat_shared_source_record: invalid arguments'\n      using errcode = '22023';"
    );
    expect(body).toContain(
      "if p_shared_at < v_now - pg_catalog.make_interval(mins => 15) then\n    raise exception 'chat_shared_source_record: the moment is too far in the past'\n      using errcode = '22023';"
    );

    expect(occurrences(body, "pg_advisory_xact_lock")).toBe(1);
    const lock = at(body, RECORD_LOCK, "record lock");
    const reads = body.match(/\bfrom public\.[a-z_]+/g) ?? [];
    expect(reads).toEqual([
      "from public.chat_sessions",
      "from public.share_grants",
      "from public.household_members",
      "from public.household_members",
    ]);
    expect(body.indexOf("from public.")).toBeGreaterThan(lock);

    const session = at(
      body,
      "if not exists (\n    select 1\n      from public.chat_sessions c\n     where c.id = p_session_id\n       and c.user_id = p_user_id\n       and c.ended_at is null\n  ) then\n    return 'refused';",
      "session"
    );
    const grant = at(
      body,
      [
        "if not exists (",
        "    select 1",
        "      from public.share_grants g",
        "     where g.owner_user_id = p_owner_user_id",
        "       and g.resource_type = 'plaid_connection'",
        "       and g.resource_id = p_resource_id",
        "       and g.grantee_user_id = p_user_id",
        "       and g.revoked_at is null",
        "       and exists (",
        "         select 1",
        "           from public.household_members m",
        "          where m.household_id = g.household_id",
        "            and m.user_id = g.owner_user_id",
        "            and m.status = 'active'",
        "       )",
        "       and exists (",
        "         select 1",
        "           from public.household_members m",
        "          where m.household_id = g.household_id",
        "            and m.user_id = g.grantee_user_id",
        "            and m.status = 'active'",
        "       )",
        "  ) then",
        "    return 'refused';",
      ].join("\n"),
      "grant"
    );
    expect(session).toBeGreaterThan(lock);
    expect(grant).toBeGreaterThan(session);

    // One write, after both refusals, and it never replaces an earlier moment.
    const writes = body.match(/\b(insert into|delete from|update) public\.[a-z_]+/g) ?? [];
    expect(writes).toEqual([`insert into public.${TABLE}`]);
    const insert = at(body, `insert into public.${TABLE} as s`, "insert");
    expect(insert).toBeGreaterThan(grant);
    expect(body.lastIndexOf("return 'refused';")).toBeLessThan(insert);
    expect(body).toContain(
      "(p_session_id, p_user_id, p_owner_user_id, 'plaid_connection', p_resource_id,\n     least(p_shared_at, v_now))"
    );
    expect(body).toContain(
      "on conflict on constraint chat_shared_sources_session_source_key\n  do update set first_shared_at = least(s.first_shared_at, excluded.first_shared_at);"
    );
    const answers = (body.match(/return '([a-z_]+)'/g) ?? []).map((r) => r.slice(8, -1));
    expect(new Set(answers)).toEqual(new Set(["refused", "recorded"]));

    expect(sql).toContain(
      `revoke all on function public.${RECORD}(${RECORD_ARGS})\n  from public, anon, authenticated;`
    );
    expect(sql).toContain(
      `grant execute on function public.${RECORD}(${RECORD_ARGS}) to service_role;`
    );
  });

  it("C3 the purge function runs as its owner, takes the same lock, locks the sessions, and deletes only the grantee's messages from the recorded moment on", () => {
    expect(functionHeader(PURGE)).toBe(
      `create or replace function public.${PURGE}()\nreturns trigger\nlanguage plpgsql\nvolatile\nsecurity definer\nset search_path = ''\n`
    );
    // As a function attribute, on its own line; the DO block's messages
    // also spell the words.
    expect(sql.match(/^security definer$/gim)?.length).toBe(1);
    expect(functionHeader(RECORD)).not.toMatch(/security definer/i);
    expect(sql.match(/create or replace function/gi)?.length).toBe(2);
    const body = functionBody(PURGE);

    // The same key as the recording function, for the one resource type.
    expect(occurrences(body, "pg_advisory_xact_lock")).toBe(1);
    const lock = at(body, PURGE_LOCK, "purge lock");
    expect(
      PURGE_LOCK.replace("' || old.resource_type || ':", "plaid_connection:")
        .replace("old.owner_user_id", "p_owner_user_id")
        .replace("old.resource_id", "p_resource_id")
    ).toBe(RECORD_LOCK);
    expect(body.indexOf("public.")).toBeGreaterThan(lock);

    const sessionLock = at(
      body,
      `perform 1\n     from public.chat_sessions c\n    where c.id in (\n            select s.session_id\n              from public.${TABLE} s\n             ${SOURCE_MATCH("               ")}          )\n    order by c.id\n      for no key update;`,
      "session lock"
    );
    const loop = at(
      body,
      `for v_source in\n    select s.id, s.session_id, s.user_id, s.first_shared_at\n      from public.${TABLE} s\n     ${SOURCE_MATCH("       ")}     order by s.session_id\n  loop`,
      "loop"
    );
    const messages = at(
      body,
      "delete from public.chat_messages m\n     where m.session_id = v_source.session_id\n       and m.user_id = v_source.user_id\n       and m.created_at >= v_source.first_shared_at;\n    get diagnostics v_deleted = row_count;",
      "messages"
    );
    const count = at(
      body,
      "if v_deleted > 0 then\n      update public.chat_sessions c\n         set message_count = greatest(c.message_count - v_deleted, 0)\n       where c.id = v_source.session_id;\n    end if;",
      "count"
    );
    const source = at(
      body,
      `delete from public.${TABLE} s\n     where s.id = v_source.id;\n  end loop;\n\n  return null;`,
      "source"
    );
    expect(sessionLock).toBeGreaterThan(lock);
    expect(loop).toBeGreaterThan(sessionLock);
    expect(messages).toBeGreaterThan(loop);
    expect(count).toBeGreaterThan(messages);
    expect(source).toBeGreaterThan(count);

    // Nothing else is written: not last_message_at, not a summary or a fact.
    const writes = body.match(/\b(insert into|delete from|update) public\.[a-z_]+/g) ?? [];
    expect(writes).toEqual([
      "delete from public.chat_messages",
      "update public.chat_sessions",
      `delete from public.${TABLE}`,
    ]);
    expect(body).not.toContain("last_message_at");
    expect(occurrences(body, "old.grantee_user_id")).toBe(2);

    expect(sql).toContain(
      `revoke all on function public.${PURGE}()\n  from public, anon, authenticated, service_role;`
    );
    expect(sql.match(/\bgrant\s+execute\b[^;]*;/gi) ?? []).toEqual([
      `grant execute on function public.${RECORD}(${RECORD_ARGS}) to service_role;`,
    ]);
  });

  it("C4 one trigger: after delete on share_grants, per row, defined as the share grants file accepts it", () => {
    const statements = sql.match(/^\s*create\s+(or\s+replace\s+)?trigger\b[^;]*;/gim) ?? [];
    expect(statements.map((s) => s.trim())).toEqual([
      `create trigger ${TRIGGER}\nafter delete on public.share_grants\nfor each row execute function public.${PURGE}();`,
    ]);
    const drop = at(sql, `drop trigger if exists ${TRIGGER} on public.share_grants;`, "drop");
    expect(sql.indexOf(`create trigger ${TRIGGER}`)).toBeGreaterThan(drop);
    expect(sql.match(/\bdrop\s+(table|function|trigger|index|type)\b/gi)?.length).toBe(1);
    // The share grants file's closing check compares the definition as the
    // database prints it; the names there are the ones created here.
    expect(shareSql).toContain(
      `'CREATE TRIGGER ${TRIGGER} AFTER DELETE ON public.share_grants FOR EACH ROW EXECUTE FUNCTION public.${PURGE}()'`
    );
  });

  it("C5 the closing DO block checks every property and raises on each", () => {
    const block = closingDoBlock();
    const checks: Array<[string, RegExp]> = [
      ["client privileges", /has_any_column_privilege\(r\.role_name, v_table[\s\S]*?raise exception '%: client roles still hold privileges/],
      ["PUBLIC table privilege", /a\.grantee = 0\n\s+\) then\n\s+raise exception '%: PUBLIC still holds a table privilege'/],
      ["RLS", /relrowsecurity[\s\S]*?raise exception '%: row level security is not enabled'/],
      ["policies", /from pg_policy where polrelid = v_table;\n\s+if v_policies <> 0 then\n\s+raise exception/],
      ["service_role exact", /array\['SELECT', 'INSERT'\]\)\)\n\s+<> has_table_privilege\('service_role', v_table, p\.privilege\);[\s\S]*?raise exception '%: service_role privileges differ/],
      ["service_role column UPDATE", /and \(a\.attname = 'first_shared_at'\)\n\s+<> has_column_privilege\('service_role', v_table, a\.attname, 'UPDATE'\);\n\s+if v_remaining is not null then\n\s+raise exception '%: service_role column UPDATE differs/],
      ["service_role column REFERENCES", /has_any_column_privilege\('service_role', v_table, 'REFERENCES'\) then\n\s+raise exception/],
      ["owner DELETE", /has_table_privilege\(c\.relowner, v_table, 'DELETE'\)[\s\S]*?raise exception '%: the table owner lacks DELETE'/],
      ["no trigger on the table", /where t\.tgrelid = v_table\n\s+and not t\.tgisinternal\n\s+\) then\n\s+raise exception '%: carries a trigger'/],
      ["foreign keys cascade", /k\.confdeltype = 'c'[\s\S]*?\) into v_ok;\n\s+if not v_ok then\n\s+raise exception '%: % does not reference/],
      ["no other foreign key", /and k\.contype = 'f';\n\s+if v_count <> 2 then\n\s+raise exception '%: expected two foreign keys/],
      ["unique constraint", /k\.conname = 'chat_shared_sources_session_source_key'[\s\S]*?= array\['session_id', 'owner_user_id', 'resource_type', 'resource_id'\]\n\s+\) into v_ok;\n\s+if not v_ok then\n\s+raise exception/],
      ["record client EXECUTE", /has_function_privilege\('authenticated', v_record, 'EXECUTE'\) then\n\s+raise exception '%: anon or authenticated still holds EXECUTE'/],
      ["record PUBLIC EXECUTE", /v_proacl is null\n\s+or exists \(select 1 from aclexplode\(v_proacl\) a where a\.grantee = 0\) then\n\s+raise exception '%: PUBLIC still holds EXECUTE', v_record/],
      ["record invoker", /if v_prosecdef then\n\s+raise exception '%: expected SECURITY INVOKER', v_record/],
      ["record search_path", /'search_path=""' = any\(v_proconfig\)\) then\n\s+raise exception '%: expected an empty search_path, found %', v_record/],
      ["record service_role EXECUTE", /if not has_function_privilege\('service_role', v_record, 'EXECUTE'\) then\n\s+raise exception '%: service_role lacks EXECUTE'/],
      ["purge definer", /if v_prosecdef is distinct from true then\n\s+raise exception '%: expected SECURITY DEFINER', v_purge/],
      ["purge search_path", /'search_path=""' = any\(v_proconfig\)\) then\n\s+raise exception '%: expected an empty search_path, found %', v_purge/],
      ["purge EXECUTE only its owner", /a\.grantee <> v_proowner\n\s+\) then\n\s+raise exception '%: a role other than its owner holds EXECUTE', v_purge/],
      ["purge service_role EXECUTE", /if has_function_privilege\('service_role', v_purge, 'EXECUTE'\) then\n\s+raise exception '%: service_role holds EXECUTE'/],
      ["purge owner owns the tables", /foreach v_rel in array v_owned loop\n\s+if v_proowner is distinct from \(\n\s+select c\.relowner from pg_class c where c\.oid = v_rel\n\s+\) then\n\s+raise exception '%: not owned by the owner of %'/],
      ["no forced RLS", /if \(select c\.relforcerowsecurity from pg_class c where c\.oid = v_rel\) then\n\s+raise exception '%: row level security is forced on its owner'/],
      ["purge owner SELECT", /if not has_table_privilege\(v_proowner, v_rel, 'SELECT'\) then\n\s+raise exception/],
      ["purge owner DELETE on messages", /has_table_privilege\(v_proowner, 'public\.chat_messages'::regclass, 'DELETE'\) then\n\s+raise exception/],
      ["purge owner UPDATE on sessions", /has_table_privilege\(v_proowner, 'public\.chat_sessions'::regclass, 'UPDATE'\) then\n\s+raise exception/],
      ["purge owner DELETE on sources", /if not has_table_privilege\(v_proowner, v_table, 'DELETE'\) then\n\s+raise exception '%: its owner lacks DELETE on %'/],
      ["only the purge trigger", /if v_count <> 1 or not exists \([\s\S]*?and t\.tgname = 'trg_share_grants_purge_chat'\n\s+and t\.tgfoid = v_purge\n\s+and t\.tgenabled = 'O'\n\s+and t\.tgtype = 9\n\s+\) then\n\s+raise exception 'public\.share_grants: expected only the enabled AFTER DELETE row trigger/],
      ["no source without its grant", /g\.grantee_user_id = s\.user_id\n\s+\);\n\s+if v_count <> 0 then\n\s+raise exception '%: % rows have no share grant'/],
      ["MAINTAIN guard", /server_version_num'\)::integer >= 170000 then\n\s+v_privileges := v_privileges \|\| 'MAINTAIN'::text;/],
    ];
    for (const [label, pattern] of checks) {
      expect(block, label).toMatch(pattern);
    }
    expect(block).toContain(`'public.${RECORD}(${RECORD_ARGS})'::regprocedure`);
    expect(block).toContain(`'public.${PURGE}()'::regprocedure`);
    expect(block).toContain(
      "v_owned regclass[] := array[\n    'public.chat_messages'::regclass,\n    'public.chat_sessions'::regclass,\n    'public.chat_shared_sources'::regclass\n  ];"
    );
    expect(sql.lastIndexOf("\ndo $$")).toBeLessThan(sql.lastIndexOf("commit;"));
    expect(occurrences(sql, "\ndo $$")).toBe(2);
  });

  it("C6 the file locks share_grants and checks its precondition first, and before the closing check removes what a source row without a grant marks", () => {
    const lock = at(sql, "lock table public.share_grants in share row exclusive mode;", "lock");
    const pre = sql.indexOf("\ndo $$");
    const firstChange = sql.search(/\n(alter table|create (unique )?index|create table)\b/);
    expect(lock).toBeLessThan(pre);
    expect(pre).toBeLessThan(firstChange);
    const block = sql.slice(pre, sql.indexOf("\n$$;", pre));
    expect(block).toMatch(
      /and a\.attname = 'grantee_user_id'\n\s+and not a\.attisdropped\n\s+\) then\n\s+raise exception/
    );

    const closing = sql.lastIndexOf("\ndo $$");
    const trigger = sql.indexOf(`create trigger ${TRIGGER}`);
    const start = at(sql, "\nwith orphan as (", "cleanup");
    expect(start).toBeGreaterThan(trigger);
    expect(start).toBeLessThan(closing);
    const statement = sql.slice(start, closing);
    expect(statement).toContain(
      "where not exists (\n           select 1\n             from public.share_grants g\n            where g.owner_user_id = s.owner_user_id\n              and g.resource_type = s.resource_type\n              and g.resource_id = s.resource_id\n              and g.grantee_user_id = s.user_id\n         )"
    );
    expect(statement).toContain(
      "delete from public.chat_messages m\n   using orphan o\n   where m.session_id = o.session_id\n     and m.user_id = o.user_id\n     and m.created_at >= o.first_shared_at\n  returning m.session_id"
    );
    expect(statement).toContain(
      "set message_count = greatest(c.message_count - k.n, 0)\n    from counted k\n   where c.id = k.session_id"
    );
    expect(statement.trimEnd().endsWith(
      `delete from public.${TABLE} s\n using orphan o\n where s.id = o.id;`
    )).toBe(true);
  });
});
