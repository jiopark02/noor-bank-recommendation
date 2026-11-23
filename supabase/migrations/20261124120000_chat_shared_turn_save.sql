-- Migration: store every chat turn of a session that carries another member's shared bank data
-- Date: 2026-11-24
--
-- Why. When the chat puts bank data another household member shares into a
-- person's prompt, the turn it saves carries that data, and so does every
-- later message of the session, whose history returns to the model. Such a
-- turn must be marked in chat_shared_sources so that the memory jobs leave it
-- out and the purge on public.share_grants deletes it when sharing ends. The
-- mark and the turn have to be written together, while the sharing is checked
-- under the same lock the purge takes: written apart, a turn answered while
-- the grant is being deleted could be saved after the purge with nothing
-- marking it. That holds for every turn of a session already marked, not only
-- for a turn whose prompt read the shared data again: its history carries the
-- figures whatever the latest message says. This file adds the one function
-- that does all of it in one transaction, and drops the recording function
-- that wrote the mark alone.
--
-- What this file does:
--   - Creates public.chat_shared_turn_save(...). It is given the person's
--     session, the two messages with ids the caller chose, and two kinds of
--     (owner, connection) pairs:
--       (a) pairs the caller found marked on a session, reading its marks
--           before the turn's history and again after it, with the id of
--           that session (p_marked_session_id), which is the session the
--           turn is saved in unless that session was closed meanwhile;
--       (b) pairs whose data the caller put into this turn's prompt.
--     It:
--       1. refuses with SQLSTATE 22023 when an argument is null, a pair array
--          and its partner differ in length, there is no pair or more than 20
--          pairs in all, a pair holds a null or names the person as its
--          owner, a marked pair comes without its session, or either message
--          is empty;
--       2. takes the advisory lock of each pair of both kinds, keyed exactly
--          as the purge on share_grants keys it, in ascending (owner,
--          connection) order: it waits for the first, up to the function's
--          own lock_timeout, and answers 'busy' with nothing written when
--          that runs out, and only tries the others, answering 'busy' with
--          nothing written when one is held elsewhere;
--       3. locks the session row (for no key update) and the person's users
--          row (for key share) without waiting, answering 'busy' with
--          nothing written when either is held elsewhere, and
--          'session_closed' with nothing written unless the session is the
--          person's and open;
--       4. answers 'not_shared' with nothing written unless every pair of
--          kind (a) still has its mark on the marked session, and every pair
--          of kind (b) is returned by public.household_shared_connections for
--          the person, which decides the grant, its scope, both people's
--          active membership and the connection's status in one statement;
--       5. reads the clock once, records every pair in chat_shared_sources on
--          the session the turn is saved in, with that moment (keeping an
--          earlier moment already recorded), inserts both messages in one
--          statement with the user's at that moment and the assistant's
--          100 ms later, and answers 'saved'.
--     Steps 3 to 5 decide only on what is read after every advisory lock is
--     held, and steps 4 and 5 only after both row locks are held too.
--   - Drops public.chat_shared_source_record, which recorded a pair without
--     storing the turn, without checking the grant's scope or the
--     connection's status, and with a moment the caller gave.
--
-- Why a marked pair is checked by its mark. The purge on share_grants
-- deletes a grant's marks, and the messages they mark, under the same
-- advisory lock this function takes for that pair. So with the lock held, a
-- mark that is still there means the grant has not been deleted, and a mark
-- that is gone means the purge has run and this turn, whose history held the
-- shared figures, must not be saved. The shared-connections function is not
-- asked for these pairs: it also requires the owner's connection to be
-- active, and a session marked by a connection that stopped being active
-- would then refuse every turn while the sharing itself still stands.
--
-- Why the database clock. The moment recorded and the user message's
-- created_at are the same value, read under the lock, so the purge
-- (created_at >= first_shared_at) and the memory jobs (created_at <
-- first_shared_at) put this turn on the same side. No moment crosses from the
-- application, so none needs checking.
--
-- Why nothing is waited for while a lock is held. For each grant row a
-- statement deletes, the purge on share_grants takes that grant's advisory
-- lock and then the rows of the sessions the grant's source marks, and keeps
-- both until its transaction ends. A statement that deletes several grants
-- (leaving a household, deleting an account) takes them grant after grant,
-- in no fixed order, so it can hold a session row while it waits for the
-- next grant's lock, including a session marked by a connection that is not
-- among this call's pairs. Deleting an account likewise holds the deleted
-- users row while its cascades wait for that person's sessions. A call that
-- held one advisory lock and then waited for the session row, or for the
-- users row the foreign keys of both inserts check, could deadlock with
-- either. So this function waits only for its first advisory lock, while it
-- holds nothing, and takes every later lock without waiting: the other
-- advisory locks are tried, and the session row and the users row are locked
-- with nowait once every advisory lock is held. Any of them held elsewhere
-- answers 'busy' with nothing written, and the caller may call again with
-- the same arguments.
--
-- Why the function sets its own lock_timeout. The wait for the first
-- advisory lock is bounded by it, and its expiry (SQLSTATE 55P03) is answered
-- 'busy'. It has to end that wait before the statement_timeout of the role
-- the caller connects through does, or the statement is cancelled with
-- another SQLSTATE and the caller cannot tell whether anything was stored;
-- that role's settings are live state. It also has to let the chat route call
-- twice, with its wait between the calls, inside the time the route keeps for
-- the save after its last model attempt: the save deadline less the read-back
-- reserve, less the request budget (llmTimeouts.ts), less the retry wait
-- (SHARED_TURN_BUSY_RETRY_MS, aiMemory.ts), halved; a test of this file
-- holds that relation. The same limit bounds every other lock
-- wait inside the call; by the order above there is none, and one that ran
-- out would surface as an error rather than an answer.
--
-- Locking order: the advisory locks, then the session row, then the users
-- row. The purge takes its advisory lock before the session rows too. With
-- the session row held from step 3, the trigger that updates it after each
-- message insert, and the foreign key checks of both inserts, wait for
-- nothing, and no other transaction can close the session before this one
-- ends; a session already closed is refused at step 3. The marked session,
-- when it is not the session the turn is saved in, is not locked: only its
-- marks are read, under the advisory locks that guard them.
--
-- Access: SECURITY INVOKER with an empty search_path. EXECUTE is revoked
-- from PUBLIC, anon and authenticated and granted to service_role only, so
-- the caller is a server route that passes the id it verified from the
-- request's bearer token. It writes and locks rows with the caller's
-- privileges (a row lock needs UPDATE on its table besides SELECT), which the
-- closing DO block checks.
--
-- Before it changes anything, the file raises unless chat_shared_sources and
-- its unique key, the purge trigger on share_grants (enabled), the closed
-- session check in the message trigger, and household_shared_connections
-- exist: apply 20261122120000_chat_shared_sources.sql and
-- 20261123120000_household_shared_connections.sql first.
--
-- The closing DO block checks the end state by property, and calls the
-- function with arguments it must refuse, and raises, rolling the whole file
-- back, unless every property holds.
--
-- Order of deployment: apply this file to a database before deploying code
-- that calls the function against it. Whether this file is applied is live
-- state.
--
-- Running it again: the drops are no-ops, create or replace keeps the same
-- signature, and the DO block passes again. Running
-- 20261122120000_chat_shared_sources.sql again after this file creates
-- chat_shared_source_record again; apply this file again to drop it. An
-- earlier version of this file defined the function with eleven arguments;
-- this file drops that signature too.
--
-- 20261122120000_chat_shared_sources.sql and
-- 20261123120000_household_shared_connections.sql should not be reversed
-- while this file is applied: this function writes and reads the first's
-- table and calls the second's function. Reverse this file first.
--
-- To reverse it (after the application code that calls the function is
-- reverted and deployed):
--   drop function if exists public.chat_shared_turn_save(
--     uuid, uuid, uuid, uuid[], bigint[], uuid[], bigint[], uuid, uuid, text, text, text, integer, integer);
-- and apply 20261122120000_chat_shared_sources.sql again to restore the
-- recording function. When 20261122120000_chat_shared_sources.sql is to be
-- reversed as well, reverse this file first, then that one and the other
-- earlier files newest first, as each file's header says.

begin;

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.chat_shared_sources') is null then
    raise exception 'public.chat_shared_sources does not exist; apply 20261122120000_chat_shared_sources.sql first';
  end if;
  if not exists (
    select 1
      from pg_constraint k
     where k.conrelid = 'public.chat_shared_sources'::regclass
       and k.conname = 'chat_shared_sources_session_source_key'
       and k.contype = 'u'
  ) then
    raise exception 'public.chat_shared_sources has no chat_shared_sources_session_source_key';
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
  if to_regprocedure('public.household_shared_connections(uuid)') is null then
    raise exception 'public.household_shared_connections(uuid) does not exist; apply 20261123120000_household_shared_connections.sql first';
  end if;
  if not exists (
    select 1
      from pg_proc p
     where p.oid = to_regprocedure('public.bump_chat_session_on_message()')
       and p.prosrc like '%NR001%'
  ) then
    raise exception 'the message trigger does not refuse a closed session; apply 20261110120000_reject_chat_messages_on_closed_session.sql first';
  end if;
end
$$;

drop function if exists public.chat_shared_turn_save(
  uuid, uuid, uuid[], bigint[], uuid, uuid, text, text, text, integer, integer);

create or replace function public.chat_shared_turn_save(
  p_session_id uuid,
  p_user_id uuid,
  p_marked_session_id uuid,
  p_marked_owner_user_ids uuid[],
  p_marked_resource_ids bigint[],
  p_owner_user_ids uuid[],
  p_resource_ids bigint[],
  p_user_message_id uuid,
  p_assistant_message_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer
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
  v_marked integer;
  v_added integer;
  v_now timestamptz;
  v_open boolean;
  i integer;
begin
  if p_session_id is null or p_user_id is null
     or p_marked_owner_user_ids is null or p_marked_resource_ids is null
     or p_owner_user_ids is null or p_resource_ids is null
     or p_user_message_id is null or p_assistant_message_id is null
     or p_user_content is null or p_assistant_content is null
     or pg_catalog.btrim(p_user_content) = ''
     or pg_catalog.btrim(p_assistant_content) = '' then
    raise exception 'chat_shared_turn_save: invalid arguments'
      using errcode = '22023';
  end if;
  v_marked := coalesce(pg_catalog.cardinality(p_marked_owner_user_ids), 0);
  v_added := coalesce(pg_catalog.cardinality(p_owner_user_ids), 0);
  if v_marked <> coalesce(pg_catalog.cardinality(p_marked_resource_ids), 0)
     or v_added <> coalesce(pg_catalog.cardinality(p_resource_ids), 0)
     or v_marked + v_added = 0
     or v_marked + v_added > 20
     or (v_marked > 0 and p_marked_session_id is null) then
    raise exception 'chat_shared_turn_save: invalid sources'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from (
        select m.owner_user_id, m.resource_id
          from unnest(p_marked_owner_user_ids, p_marked_resource_ids) as m(owner_user_id, resource_id)
        union all
        select a.owner_user_id, a.resource_id
          from unnest(p_owner_user_ids, p_resource_ids) as a(owner_user_id, resource_id)
      ) k
     where k.owner_user_id is null
        or k.resource_id is null
        or k.owner_user_id = p_user_id
  ) then
    raise exception 'chat_shared_turn_save: invalid sources'
      using errcode = '22023';
  end if;

  select pg_catalog.array_agg(k.owner_user_id order by k.owner_user_id, k.resource_id),
         pg_catalog.array_agg(k.resource_id order by k.owner_user_id, k.resource_id)
    into v_owners, v_resources
    from (
      select distinct u.owner_user_id, u.resource_id
        from (
          select m.owner_user_id, m.resource_id
            from unnest(p_marked_owner_user_ids, p_marked_resource_ids) as m(owner_user_id, resource_id)
          union all
          select a.owner_user_id, a.resource_id
            from unnest(p_owner_user_ids, p_resource_ids) as a(owner_user_id, resource_id)
        ) u
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
        and c.ended_at is null
        for no key update nowait;
    v_open := found;
    if v_open then
      perform 1
         from public.users u
        where u.id = p_user_id
          for key share nowait;
      v_open := found;
    end if;
  exception when sqlstate '55P03' then
    return 'busy';
  end;
  if not v_open then
    return 'session_closed';
  end if;

  -- (a) A pair the caller found marked, reading the session's marks before
  -- the turn's history and again after it: its mark must still be there.
  if exists (
    select 1
      from unnest(p_marked_owner_user_ids, p_marked_resource_ids) as k(owner_user_id, resource_id)
     where not exists (
       select 1
         from public.chat_shared_sources m
        where m.session_id = p_marked_session_id
          and m.user_id = p_user_id
          and m.resource_type = 'plaid_connection'
          and m.owner_user_id = k.owner_user_id
          and m.resource_id = k.resource_id
     )
  ) then
    return 'not_shared';
  end if;

  -- (b) A pair put into this turn's prompt: it must still be shared.
  if exists (
    select 1
      from unnest(p_owner_user_ids, p_resource_ids) as k(owner_user_id, resource_id)
     where not exists (
       select 1
         from public.household_shared_connections(p_user_id) s
        where s.owner_user_id = k.owner_user_id
          and s.connection_id = k.resource_id
     )
  ) then
    return 'not_shared';
  end if;

  v_now := pg_catalog.clock_timestamp();

  insert into public.chat_shared_sources as s
    (session_id, user_id, owner_user_id, resource_type, resource_id, first_shared_at)
  select p_session_id, p_user_id, k.owner_user_id, 'plaid_connection', k.resource_id, v_now
    from unnest(v_owners, v_resources) as k(owner_user_id, resource_id)
  on conflict on constraint chat_shared_sources_session_source_key
  do update set first_shared_at = least(s.first_shared_at, excluded.first_shared_at);

  insert into public.chat_messages
    (id, session_id, user_id, role, content, model, input_tokens, output_tokens, created_at)
  values
    (p_user_message_id, p_session_id, p_user_id, 'user', p_user_content,
     null, null, null, v_now),
    (p_assistant_message_id, p_session_id, p_user_id, 'assistant', p_assistant_content,
     p_model, p_input_tokens, p_output_tokens,
     v_now + pg_catalog.make_interval(secs => 0.1));

  return 'saved';
end;
$$;

revoke all on function public.chat_shared_turn_save(
  uuid, uuid, uuid, uuid[], bigint[], uuid[], bigint[], uuid, uuid, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.chat_shared_turn_save(
  uuid, uuid, uuid, uuid[], bigint[], uuid[], bigint[], uuid, uuid, text, text, text, integer, integer)
  to service_role;

drop function if exists public.chat_shared_source_record(uuid, uuid, uuid, bigint, timestamptz);

do $$
declare
  v_fn regprocedure := 'public.chat_shared_turn_save(uuid, uuid, uuid, uuid[], bigint[], uuid[], bigint[], uuid, uuid, text, text, text, integer, integer)'::regprocedure;
  v_purge regprocedure := 'public.chat_shared_sources_purge_on_grant_delete()'::regprocedure;
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_provolatile "char";
  v_prosrc text;
  v_table regclass;
  v_session uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_user_message uuid := gen_random_uuid();
  v_assistant_message uuid := gen_random_uuid();
  v_answer text;
begin
  -- 1. No EXECUTE for anon or authenticated.
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '%: anon or authenticated still holds EXECUTE', v_fn;
  end if;

  select p.proacl, p.prosecdef, p.proconfig, p.provolatile, p.prosrc
    into v_proacl, v_prosecdef, v_proconfig, v_provolatile, v_prosrc
    from pg_proc p
   where p.oid = v_fn;

  -- 2. No EXECUTE for PUBLIC. A null ACL is the default, which grants it.
  if v_proacl is null
     or exists (select 1 from aclexplode(v_proacl) a where a.grantee = 0) then
    raise exception '%: PUBLIC still holds EXECUTE', v_fn;
  end if;

  -- 3. SECURITY INVOKER.
  if v_prosecdef then
    raise exception '%: expected SECURITY INVOKER', v_fn;
  end if;

  -- 4. An empty search_path.
  if v_proconfig is null or not ('search_path=""' = any(v_proconfig)) then
    raise exception '%: expected an empty search_path, found %', v_fn, v_proconfig;
  end if;

  -- 5. VOLATILE: it writes.
  if v_provolatile <> 'v' then
    raise exception '%: expected VOLATILE, found %', v_fn, v_provolatile;
  end if;

  -- 6. service_role executes it.
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception '%: service_role lacks EXECUTE', v_fn;
  end if;

  -- 7. service_role holds what the function and the message trigger use.
  if not has_function_privilege('service_role', 'public.household_shared_connections(uuid)'::regprocedure, 'EXECUTE') then
    raise exception '%: service_role lacks EXECUTE on household_shared_connections', v_fn;
  end if;
  if not has_table_privilege('service_role', 'public.chat_messages'::regclass, 'INSERT') then
    raise exception '%: service_role lacks INSERT on chat_messages', v_fn;
  end if;
  foreach v_table in array array[
    'public.chat_sessions'::regclass,
    'public.chat_shared_sources'::regclass,
    'public.users'::regclass
  ] loop
    if not has_table_privilege('service_role', v_table, 'SELECT') then
      raise exception '%: service_role lacks SELECT on %', v_fn, v_table;
    end if;
  end loop;
  -- The users row lock needs UPDATE on users; the session row lock needs it
  -- on chat_sessions, checked below.
  if not has_table_privilege('service_role', 'public.users'::regclass, 'UPDATE') then
    raise exception '%: service_role lacks UPDATE on users, which locking its row needs', v_fn;
  end if;
  if not has_table_privilege('service_role', 'public.chat_shared_sources'::regclass, 'INSERT') then
    raise exception '%: service_role lacks INSERT on chat_shared_sources', v_fn;
  end if;
  if not has_column_privilege('service_role', 'public.chat_shared_sources'::regclass, 'first_shared_at', 'UPDATE') then
    raise exception '%: service_role lacks UPDATE on chat_shared_sources.first_shared_at', v_fn;
  end if;
  if not has_table_privilege('service_role', 'public.chat_sessions'::regclass, 'UPDATE') then
    raise exception '%: service_role lacks UPDATE on chat_sessions', v_fn;
  end if;

  -- 8. The lock key is the purge's, and the purge still fires.
  if position('''chat_shared_source:plaid_connection:''' in v_prosrc) = 0 then
    raise exception '%: does not lock with the purge''s key', v_fn;
  end if;
  if position('''chat_shared_source:''' in (
    select p.prosrc from pg_proc p where p.oid = v_purge
  )) = 0 then
    raise exception '%: no longer locks with the key this function uses', v_purge;
  end if;
  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.share_grants'::regclass
       and not t.tgisinternal
       and t.tgname = 'trg_share_grants_purge_chat'
       and t.tgfoid = v_purge
       and t.tgenabled = 'O'
       and t.tgtype = 9
  ) then
    raise exception 'trg_share_grants_purge_chat is missing or not enabled';
  end if;

  -- 9. Every row lock is taken without waiting, and one held elsewhere is
  --    answered 'busy'.
  if position('for no key update nowait' in v_prosrc) = 0
     or position('for key share nowait' in v_prosrc) = 0
     or position('exception when sqlstate ''55P03'' then' in v_prosrc) = 0 then
    raise exception '%: a row lock may be waited for', v_fn;
  end if;

  -- 10. The wait for the first advisory lock is bounded by the function's own
  --     lock_timeout, and its expiry is answered 'busy': the handler appears
  --     once for that lock and once for the row locks.
  if not ('lock_timeout=1s' = any(v_proconfig)) then
    raise exception '%: expected its own lock_timeout of 1s, found %', v_fn, v_proconfig;
  end if;
  if (length(v_prosrc) - length(replace(v_prosrc, 'exception when sqlstate ''55P03'' then', '')))
     / length('exception when sqlstate ''55P03'' then') <> 2 then
    raise exception '%: the wait for the first advisory lock is not answered busy', v_fn;
  end if;

  -- 11. A marked pair is checked by its mark on the marked session.
  if position('where m.session_id = p_marked_session_id' in v_prosrc) = 0 then
    raise exception '%: does not check a marked pair by its mark', v_fn;
  end if;

  -- 12. The recording function this file replaces, and the earlier
  --     signature of this one, are gone.
  if to_regprocedure('public.chat_shared_source_record(uuid, uuid, uuid, bigint, timestamptz)') is not null then
    raise exception 'public.chat_shared_source_record still exists';
  end if;
  if to_regprocedure('public.chat_shared_turn_save(uuid, uuid, uuid[], bigint[], uuid, uuid, text, text, text, integer, integer)') is not null then
    raise exception 'the earlier signature of public.chat_shared_turn_save still exists';
  end if;

  -- 13. A session that is not the person's open session stores nothing.
  v_answer := public.chat_shared_turn_save(
    v_session, v_user, null, '{}'::uuid[], '{}'::bigint[], array[v_owner], array[1::bigint],
    v_user_message, v_assistant_message, 'probe', 'probe', null, null, null);
  if v_answer is distinct from 'session_closed' then
    raise exception '%: expected session_closed for an unknown session, got %', v_fn, v_answer;
  end if;
  if exists (
    select 1 from public.chat_messages m
     where m.id in (v_user_message, v_assistant_message)
  ) or exists (
    select 1 from public.chat_shared_sources s
     where s.session_id = v_session
  ) then
    raise exception '%: wrote rows for a refused call', v_fn;
  end if;

  -- 14. A pair whose owner is the person is refused.
  begin
    perform public.chat_shared_turn_save(
      v_session, v_user, null, '{}'::uuid[], '{}'::bigint[], array[v_user], array[1::bigint],
      v_user_message, v_assistant_message, 'probe', 'probe', null, null, null);
    raise exception '%: accepted a pair owned by the person', v_fn;
  exception when sqlstate '22023' then
    null;
  end;

  -- 15. Pair arrays of different lengths are refused.
  begin
    perform public.chat_shared_turn_save(
      v_session, v_user, null, '{}'::uuid[], '{}'::bigint[], array[v_owner], array[1::bigint, 2::bigint],
      v_user_message, v_assistant_message, 'probe', 'probe', null, null, null);
    raise exception '%: accepted pair arrays of different lengths', v_fn;
  exception when sqlstate '22023' then
    null;
  end;

  -- 16. A marked pair without the session it is marked on is refused.
  begin
    perform public.chat_shared_turn_save(
      v_session, v_user, null, array[v_owner], array[1::bigint], '{}'::uuid[], '{}'::bigint[],
      v_user_message, v_assistant_message, 'probe', 'probe', null, null, null);
    raise exception '%: accepted a marked pair without its session', v_fn;
  exception when sqlstate '22023' then
    null;
  end;
end
$$;

commit;
