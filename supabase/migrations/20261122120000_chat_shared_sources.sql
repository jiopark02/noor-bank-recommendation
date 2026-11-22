-- Migration: where another member's shared bank data entered a chat session
-- Date: 2026-11-22
--
-- Why. A share grant lets one household member see a bank connection of the
-- other. Once figures from that connection are put into the grantee's chat,
-- they are stored with the turn in chat_messages, they return to the model
-- with the session's history on every later turn, and after the session
-- closes the summary and fact jobs read the stored text. This file adds what
-- keeps those figures from outliving the grant: a record of the moment a
-- shared connection first entered a session, and a trigger that removes what
-- was stored from that moment on when the grant ends. It adds no code that
-- puts shared data into a chat, and nothing in the application calls the
-- recording function yet.
--
-- What this file does:
--   - Creates chat_shared_sources: one row per chat session and shared
--     connection.
--       session_id       the session, on delete cascade.
--       user_id          the session's owner, who is the grantee of the
--                        share, on delete cascade.
--       owner_user_id    the person whose connection it is.
--       resource_type    'plaid_connection', the only value share_grants
--                        uses.
--       resource_id      that connection's row id, as share_grants names it.
--       first_shared_at  the earliest moment the connection's data entered
--                        the session. A message of the session created
--                        before it is unaffected; every message created at
--                        or after it counts as carrying the data, including
--                        later turns that only received it through the
--                        session's history.
--     One row per (session_id, owner_user_id, resource_type, resource_id).
--   - Creates public.chat_shared_source_record(p_session_id, p_user_id,
--     p_owner_user_id, p_resource_id, p_shared_at), the only function that
--     inserts into the table. It answers one of:
--       recorded  the row exists, with the earlier of the stored and the
--                 given moment
--       refused   nothing was written: the session is not an open session of
--                 p_user_id, or no grant of that connection from that owner
--                 to p_user_id exists whose owner and grantee are both
--                 active members of the grant's household
--     It raises 22023 for a null argument and for a moment more than fifteen
--     minutes in the past; a moment in the future is stored as the current
--     time.
--   - Creates public.chat_shared_sources_purge_on_grant_delete() and the
--     trigger trg_share_grants_purge_chat, after delete on share_grants, for
--     each row. For the deleted grant's owner, connection and grantee, and
--     for every session of the grantee that has that source, it deletes the
--     session's messages created at or after first_shared_at, lowers the
--     session's message_count by the number deleted, and deletes the source
--     row. The session, its earlier messages, and summaries and facts that
--     already exist are kept. last_message_at is not changed.
--   - Removes, before its closing check, what a source row without a grant
--     would have left (see "Rows left while the trigger was absent" below).
--
-- Why the caller gives the moment. chat_messages.created_at is written by
-- the application, from its own clock, when a turn is saved. A moment taken
-- from the database clock could fall after the created_at of the turn it is
-- meant to cover. The caller takes the moment from the same clock, before it
-- saves the turn. When a save is moved to another session because the first
-- one was closed, the same moment has to be recorded for the new session
-- before the turn is saved there.
--
-- Why the source columns carry no foreign key. A grant can end through a
-- cascade: from its plaid_connections row, from public.users, from
-- households. A user trigger queued by a cascaded delete runs after the
-- statement's cascades have finished, so a cascading foreign key from
-- (owner_user_id, resource_id) would have removed the source row before the
-- trigger looked for it, and the messages would stay. A foreign key that
-- does not cascade would instead make the delete of the connection fail. So
-- owner_user_id and resource_id reference nothing, the trigger is the only
-- thing that deletes a source row while its session exists, and the closing
-- DO block requires that no source row is left without its grant.
--
-- What the table is shaped for. A source row has its own id, so a later
-- file can let a summary or a fact reference the sources it was made from
-- through a linking table with on delete cascade, and the same trigger then
-- removes them with the source row. The row is keyed by owner and
-- connection, not by the grant's id, because sharing again after it was
-- turned off creates a new grant.
--
-- Why the purge function is SECURITY DEFINER. A trigger fired by a
-- foreign-key cascade runs as the role that issued the outer delete:
-- service_role, or supabase_auth_admin when an Auth user is deleted. The
-- function has to delete chat rows whichever role that was. It runs with its
-- owner's privileges, its owner is the owner of chat_messages, chat_sessions
-- and chat_shared_sources (so row level security does not hide their rows
-- from it), no role holds EXECUTE on it, and its body names only
-- schema-qualified objects.
--
-- Locking. The recording function and the purge function take the same
-- advisory transaction lock, keyed by resource type, owner and connection,
-- before they read. A recording that holds it commits before the purge
-- looks for source rows, and a recording that waits for it finds the grant
-- gone and refuses. This relies on READ COMMITTED: a statement that ran
-- after the wait sees what was committed during it. The purge function then
-- locks the session rows, in id order, before it deletes, so a message
-- insert that has already reached the session row is committed and visible
-- to the delete. Neither function takes a household lock.
--
-- What this does not cover. A turn already being answered when the grant is
-- deleted was given the session's history before the purge and is saved
-- after it, with no source row; code that puts shared data into a chat has
-- to make saving the turn and checking the grant one step under the same
-- lock. TRUNCATE on share_grants, a disabled trigger and
-- session_replication_role = replica do not fire the trigger.
--
-- Access: service role only. RLS is on with no policies. Every privilege on
-- the table and EXECUTE on both functions is revoked from PUBLIC, anon and
-- authenticated. service_role holds SELECT and INSERT on the table, UPDATE
-- on first_shared_at only, no DELETE, and EXECUTE on the recording function
-- only. Both functions have an empty search_path. The recording function is
-- SECURITY INVOKER.
--
-- Rows left while the trigger was absent. Should the trigger be dropped or
-- disabled while source rows exist, a grant can end without the purge. Just
-- before the closing DO block, this file does for every source row that has
-- no grant what the trigger would have done, and the DO block then requires
-- that none is left. On a first application the table is empty and the
-- statement removes nothing.
--
-- Before it changes anything, the file raises unless share_grants has
-- grantee_user_id: apply 20261121120000_household_share_grants.sql first.
--
-- The closing DO block checks the end state by property and raises, rolling
-- the whole file back, unless every property holds.
--
-- Order of deployment: apply this file to a database before deploying code
-- that reads chat_shared_sources against it (the summary and fact jobs and
-- the account export). Whether this file is applied is live state.
--
-- Running it again: every statement is idempotent, and the DO block passes
-- again. The closing DO block of
-- 20261121120000_household_share_grants.sql accepts share_grants with this
-- file's trigger, so that file can be applied again afterwards; a version
-- of that file from before it accepted the trigger cannot.
--
-- 20261121120000_household_share_grants.sql cannot be reversed while this
-- file is applied: its reverse drops share_grants.grantee_user_id, which
-- the purge function reads, and every later delete from share_grants would
-- fail. Reverse this file first.
--
-- To reverse it (after the application code that reads chat_shared_sources
-- is reverted and deployed):
--   begin;
--   delete from public.chat_messages m
--    using public.chat_shared_sources s
--    where m.session_id = s.session_id
--      and m.user_id = s.user_id
--      and m.created_at >= s.first_shared_at;
--   drop trigger if exists trg_share_grants_purge_chat on public.share_grants;
--   drop function if exists public.chat_shared_sources_purge_on_grant_delete();
--   drop function if exists public.chat_shared_source_record(uuid, uuid, uuid, bigint, timestamptz);
--   drop table if exists public.chat_shared_sources;
--   commit;
-- The delete removes what the remaining source rows mark: without the table
-- nothing would remove it when the grant ends. It leaves message_count of
-- those sessions above the number of rows that remain.

begin;

set local lock_timeout = '5s';

lock table public.share_grants in share row exclusive mode;

do $$
begin
  if not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.share_grants'::regclass
       and a.attname = 'grantee_user_id'
       and not a.attisdropped
  ) then
    raise exception 'public.share_grants has no grantee_user_id; apply 20261121120000_household_share_grants.sql first';
  end if;
end
$$;

create table if not exists public.chat_shared_sources (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.chat_sessions(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  owner_user_id    uuid not null,
  resource_type    text not null,
  resource_id      bigint not null,
  first_shared_at  timestamptz not null,
  created_at       timestamptz not null default now(),
  constraint chat_shared_sources_resource_type_check check (resource_type = 'plaid_connection'),
  constraint chat_shared_sources_owner_not_user check (owner_user_id <> user_id),
  constraint chat_shared_sources_session_source_key
    unique (session_id, owner_user_id, resource_type, resource_id)
);

create index if not exists chat_shared_sources_source_idx
  on public.chat_shared_sources (owner_user_id, resource_id, user_id);

create index if not exists chat_shared_sources_user_id_idx
  on public.chat_shared_sources (user_id);

revoke all on table public.chat_shared_sources from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only what the recording function and the readers use.
revoke all on table public.chat_shared_sources from service_role;
grant select, insert on table public.chat_shared_sources to service_role;
grant update (first_shared_at) on table public.chat_shared_sources to service_role;
alter table public.chat_shared_sources enable row level security;

create or replace function public.chat_shared_source_record(
  p_session_id uuid,
  p_user_id uuid,
  p_owner_user_id uuid,
  p_resource_id bigint,
  p_shared_at timestamptz
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
begin
  if p_session_id is null or p_user_id is null or p_owner_user_id is null
     or p_resource_id is null or p_shared_at is null then
    raise exception 'chat_shared_source_record: invalid arguments'
      using errcode = '22023';
  end if;
  if p_shared_at < v_now - pg_catalog.make_interval(mins => 15) then
    raise exception 'chat_shared_source_record: the moment is too far in the past'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'chat_shared_source:plaid_connection:' || p_owner_user_id::text || ':' || p_resource_id::text, 0));

  -- Decide only on what is read under the lock.
  if not exists (
    select 1
      from public.chat_sessions c
     where c.id = p_session_id
       and c.user_id = p_user_id
       and c.ended_at is null
  ) then
    return 'refused';
  end if;

  if not exists (
    select 1
      from public.share_grants g
     where g.owner_user_id = p_owner_user_id
       and g.resource_type = 'plaid_connection'
       and g.resource_id = p_resource_id
       and g.grantee_user_id = p_user_id
       and g.revoked_at is null
       and exists (
         select 1
           from public.household_members m
          where m.household_id = g.household_id
            and m.user_id = g.owner_user_id
            and m.status = 'active'
       )
       and exists (
         select 1
           from public.household_members m
          where m.household_id = g.household_id
            and m.user_id = g.grantee_user_id
            and m.status = 'active'
       )
  ) then
    return 'refused';
  end if;

  insert into public.chat_shared_sources as s
    (session_id, user_id, owner_user_id, resource_type, resource_id, first_shared_at)
  values
    (p_session_id, p_user_id, p_owner_user_id, 'plaid_connection', p_resource_id,
     least(p_shared_at, v_now))
  on conflict on constraint chat_shared_sources_session_source_key
  do update set first_shared_at = least(s.first_shared_at, excluded.first_shared_at);

  return 'recorded';
end;
$$;

revoke all on function public.chat_shared_source_record(uuid, uuid, uuid, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.chat_shared_source_record(uuid, uuid, uuid, bigint, timestamptz) to service_role;

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

  return null;
end;
$$;

revoke all on function public.chat_shared_sources_purge_on_grant_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_share_grants_purge_chat on public.share_grants;
create trigger trg_share_grants_purge_chat
after delete on public.share_grants
for each row execute function public.chat_shared_sources_purge_on_grant_delete();

-- Rows left while the trigger was absent: for every source row without its
-- grant, what the trigger does.
with orphan as (
  select s.id, s.session_id, s.user_id, s.first_shared_at
    from public.chat_shared_sources s
   where not exists (
           select 1
             from public.share_grants g
            where g.owner_user_id = s.owner_user_id
              and g.resource_type = s.resource_type
              and g.resource_id = s.resource_id
              and g.grantee_user_id = s.user_id
         )
), removed as (
  delete from public.chat_messages m
   using orphan o
   where m.session_id = o.session_id
     and m.user_id = o.user_id
     and m.created_at >= o.first_shared_at
  returning m.session_id
), counted as (
  select r.session_id, count(*)::integer as n
    from removed r
   group by r.session_id
), lowered as (
  update public.chat_sessions c
     set message_count = greatest(c.message_count - k.n, 0)
    from counted k
   where c.id = k.session_id
  returning c.id
)
delete from public.chat_shared_sources s
 using orphan o
 where s.id = o.id;

do $$
declare
  v_table regclass := 'public.chat_shared_sources'::regclass;
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_record regprocedure :=
    'public.chat_shared_source_record(uuid, uuid, uuid, bigint, timestamptz)'::regprocedure;
  v_purge regprocedure :=
    'public.chat_shared_sources_purge_on_grant_delete()'::regprocedure;
  v_owned regclass[] := array[
    'public.chat_messages'::regclass,
    'public.chat_sessions'::regclass,
    'public.chat_shared_sources'::regclass
  ];
  v_rel regclass;
  v_remaining text;
  v_rls boolean;
  v_policies integer;
  v_ok boolean;
  v_fk record;
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_proowner oid;
  v_count integer;
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_privileges := v_privileges || 'MAINTAIN'::text;
  end if;

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

  -- 4. service_role holds exactly SELECT and INSERT on the table, UPDATE on
  --    first_shared_at and on no other column, and no column REFERENCES.
  select string_agg(p.privilege, ', ')
    into v_remaining
    from unnest(v_privileges) as p(privilege)
   where (p.privilege = any(array['SELECT', 'INSERT']))
         <> has_table_privilege('service_role', v_table, p.privilege);
  if v_remaining is not null then
    raise exception '%: service_role privileges differ from SELECT, INSERT at: %',
      v_table, v_remaining;
  end if;
  select string_agg(a.attname::text, ', ')
    into v_remaining
    from pg_attribute a
   where a.attrelid = v_table
     and a.attnum > 0
     and not a.attisdropped
     and (a.attname = 'first_shared_at')
         <> has_column_privilege('service_role', v_table, a.attname, 'UPDATE');
  if v_remaining is not null then
    raise exception '%: service_role column UPDATE differs from first_shared_at only at: %',
      v_table, v_remaining;
  end if;
  if has_any_column_privilege('service_role', v_table, 'REFERENCES') then
    raise exception '%: service_role holds a column REFERENCES', v_table;
  end if;

  -- 5. The owner keeps DELETE, so the foreign-key cascades can delete rows.
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

  -- 7. Exactly two foreign keys, session_id and user_id, both on delete
  --    cascade. owner_user_id and resource_id reference nothing: a foreign
  --    key there would remove the row before the purge trigger reads it, or
  --    refuse the delete that ends the grant.
  for v_fk in
    select *
      from (values
        (array['session_id'], 'public.chat_sessions', array['id']),
        (array['user_id'],    'public.users',         array['id'])
      ) as t(cols, ref_table, ref_cols)
  loop
    select exists (
      select 1
        from pg_constraint k
       where k.conrelid = v_table
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
        v_table, v_fk.cols, v_fk.ref_table, v_fk.ref_cols;
    end if;
  end loop;
  select count(*) into v_count
    from pg_constraint k
   where k.conrelid = v_table
     and k.contype = 'f';
  if v_count <> 2 then
    raise exception '%: expected two foreign keys, found %', v_table, v_count;
  end if;

  -- 8. The unique constraint the recording function's insert names, on
  --    exactly these columns, in this order.
  select exists (
    select 1
      from pg_constraint k
     where k.conrelid = v_table
       and k.contype = 'u'
       and k.conname = 'chat_shared_sources_session_source_key'
       and array(
             select a.attname::text
               from unnest(k.conkey) with ordinality as u(attnum, n)
               join pg_attribute a
                 on a.attrelid = k.conrelid
                and a.attnum = u.attnum
              order by u.n
           ) = array['session_id', 'owner_user_id', 'resource_type', 'resource_id']
  ) into v_ok;
  if not v_ok then
    raise exception '%: no unique constraint chat_shared_sources_session_source_key on (session_id, owner_user_id, resource_type, resource_id)', v_table;
  end if;

  -- 9. The recording function: SECURITY INVOKER, an empty search_path, no
  --    EXECUTE for PUBLIC, anon or authenticated, and EXECUTE for
  --    service_role.
  if has_function_privilege('anon', v_record, 'EXECUTE')
     or has_function_privilege('authenticated', v_record, 'EXECUTE') then
    raise exception '%: anon or authenticated still holds EXECUTE', v_record;
  end if;
  select p.proacl, p.prosecdef, p.proconfig
    into v_proacl, v_prosecdef, v_proconfig
    from pg_proc p
   where p.oid = v_record;
  -- A null ACL is the default, which grants EXECUTE to PUBLIC.
  if v_proacl is null
     or exists (select 1 from aclexplode(v_proacl) a where a.grantee = 0) then
    raise exception '%: PUBLIC still holds EXECUTE', v_record;
  end if;
  if v_prosecdef then
    raise exception '%: expected SECURITY INVOKER', v_record;
  end if;
  if v_proconfig is null or not ('search_path=""' = any(v_proconfig)) then
    raise exception '%: expected an empty search_path, found %', v_record, v_proconfig;
  end if;
  if not has_function_privilege('service_role', v_record, 'EXECUTE') then
    raise exception '%: service_role lacks EXECUTE', v_record;
  end if;

  -- 10. The purge function: SECURITY DEFINER, an empty search_path, and no
  --     role other than its owner holds EXECUTE, service_role included.
  select p.proacl, p.prosecdef, p.proconfig, p.proowner
    into v_proacl, v_prosecdef, v_proconfig, v_proowner
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

  -- 11. The purge function's owner owns every table it writes, and none of
  --     them forces row level security on its owner. Otherwise its deletes
  --     and its update would match no row, with no error.
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
  if not has_table_privilege(v_proowner, 'public.chat_messages'::regclass, 'DELETE') then
    raise exception '%: its owner lacks DELETE on public.chat_messages', v_purge;
  end if;
  if not has_table_privilege(v_proowner, 'public.chat_sessions'::regclass, 'UPDATE') then
    raise exception '%: its owner lacks UPDATE on public.chat_sessions', v_purge;
  end if;
  if not has_table_privilege(v_proowner, v_table, 'DELETE') then
    raise exception '%: its owner lacks DELETE on %', v_purge, v_table;
  end if;

  -- 12. share_grants carries exactly one user trigger: the purge trigger,
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

  -- 13. No source row is left without its grant.
  select count(*) into v_count
    from public.chat_shared_sources s
   where not exists (
           select 1
             from public.share_grants g
            where g.owner_user_id = s.owner_user_id
              and g.resource_type = s.resource_type
              and g.resource_id = s.resource_id
              and g.grantee_user_id = s.user_id
         );
  if v_count <> 0 then
    raise exception '%: % rows have no share grant', v_table, v_count;
  end if;
end
$$;

commit;
