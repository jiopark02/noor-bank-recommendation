-- Migration: summaries of the part of a chat session that carries another member's shared bank data
-- Date: 2026-11-28
--
-- Why. Once bank data another household member shares has entered a chat
-- session, every message from that moment on counts as carrying it
-- (20261122120000_chat_shared_sources.sql), and the summary and fact jobs
-- read only what was said before that moment. So that part of a session is
-- remembered nowhere once the session closes. This file adds a place to keep
-- a summary of that part, apart from chat_summaries, together with the
-- connections it was made from, and makes the purge on public.share_grants
-- delete such a summary when the grant of any of those connections ends.
-- Facts are still not extracted from that part.
--
-- What this file does:
--   - Creates chat_shared_summaries: at most one row per chat session.
--       session_id          the session, on delete cascade.
--       user_id             the session's owner, who is the grantee of the
--                           shares, on delete cascade.
--       summary, topics     the summary text and its topic tags.
--       message_count       the number of messages the summary was made from.
--       generated_by_model  the model that wrote it.
--   - Creates chat_shared_summary_sources: one row per summary and
--     connection it was made from.
--       summary_id, user_id  the summary and its owner; together they
--                            reference chat_shared_summaries (id, user_id) on
--                            delete cascade, so a link cannot name another
--                            person's summary.
--       owner_user_id        the person whose connection it is.
--       resource_type        'plaid_connection', the only value share_grants
--                            uses.
--       resource_id          that connection's row id, as share_grants names
--                            it.
--     owner_user_id and resource_id reference nothing, for the reason
--     chat_shared_sources gives: a cascading foreign key would remove the
--     link before the purge trigger reads it.
--   - Adds to chat_sessions the state of the job that writes these
--     summaries, shaped like the summary_* columns of
--     20261111120000_add_cron_retry_state_to_chat_sessions.sql:
--       shared_summarized               true once the job is finished with
--                                       the session, whether or not a row
--                                       was written
--       shared_summary_failures         counted failures so far
--       shared_summary_next_attempt_at  not before this moment
--       shared_summary_outcome          'done' or 'given_up'
--       shared_summary_given_up_reason  'output_unusable' or 'input_rejected'
--       shared_summary_given_up_at      when it gave up
--     and grants service_role UPDATE on exactly those columns, by column.
--     Existing rows are not filled in.
--   - Creates public.chat_shared_summary_save(p_session_id, p_user_id,
--     p_owner_user_ids, p_resource_ids, p_summary, p_topics,
--     p_message_count, p_model), the only function that inserts into either
--     table. The pairs are the marks the caller read on the session before it
--     read the messages it summarized. It:
--       1. refuses with SQLSTATE 22023 when an argument other than p_model is
--          null, the summary is blank, a topic is null, the message count is
--          below one, the pair arrays differ in length, there is no pair or
--          more than 20, or a pair holds a null or names the person as its
--          owner;
--       2. takes the advisory lock of each pair, keyed exactly as the purge
--          on share_grants keys it, in ascending (owner, connection) order:
--          it waits for the first, up to the function's own lock_timeout, and
--          only tries the others; a lock it does not get answers 'busy' with
--          nothing written;
--       3. locks the session row and the person's users row (for key share)
--          without waiting, answering 'busy' with nothing written when either
--          is held elsewhere, and 'session_unavailable' with nothing written
--          unless the session is the person's and closed;
--       4. answers 'exists' with nothing written when the session already
--          has a summary here;
--       5. answers 'source_gone' with nothing written unless every pair still
--          has its mark on the session in chat_shared_sources and the session
--          has no mark beyond the pairs;
--       6. inserts the summary and one link per pair, and answers 'saved'.
--   - Replaces public.chat_shared_sources_purge_on_grant_delete(). Its body
--     is the body 20261122120000_chat_shared_sources.sql gives it, with one
--     statement added before it returns: for the deleted grant's owner,
--     connection and grantee, delete every summary of the grantee that has a
--     link to that connection, whatever session it belongs to. The links go
--     with it by their foreign key. The trigger itself is not touched.
--   - Removes, before its closing check, every summary that has a link
--     without its grant, or no link at all.
--
-- Why a summary made from several connections is deleted whole. Its text is
-- one paragraph; nothing in it says which sentence came from which
-- connection. When the grant of one of them ends, the whole summary goes,
-- and it is not made again: the session's state columns are left as they
-- are.
--
-- Why the marks are checked under the purge's lock. The purge deletes a
-- grant's marks, and the messages they mark, under the advisory lock this
-- function takes for that pair. With every pair's lock held, a mark that is
-- still there means that grant has not been deleted, and the summary is
-- stored with its link before the purge can look for links; a mark that is
-- gone means the purge has run, the messages the summary was made from were
-- deleted with it, and the summary must not be stored. Only a closed session
-- is accepted, and a closed session gets no new mark, so the marks the
-- caller read are all there can be.
--
-- Why nothing is waited for while a lock is held. For the reasons
-- 20261124120000_chat_shared_turn_save.sql gives: a statement that deletes
-- several grants takes their advisory locks in no fixed order, and deleting
-- an account holds the deleted users row while its cascades wait for the
-- purge. This function waits only for its first advisory lock, while it
-- holds nothing, and takes every later lock without waiting.
--
-- Why the purge function stays SECURITY DEFINER, and who must own the new
-- tables. A trigger fired by a foreign-key cascade runs as the role that
-- issued the outer delete. The function runs with its owner's privileges,
-- and its owner must own the tables it deletes from, the two this file
-- creates included, so that row level security does not hide their rows
-- from it: its deletes would then match no row, with no error. The closing
-- DO block requires that. Run this file as the role that owns chat_messages,
-- chat_sessions and chat_shared_sources.
--
-- Access: service role only. RLS is on with no policies on both tables.
-- Every privilege on them and EXECUTE on the saving function is revoked from
-- PUBLIC, anon and authenticated. service_role holds SELECT and INSERT on
-- both tables, no UPDATE and no DELETE, and EXECUTE on the saving function,
-- which is SECURITY INVOKER with an empty search_path. Where
-- 20261017120000_restrict_client_writes_on_chat_tables.sql is applied,
-- authenticated holds SELECT on the whole of chat_sessions, which covers the
-- columns this file adds, so a signed-in user reads them on their own rows
-- as they read the others.
--
-- Locks while the file runs: SHARE ROW EXCLUSIVE on share_grants, so no
-- grant is deleted meanwhile, then ACCESS EXCLUSIVE on chat_sessions for the
-- added columns. Every added column has a constant default or none, so no
-- row is rewritten; adding the checks reads the table once. lock_timeout
-- bounds each wait, and a wait that runs out rolls the whole file back.
--
-- Before it changes anything, the file raises unless chat_shared_sources,
-- the purge trigger on share_grants (enabled), chat_shared_turn_save and
-- chat_sessions.summary_outcome exist: apply
-- 20261111120000_add_cron_retry_state_to_chat_sessions.sql,
-- 20261122120000_chat_shared_sources.sql and
-- 20261124120000_chat_shared_turn_save.sql first.
--
-- The closing DO block checks the end state by property, and calls the
-- saving function with arguments it must refuse, and raises, rolling the
-- whole file back, unless every property holds.
--
-- Order of deployment: apply this file to a database before deploying code
-- that reads the two tables or the added columns against it (the account
-- export reads them whatever any switch says). Whether this file is applied
-- is live state.
--
-- Running it again: every statement is idempotent, and the DO block passes
-- again. Running 20261122120000_chat_shared_sources.sql again after this
-- file gives the purge function its earlier body, which deletes no summary;
-- apply this file again, whose statement before the closing check removes
-- what a grant deleted meanwhile left.
--
-- 20261122120000_chat_shared_sources.sql should not be reversed while this
-- file is applied: this file's function reads its table and both rely on
-- its trigger. Reverse this file first.
--
-- To reverse it (after the application code that reads these objects is
-- reverted and deployed). First give the purge function its earlier body:
-- apply 20261122120000_chat_shared_sources.sql again, then
-- 20261124120000_chat_shared_turn_save.sql again. Then:
--   begin;
--   drop function if exists public.chat_shared_summary_save(
--     uuid, uuid, uuid[], bigint[], text, text[], integer, text);
--   drop table if exists public.chat_shared_summary_sources;
--   drop table if exists public.chat_shared_summaries;
--   alter table public.chat_sessions
--     drop constraint if exists chat_sessions_shared_summary_failures_check,
--     drop constraint if exists chat_sessions_shared_summary_outcome_check,
--     drop constraint if exists chat_sessions_shared_summary_given_up_reason_check,
--     drop constraint if exists chat_sessions_shared_summary_given_up_pair_check,
--     drop column if exists shared_summarized,
--     drop column if exists shared_summary_failures,
--     drop column if exists shared_summary_next_attempt_at,
--     drop column if exists shared_summary_outcome,
--     drop column if exists shared_summary_given_up_reason,
--     drop column if exists shared_summary_given_up_at;
--   commit;
-- Dropping the tables deletes every stored summary of this kind.

begin;

set local lock_timeout = '5s';

lock table public.share_grants in share row exclusive mode;

do $$
begin
  if to_regclass('public.chat_shared_sources') is null then
    raise exception 'public.chat_shared_sources does not exist; apply 20261122120000_chat_shared_sources.sql first';
  end if;
  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.share_grants'::regclass
       and not t.tgisinternal
       and t.tgname = 'trg_share_grants_purge_chat'
       and t.tgenabled = 'O'
       and t.tgtype = 9
  ) then
    raise exception 'the purge trigger on public.share_grants is missing or not enabled; apply 20261122120000_chat_shared_sources.sql first';
  end if;
  if to_regprocedure('public.chat_shared_turn_save(uuid, uuid, uuid, uuid[], bigint[], uuid[], bigint[], uuid, uuid, text, text, text, integer, integer)') is null then
    raise exception 'public.chat_shared_turn_save does not exist; apply 20261124120000_chat_shared_turn_save.sql first';
  end if;
  if not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.chat_sessions'::regclass
       and a.attname = 'summary_outcome'
       and not a.attisdropped
  ) then
    raise exception 'public.chat_sessions has no summary_outcome; apply 20261111120000_add_cron_retry_state_to_chat_sessions.sql first';
  end if;
end
$$;

create table if not exists public.chat_shared_summaries (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.chat_sessions(id) on delete cascade,
  user_id             uuid not null references public.users(id) on delete cascade,
  summary             text not null,
  topics              text[] not null default '{}',
  message_count       integer not null,
  generated_by_model  text,
  created_at          timestamptz not null default now(),
  constraint chat_shared_summaries_session_key unique (session_id),
  constraint chat_shared_summaries_id_user_key unique (id, user_id),
  constraint chat_shared_summaries_message_count_check check (message_count > 0)
);

create index if not exists chat_shared_summaries_user_id_idx
  on public.chat_shared_summaries (user_id);

create table if not exists public.chat_shared_summary_sources (
  id             uuid primary key default gen_random_uuid(),
  summary_id     uuid not null,
  user_id        uuid not null,
  owner_user_id  uuid not null,
  resource_type  text not null,
  resource_id    bigint not null,
  created_at     timestamptz not null default now(),
  constraint chat_shared_summary_sources_summary_fkey
    foreign key (summary_id, user_id)
    references public.chat_shared_summaries (id, user_id) on delete cascade,
  constraint chat_shared_summary_sources_resource_type_check check (resource_type = 'plaid_connection'),
  constraint chat_shared_summary_sources_owner_not_user check (owner_user_id <> user_id),
  constraint chat_shared_summary_sources_summary_source_key
    unique (summary_id, owner_user_id, resource_type, resource_id)
);

create index if not exists chat_shared_summary_sources_source_idx
  on public.chat_shared_summary_sources (owner_user_id, resource_type, resource_id, user_id);

create index if not exists chat_shared_summary_sources_user_id_idx
  on public.chat_shared_summary_sources (user_id);

revoke all on table public.chat_shared_summaries from public, anon, authenticated;
revoke all on table public.chat_shared_summary_sources from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only what the saving function and the readers use.
revoke all on table public.chat_shared_summaries from service_role;
revoke all on table public.chat_shared_summary_sources from service_role;
grant select, insert on table public.chat_shared_summaries to service_role;
grant select, insert on table public.chat_shared_summary_sources to service_role;
alter table public.chat_shared_summaries enable row level security;
alter table public.chat_shared_summary_sources enable row level security;

alter table public.chat_sessions
  add column if not exists shared_summarized boolean not null default false,
  add column if not exists shared_summary_failures smallint not null default 0,
  add column if not exists shared_summary_next_attempt_at timestamptz,
  add column if not exists shared_summary_outcome text,
  add column if not exists shared_summary_given_up_reason text,
  add column if not exists shared_summary_given_up_at timestamptz,
  drop constraint if exists chat_sessions_shared_summary_failures_check,
  drop constraint if exists chat_sessions_shared_summary_outcome_check,
  drop constraint if exists chat_sessions_shared_summary_given_up_reason_check,
  drop constraint if exists chat_sessions_shared_summary_given_up_pair_check,
  add constraint chat_sessions_shared_summary_failures_check
    check (shared_summary_failures >= 0),
  add constraint chat_sessions_shared_summary_outcome_check
    check (shared_summary_outcome in ('done', 'given_up')),
  add constraint chat_sessions_shared_summary_given_up_reason_check
    check (shared_summary_given_up_reason in ('output_unusable', 'input_rejected')),
  add constraint chat_sessions_shared_summary_given_up_pair_check
    check (
      (shared_summary_outcome is not distinct from 'given_up') = (shared_summary_given_up_reason is not null)
      and (shared_summary_given_up_reason is null) = (shared_summary_given_up_at is null)
    );

-- The job that writes these summaries records its state in these columns
-- through the service role. Granted by column, so the grant says exactly
-- which columns this file needs written, whatever the table-level grant is.
grant update (
  shared_summarized,
  shared_summary_failures,
  shared_summary_next_attempt_at,
  shared_summary_outcome,
  shared_summary_given_up_reason,
  shared_summary_given_up_at
) on table public.chat_sessions to service_role;

create or replace function public.chat_shared_summary_save(
  p_session_id uuid,
  p_user_id uuid,
  p_owner_user_ids uuid[],
  p_resource_ids bigint[],
  p_summary text,
  p_topics text[],
  p_message_count integer,
  p_model text
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_owners uuid[];
  v_resources bigint[];
  v_pairs integer;
  v_closed boolean;
  v_summary_id uuid;
  i integer;
begin
  if p_session_id is null or p_user_id is null
     or p_owner_user_ids is null or p_resource_ids is null
     or p_summary is null or pg_catalog.btrim(p_summary) = ''
     or p_topics is null
     or pg_catalog.array_position(p_topics, null::text) is not null
     or p_message_count is null or p_message_count < 1 then
    raise exception 'chat_shared_summary_save: invalid arguments'
      using errcode = '22023';
  end if;
  v_pairs := coalesce(pg_catalog.cardinality(p_owner_user_ids), 0);
  if v_pairs <> coalesce(pg_catalog.cardinality(p_resource_ids), 0)
     or v_pairs = 0
     or v_pairs > 20 then
    raise exception 'chat_shared_summary_save: invalid sources'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from unnest(p_owner_user_ids, p_resource_ids) as k(owner_user_id, resource_id)
     where k.owner_user_id is null
        or k.resource_id is null
        or k.owner_user_id = p_user_id
  ) then
    raise exception 'chat_shared_summary_save: invalid sources'
      using errcode = '22023';
  end if;

  select pg_catalog.array_agg(k.owner_user_id order by k.owner_user_id, k.resource_id),
         pg_catalog.array_agg(k.resource_id order by k.owner_user_id, k.resource_id)
    into v_owners, v_resources
    from (
      select distinct u.owner_user_id, u.resource_id
        from unnest(p_owner_user_ids, p_resource_ids) as u(owner_user_id, resource_id)
    ) k;

  for i in 1 .. pg_catalog.cardinality(v_owners) loop
    if i = 1 then
      -- The only wait, while nothing is held; bounded by the function's
      -- lock_timeout.
      begin
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            'chat_shared_source:plaid_connection:' || v_owners[i]::text || ':' || v_resources[i]::text, 0));
      exception when sqlstate '55P03' then
        return 'busy';
      end;
    elsif not pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'chat_shared_source:plaid_connection:' || v_owners[i]::text || ':' || v_resources[i]::text, 0)) then
      return 'busy';
    end if;
  end loop;

  -- Decide only on what is read under the locks. No lock below is waited
  -- for: a row held elsewhere answers 'busy' with nothing written.
  begin
    perform 1
       from public.chat_sessions c
      where c.id = p_session_id
        and c.user_id = p_user_id
        and c.ended_at is not null
        for key share nowait;
    v_closed := found;
    if v_closed then
      perform 1
         from public.users u
        where u.id = p_user_id
          for key share nowait;
      v_closed := found;
    end if;
  exception when sqlstate '55P03' then
    return 'busy';
  end;
  if not v_closed then
    return 'session_unavailable';
  end if;

  if exists (
    select 1
      from public.chat_shared_summaries x
     where x.session_id = p_session_id
  ) then
    return 'exists';
  end if;

  -- Every pair the caller read must still have its mark on the session.
  if exists (
    select 1
      from unnest(v_owners, v_resources) as k(owner_user_id, resource_id)
     where not exists (
       select 1
         from public.chat_shared_sources m
        where m.session_id = p_session_id
          and m.user_id = p_user_id
          and m.resource_type = 'plaid_connection'
          and m.owner_user_id = k.owner_user_id
          and m.resource_id = k.resource_id
     )
  ) then
    return 'source_gone';
  end if;

  -- And the session must carry no mark beyond them: the summary would then
  -- hold data of a connection it has no link to.
  if exists (
    select 1
      from public.chat_shared_sources m
     where m.session_id = p_session_id
       and not exists (
         select 1
           from unnest(v_owners, v_resources) as k(owner_user_id, resource_id)
          where m.user_id = p_user_id
            and m.resource_type = 'plaid_connection'
            and k.owner_user_id = m.owner_user_id
            and k.resource_id = m.resource_id
       )
  ) then
    return 'source_gone';
  end if;

  insert into public.chat_shared_summaries
    (session_id, user_id, summary, topics, message_count, generated_by_model)
  values
    (p_session_id, p_user_id, p_summary, p_topics, p_message_count, p_model)
  returning id into v_summary_id;

  insert into public.chat_shared_summary_sources
    (summary_id, user_id, owner_user_id, resource_type, resource_id)
  select v_summary_id, p_user_id, k.owner_user_id, 'plaid_connection', k.resource_id
    from unnest(v_owners, v_resources) as k(owner_user_id, resource_id);

  return 'saved';
end;
$$;

revoke all on function public.chat_shared_summary_save(
  uuid, uuid, uuid[], bigint[], text, text[], integer, text)
  from public, anon, authenticated;
grant execute on function public.chat_shared_summary_save(
  uuid, uuid, uuid[], bigint[], text, text[], integer, text)
  to service_role;

create or replace function public.chat_shared_sources_purge_on_grant_delete()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source record;
  v_deleted integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'chat_shared_source:' || old.resource_type || ':' || old.owner_user_id::text || ':' || old.resource_id::text, 0));

  -- Lock the sessions first, in id order: a message insert that has reached
  -- its session row commits before the deletes below take their snapshot.
  perform 1
     from public.chat_sessions c
    where c.id in (
            select s.session_id
              from public.chat_shared_sources s
             where s.owner_user_id = old.owner_user_id
               and s.resource_type = old.resource_type
               and s.resource_id = old.resource_id
               and s.user_id = old.grantee_user_id
          )
    order by c.id
      for no key update;

  for v_source in
    select s.id, s.session_id, s.user_id, s.first_shared_at
      from public.chat_shared_sources s
     where s.owner_user_id = old.owner_user_id
       and s.resource_type = old.resource_type
       and s.resource_id = old.resource_id
       and s.user_id = old.grantee_user_id
     order by s.session_id
  loop
    delete from public.chat_messages m
     where m.session_id = v_source.session_id
       and m.user_id = v_source.user_id
       and m.created_at >= v_source.first_shared_at;
    get diagnostics v_deleted = row_count;

    if v_deleted > 0 then
      update public.chat_sessions c
         set message_count = greatest(c.message_count - v_deleted, 0)
       where c.id = v_source.session_id;
    end if;

    delete from public.chat_shared_sources s
     where s.id = v_source.id;
  end loop;

  -- Every summary of the grantee made from this connection, whatever
  -- session it belongs to. Its links go with it by their foreign key.
  delete from public.chat_shared_summaries x
   where x.user_id = old.grantee_user_id
     and exists (
           select 1
             from public.chat_shared_summary_sources l
            where l.summary_id = x.id
              and l.user_id = old.grantee_user_id
              and l.owner_user_id = old.owner_user_id
              and l.resource_type = old.resource_type
              and l.resource_id = old.resource_id
         );

  return null;
end;
$$;

revoke all on function public.chat_shared_sources_purge_on_grant_delete()
  from public, anon, authenticated, service_role;

-- Summaries left while the purge function had its earlier body, or while
-- the trigger was absent: every summary with a link whose grant is gone, and
-- every summary with no link, which no grant's end would ever delete.
delete from public.chat_shared_summaries x
 where not exists (
         select 1
           from public.chat_shared_summary_sources l
          where l.summary_id = x.id
       )
    or exists (
         select 1
           from public.chat_shared_summary_sources l
          where l.summary_id = x.id
            and not exists (
                  select 1
                    from public.share_grants g
                   where g.owner_user_id = l.owner_user_id
                     and g.resource_type = l.resource_type
                     and g.resource_id = l.resource_id
                     and g.grantee_user_id = l.user_id
                )
       );

do $$
declare
  v_summaries regclass := 'public.chat_shared_summaries'::regclass;
  v_links regclass := 'public.chat_shared_summary_sources'::regclass;
  v_sessions regclass := 'public.chat_sessions'::regclass;
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_fn regprocedure :=
    'public.chat_shared_summary_save(uuid, uuid, uuid[], bigint[], text, text[], integer, text)'::regprocedure;
  v_purge regprocedure :=
    'public.chat_shared_sources_purge_on_grant_delete()'::regprocedure;
  v_owned regclass[] := array[
    'public.chat_messages'::regclass,
    'public.chat_sessions'::regclass,
    'public.chat_shared_sources'::regclass,
    'public.chat_shared_summaries'::regclass,
    'public.chat_shared_summary_sources'::regclass
  ];
  -- One entry per added column: its name, its type as format_type prints it,
  -- whether it is not null, and its default as pg_get_expr prints it (null
  -- for none).
  v_columns text[] := array[
    'shared_summarized',
    'shared_summary_failures',
    'shared_summary_next_attempt_at',
    'shared_summary_outcome',
    'shared_summary_given_up_reason',
    'shared_summary_given_up_at'
  ];
  v_types text[] := array[
    'boolean',
    'smallint',
    'timestamp with time zone',
    'text',
    'text',
    'timestamp with time zone'
  ];
  v_not_null boolean[] := array[true, true, false, false, false, false];
  v_defaults text[] := array['false', '0', null, null, null, null];
  -- One entry per added check: its name and its definition as
  -- pg_get_constraintdef prints it.
  v_checks text[] := array[
    'chat_sessions_shared_summary_failures_check',
    'chat_sessions_shared_summary_outcome_check',
    'chat_sessions_shared_summary_given_up_reason_check',
    'chat_sessions_shared_summary_given_up_pair_check'
  ];
  v_definitions text[] := array[
    'CHECK ((shared_summary_failures >= 0))',
    'CHECK ((shared_summary_outcome = ANY (ARRAY[''done''::text, ''given_up''::text])))',
    'CHECK ((shared_summary_given_up_reason = ANY (ARRAY[''output_unusable''::text, ''input_rejected''::text])))',
    'CHECK ((((NOT (shared_summary_outcome IS DISTINCT FROM ''given_up''::text)) = (shared_summary_given_up_reason IS NOT NULL)) AND ((shared_summary_given_up_reason IS NULL) = (shared_summary_given_up_at IS NULL))))'
  ];
  v_table regclass;
  v_rel regclass;
  v_remaining text;
  v_rls boolean;
  v_policies integer;
  v_ok boolean;
  v_fk record;
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_provolatile "char";
  v_prosrc text;
  v_purge_src text;
  v_proowner oid;
  v_count integer;
  v_i integer;
  v_type text;
  v_notnull boolean;
  v_default text;
  v_definition text;
  v_validated boolean;
  v_session uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_answer text;
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_privileges := v_privileges || 'MAINTAIN'::text;
  end if;

  foreach v_table in array array[v_summaries, v_links] loop
    -- 1. No table or column privilege for anon or authenticated.
    select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
      into v_remaining
      from unnest(array['anon', 'authenticated']) as r(role_name)
     cross join unnest(v_privileges) as p(privilege)
     where has_table_privilege(r.role_name, v_table, p.privilege)
        or has_any_column_privilege(r.role_name, v_table, 'SELECT,INSERT,UPDATE,REFERENCES');
    if v_remaining is not null then
      raise exception '%: client roles still hold privileges: %', v_table, v_remaining;
    end if;

    -- 2. No table privilege for PUBLIC (grantee 0).
    if exists (
      select 1
        from pg_class c,
             lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = v_table
         and a.grantee = 0
    ) then
      raise exception '%: PUBLIC still holds a table privilege', v_table;
    end if;

    -- 3. RLS on, no policies.
    select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
    if v_rls is distinct from true then
      raise exception '%: row level security is not enabled', v_table;
    end if;
    select count(*) into v_policies from pg_policy where polrelid = v_table;
    if v_policies <> 0 then
      raise exception '%: expected no policies, found %', v_table, v_policies;
    end if;

    -- 4. service_role holds exactly SELECT and INSERT on the table, and no
    --    column UPDATE or REFERENCES.
    select string_agg(p.privilege, ', ')
      into v_remaining
      from unnest(v_privileges) as p(privilege)
     where (p.privilege = any(array['SELECT', 'INSERT']))
           <> has_table_privilege('service_role', v_table, p.privilege);
    if v_remaining is not null then
      raise exception '%: service_role privileges differ from SELECT, INSERT at: %',
        v_table, v_remaining;
    end if;
    if has_any_column_privilege('service_role', v_table, 'UPDATE,REFERENCES') then
      raise exception '%: service_role holds a column UPDATE or REFERENCES', v_table;
    end if;

    -- 5. The owner keeps DELETE, so the foreign-key cascades and the purge
    --    can delete rows.
    if not exists (
      select 1 from pg_class c
       where c.oid = v_table
         and has_table_privilege(c.relowner, v_table, 'DELETE')
    ) then
      raise exception '%: the table owner lacks DELETE', v_table;
    end if;

    -- 6. No user trigger on the table.
    if exists (
      select 1
        from pg_trigger t
       where t.tgrelid = v_table
         and not t.tgisinternal
    ) then
      raise exception '%: carries a trigger', v_table;
    end if;
  end loop;

  -- 7. The foreign keys, each on delete cascade, and no other: the summary's
  --    session_id and user_id, and the link's (summary_id, user_id) to the
  --    summary's (id, user_id). The link's owner_user_id and resource_id
  --    reference nothing: a foreign key there would remove the link before
  --    the purge trigger reads it, or refuse the delete that ends the grant.
  for v_fk in
    select *
      from (values
        ('public.chat_shared_summaries',       array['session_id'],            'public.chat_sessions',         array['id']),
        ('public.chat_shared_summaries',       array['user_id'],               'public.users',                 array['id']),
        ('public.chat_shared_summary_sources', array['summary_id', 'user_id'], 'public.chat_shared_summaries', array['id', 'user_id'])
      ) as t(tbl, cols, ref_table, ref_cols)
  loop
    select exists (
      select 1
        from pg_constraint k
       where k.conrelid = v_fk.tbl::regclass
         and k.contype = 'f'
         and k.confrelid = v_fk.ref_table::regclass
         and k.confdeltype = 'c'
         and array(
               select a.attname::text
                 from unnest(k.conkey) with ordinality as u(attnum, n)
                 join pg_attribute a
                   on a.attrelid = k.conrelid
                  and a.attnum = u.attnum
                order by u.n
             ) = v_fk.cols
         and array(
               select a.attname::text
                 from unnest(k.confkey) with ordinality as u(attnum, n)
                 join pg_attribute a
                   on a.attrelid = k.confrelid
                  and a.attnum = u.attnum
                order by u.n
             ) = v_fk.ref_cols
    ) into v_ok;
    if not v_ok then
      raise exception '%: % does not reference %(%) with on delete cascade',
        v_fk.tbl, v_fk.cols, v_fk.ref_table, v_fk.ref_cols;
    end if;
  end loop;
  select count(*) into v_count
    from pg_constraint k
   where k.conrelid = v_summaries
     and k.contype = 'f';
  if v_count <> 2 then
    raise exception '%: expected two foreign keys, found %', v_summaries, v_count;
  end if;
  select count(*) into v_count
    from pg_constraint k
   where k.conrelid = v_links
     and k.contype = 'f';
  if v_count <> 1 then
    raise exception '%: expected one foreign key, found %', v_links, v_count;
  end if;

  -- 8. One summary per session.
  select exists (
    select 1
      from pg_constraint k
     where k.conrelid = v_summaries
       and k.contype = 'u'
       and k.conname = 'chat_shared_summaries_session_key'
       and array(
             select a.attname::text
               from unnest(k.conkey) with ordinality as u(attnum, n)
               join pg_attribute a
                 on a.attrelid = k.conrelid
                and a.attnum = u.attnum
              order by u.n
           ) = array['session_id']
  ) into v_ok;
  if not v_ok then
    raise exception '%: no unique constraint chat_shared_summaries_session_key on (session_id)', v_summaries;
  end if;

  -- 9. Each column added to chat_sessions: present, its type, not null only
  --    where expected, and a default only where expected.
  for v_i in 1 .. cardinality(v_columns) loop
    select format_type(a.atttypid, a.atttypmod),
           a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid)
      into v_type, v_notnull, v_default
      from pg_attribute a
      left join pg_attrdef d
        on d.adrelid = a.attrelid
       and d.adnum = a.attnum
     where a.attrelid = v_sessions
       and a.attname = v_columns[v_i]
       and not a.attisdropped;
    if not found then
      raise exception 'chat_sessions: column % is missing', v_columns[v_i];
    end if;
    if v_type is distinct from v_types[v_i] then
      raise exception 'chat_sessions: column % is of type %, expected %',
        v_columns[v_i], v_type, v_types[v_i];
    end if;
    if v_notnull is distinct from v_not_null[v_i] then
      raise exception 'chat_sessions: column % not null is %, expected %',
        v_columns[v_i], v_notnull, v_not_null[v_i];
    end if;
    if v_default is distinct from v_defaults[v_i] then
      raise exception 'chat_sessions: column % defaults to %, expected %',
        v_columns[v_i], coalesce(v_default, 'no default'),
        coalesce(v_defaults[v_i], 'no default');
    end if;
  end loop;

  -- 10. Each added check: present under its name, validated, and with the
  --     expected definition.
  for v_i in 1 .. cardinality(v_checks) loop
    select pg_get_constraintdef(k.oid), k.convalidated
      into v_definition, v_validated
      from pg_constraint k
     where k.conrelid = v_sessions
       and k.contype = 'c'
       and k.conname = v_checks[v_i];
    if not found then
      raise exception 'chat_sessions: check % is missing', v_checks[v_i];
    end if;
    if not v_validated then
      raise exception 'chat_sessions: check % is not validated', v_checks[v_i];
    end if;
    if v_definition is distinct from v_definitions[v_i] then
      raise exception 'chat_sessions: check % is %, expected %',
        v_checks[v_i], v_definition, v_definitions[v_i];
    end if;
  end loop;

  -- 11. service_role may update each added column, and neither client role
  --     may.
  for v_i in 1 .. cardinality(v_columns) loop
    if not has_column_privilege('service_role', 'public.chat_sessions', v_columns[v_i], 'UPDATE') then
      raise exception 'chat_sessions: service_role lacks UPDATE on %', v_columns[v_i];
    end if;
    if has_column_privilege('anon', 'public.chat_sessions', v_columns[v_i], 'UPDATE')
       or has_column_privilege('authenticated', 'public.chat_sessions', v_columns[v_i], 'UPDATE') then
      raise exception 'chat_sessions: a client role holds UPDATE on %', v_columns[v_i];
    end if;
  end loop;

  -- 12. The saving function: no EXECUTE for PUBLIC, anon or authenticated,
  --     SECURITY INVOKER, an empty search_path, VOLATILE, its own
  --     lock_timeout, and EXECUTE for service_role.
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '%: anon or authenticated still holds EXECUTE', v_fn;
  end if;
  select p.proacl, p.prosecdef, p.proconfig, p.provolatile, p.prosrc
    into v_proacl, v_prosecdef, v_proconfig, v_provolatile, v_prosrc
    from pg_proc p
   where p.oid = v_fn;
  -- A null ACL is the default, which grants EXECUTE to PUBLIC.
  if v_proacl is null
     or exists (select 1 from aclexplode(v_proacl) a where a.grantee = 0) then
    raise exception '%: PUBLIC still holds EXECUTE', v_fn;
  end if;
  if v_prosecdef then
    raise exception '%: expected SECURITY INVOKER', v_fn;
  end if;
  if v_proconfig is null or not ('search_path=""' = any(v_proconfig)) then
    raise exception '%: expected an empty search_path, found %', v_fn, v_proconfig;
  end if;
  if v_provolatile <> 'v' then
    raise exception '%: expected VOLATILE, found %', v_fn, v_provolatile;
  end if;
  if not ('lock_timeout=1s' = any(v_proconfig)) then
    raise exception '%: expected its own lock_timeout of 1s, found %', v_fn, v_proconfig;
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception '%: service_role lacks EXECUTE', v_fn;
  end if;

  -- 13. service_role holds what the function uses besides the two tables:
  --     SELECT on the tables it reads, and UPDATE on at least one column of
  --     each table whose row it locks, which a row lock needs.
  foreach v_rel in array array[
    'public.chat_sessions'::regclass,
    'public.chat_shared_sources'::regclass,
    'public.users'::regclass
  ] loop
    if not has_table_privilege('service_role', v_rel, 'SELECT') then
      raise exception '%: service_role lacks SELECT on %', v_fn, v_rel;
    end if;
  end loop;
  if not has_any_column_privilege('service_role', 'public.chat_sessions'::regclass, 'UPDATE') then
    raise exception '%: service_role lacks UPDATE on chat_sessions, which locking its row needs', v_fn;
  end if;
  if not has_any_column_privilege('service_role', 'public.users'::regclass, 'UPDATE') then
    raise exception '%: service_role lacks UPDATE on users, which locking its row needs', v_fn;
  end if;

  -- 14. The function locks with the purge's key, takes each row lock without
  --     waiting, and answers a lock it does not get 'busy': the handler
  --     appears once for the first advisory lock and once for the row locks.
  if position('''chat_shared_source:plaid_connection:''' in v_prosrc) = 0 then
    raise exception '%: does not lock with the purge''s key', v_fn;
  end if;
  if (length(v_prosrc) - length(replace(v_prosrc, 'for key share nowait', '')))
     / length('for key share nowait') <> 2 then
    raise exception '%: a row lock may be waited for', v_fn;
  end if;
  if (length(v_prosrc) - length(replace(v_prosrc, 'exception when sqlstate ''55P03'' then', '')))
     / length('exception when sqlstate ''55P03'' then') <> 2 then
    raise exception '%: a lock that is not obtained is not answered busy', v_fn;
  end if;

  -- 15. The purge function: SECURITY DEFINER, an empty search_path, no role
  --     other than its owner holds EXECUTE, service_role included, and its
  --     body keeps the lock key and deletes the summaries.
  select p.proacl, p.prosecdef, p.proconfig, p.proowner, p.prosrc
    into v_proacl, v_prosecdef, v_proconfig, v_proowner, v_purge_src
    from pg_proc p
   where p.oid = v_purge;
  if v_prosecdef is distinct from true then
    raise exception '%: expected SECURITY DEFINER', v_purge;
  end if;
  if v_proconfig is null or not ('search_path=""' = any(v_proconfig)) then
    raise exception '%: expected an empty search_path, found %', v_purge, v_proconfig;
  end if;
  if v_proacl is null
     or exists (
       select 1 from aclexplode(v_proacl) a where a.grantee <> v_proowner
     ) then
    raise exception '%: a role other than its owner holds EXECUTE', v_purge;
  end if;
  if has_function_privilege('service_role', v_purge, 'EXECUTE') then
    raise exception '%: service_role holds EXECUTE', v_purge;
  end if;
  if position('''chat_shared_source:''' in v_purge_src) = 0 then
    raise exception '%: no longer locks with the key the saving functions use', v_purge;
  end if;
  if position('delete from public.chat_messages m' in v_purge_src) = 0
     or position('delete from public.chat_shared_sources s' in v_purge_src) = 0
     or position('delete from public.chat_shared_summaries x' in v_purge_src) = 0 then
    raise exception '%: does not delete the messages, the marks and the summaries', v_purge;
  end if;

  -- 16. The purge function's owner owns every table it writes, the two this
  --     file creates included, and none of them forces row level security on
  --     its owner. Otherwise its deletes and its update would match no row,
  --     with no error.
  foreach v_rel in array v_owned loop
    if v_proowner is distinct from (
      select c.relowner from pg_class c where c.oid = v_rel
    ) then
      raise exception '%: not owned by the owner of %', v_purge, v_rel;
    end if;
    if (select c.relforcerowsecurity from pg_class c where c.oid = v_rel) then
      raise exception '%: row level security is forced on its owner', v_rel;
    end if;
    if not has_table_privilege(v_proowner, v_rel, 'SELECT') then
      raise exception '%: its owner lacks SELECT on %', v_purge, v_rel;
    end if;
  end loop;
  if not has_table_privilege(v_proowner, v_summaries, 'DELETE') then
    raise exception '%: its owner lacks DELETE on %', v_purge, v_summaries;
  end if;
  if not has_table_privilege(v_proowner, v_links, 'DELETE') then
    raise exception '%: its owner lacks DELETE on %', v_purge, v_links;
  end if;

  -- 17. share_grants carries exactly one user trigger: the purge trigger,
  --     enabled, AFTER, per row, on DELETE and on no other event.
  select count(*) into v_count
    from pg_trigger t
   where t.tgrelid = 'public.share_grants'::regclass
     and not t.tgisinternal;
  if v_count <> 1 or not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.share_grants'::regclass
       and not t.tgisinternal
       and t.tgname = 'trg_share_grants_purge_chat'
       and t.tgfoid = v_purge
       and t.tgenabled = 'O'
       and t.tgtype = 9
  ) then
    raise exception 'public.share_grants: expected only the enabled AFTER DELETE row trigger trg_share_grants_purge_chat, found % triggers', v_count;
  end if;

  -- 18. No summary is left without a link, or with a link whose grant is
  --     gone.
  select count(*) into v_count
    from public.chat_shared_summaries x
   where not exists (
           select 1
             from public.chat_shared_summary_sources l
            where l.summary_id = x.id
         )
      or exists (
           select 1
             from public.chat_shared_summary_sources l
            where l.summary_id = x.id
              and not exists (
                    select 1
                      from public.share_grants g
                     where g.owner_user_id = l.owner_user_id
                       and g.resource_type = l.resource_type
                       and g.resource_id = l.resource_id
                       and g.grantee_user_id = l.user_id
                  )
         );
  if v_count <> 0 then
    raise exception '%: % rows have no link or a link with no share grant', v_summaries, v_count;
  end if;

  -- 19. A session that is not the person's closed session stores nothing.
  v_answer := public.chat_shared_summary_save(
    v_session, v_user, array[v_owner], array[1::bigint], 'probe', '{}'::text[], 1, null);
  if v_answer is distinct from 'session_unavailable' then
    raise exception '%: expected session_unavailable for an unknown session, got %', v_fn, v_answer;
  end if;
  if exists (
    select 1 from public.chat_shared_summaries x
     where x.session_id = v_session
  ) then
    raise exception '%: wrote a row for a refused call', v_fn;
  end if;

  -- 20. A pair whose owner is the person is refused.
  begin
    perform public.chat_shared_summary_save(
      v_session, v_user, array[v_user], array[1::bigint], 'probe', '{}'::text[], 1, null);
    raise exception '%: accepted a pair owned by the person', v_fn;
  exception when sqlstate '22023' then
    null;
  end;

  -- 21. Pair arrays of different lengths are refused.
  begin
    perform public.chat_shared_summary_save(
      v_session, v_user, array[v_owner], array[1::bigint, 2::bigint], 'probe', '{}'::text[], 1, null);
    raise exception '%: accepted pair arrays of different lengths', v_fn;
  exception when sqlstate '22023' then
    null;
  end;

  -- 22. A call without a pair is refused.
  begin
    perform public.chat_shared_summary_save(
      v_session, v_user, '{}'::uuid[], '{}'::bigint[], 'probe', '{}'::text[], 1, null);
    raise exception '%: accepted a call without a pair', v_fn;
  exception when sqlstate '22023' then
    null;
  end;
end
$$;

commit;
