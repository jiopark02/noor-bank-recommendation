-- Migration: household invites, joining and leaving a household
-- Date: 2026-11-20
--
-- What this file does:
--   - Creates two tables.
--       household_invites        one open invite per household. household_id
--                                cascades from households, invited_by from
--                                public.users. invitee_email is the address
--                                the invite is for, already trimmed and
--                                lowercased by the application. token_hash is
--                                the SHA-256 of the invite token, as 64
--                                lowercase hex characters; the token itself is
--                                never stored. A unique index on household_id
--                                allows one open invite per household, and one
--                                on token_hash makes a token name one row.
--       household_invite_issues  the invite-creation count per user: the user
--                                id, the window start and a count. No email
--                                address, no token. user_id cascades from
--                                public.users.
--   - Grants service_role UPDATE on household_members, on the status, left_at
--     and role columns only. user_id and household_id stay unwritable, so no
--     path here can move a membership to another person or household.
--   - Creates these functions, each SECURITY INVOKER with an empty
--     search_path, executed by service_role only:
--       household_max_members()          the most active members a household
--                                        can have. The application holds the
--                                        same number.
--       household_invite_claim           the per-user invite-creation limit, in
--                                        one upsert; count and window are
--                                        arguments.
--       household_repair_owner           gives a household with active members
--                                        but no active owner one owner again.
--                                        A household reaches that state only
--                                        when its owner's account is deleted:
--                                        the membership row goes with the
--                                        users row and nothing promotes the
--                                        other member at that moment.
--       household_invite_create          replaces the household's open invite.
--       household_invite_cancel          deletes the caller's household invite.
--       household_invite_accept          moves the caller into the invite's
--                                        household.
--       household_leave                  ends the caller's membership.
--       household_invites_prune_expired  deletes every expired invite.
--
-- Locking. Every function that reads a membership and then writes takes two
-- transaction-level advisory locks, always in this order: first the caller's
-- user lock, the same key household_ensure_for_user takes, then the lock of
-- each household it will change, keyed on the household id; accepting an
-- invite can name two households and locks them in ascending id order. Once
-- the household locks are held the function reads the memberships and the
-- invite again and decides only on what it read under them, because the other
-- person's leave, accept or account deletion takes their own user lock, not
-- the caller's.
--
-- Owner succession. Leaving as the owner while another member is active makes
-- the earliest-joined active member (ties by id) the owner before the leaving
-- membership is set to 'left', in the same transaction. Account deletion is
-- not changed: when the owner's account is deleted, household_repair_owner
-- promotes the remaining member the next time the application reads that
-- household or creates an invite for it. It changes nothing when an active
-- owner exists. A household left with no active member at all is deleted by
-- the existing cleanup trigger, which this file does not change.
--
-- Accepting an invite answers 'refused' for a token that names no invite, an
-- expired invite, an address that does not match, and a household that
-- disappeared before the membership was written, without telling them apart.
-- Only a caller whose address matches gets any other answer. The caller's
-- previous household, when they were alone in it, is left by setting their
-- membership to 'left'; the existing cleanup trigger then deletes it.
--
-- Access: service role only. RLS is on with no policies on both new tables,
-- and every privilege on them and EXECUTE on every function is revoked from
-- PUBLIC, anon and authenticated. service_role holds SELECT, INSERT and
-- DELETE on household_invites, SELECT, INSERT and UPDATE on
-- household_invite_issues, and EXECUTE on every function. This file creates
-- no SECURITY DEFINER function and no trigger, and does not change any
-- existing function or trigger.
--
-- The closing DO block checks the end state by property and raises, rolling
-- the whole file back, unless every property holds.
--
-- Order of deployment: the application's household routes call these
-- functions and the account export reads both new tables, so this file is
-- applied to a database before that code is deployed against it, and removed
-- only after that code is reverted. Whether it is applied is live state.
--
-- Running it again: every statement is idempotent. Running
-- 20261108120000_create_households_and_goals.sql again after this file
-- passes that file's DO block, and silently removes the service_role column
-- UPDATE on household_members (status, left_at, role) granted here: that
-- file revokes every service_role privilege on the table and grants back
-- only SELECT and INSERT, and its DO block checks service_role's
-- table-level privileges, not its column privileges. This file's DO block
-- is the one that detects the missing column UPDATE. Applying this file
-- again grants it back, and its DO block then passes.
--
-- To reverse it (after the application code that calls the functions and
-- exports the tables is reverted and deployed):
--   begin;
--   drop function if exists public.household_invites_prune_expired();
--   drop function if exists public.household_leave(uuid);
--   drop function if exists public.household_invite_accept(uuid, text, text);
--   drop function if exists public.household_invite_cancel(uuid);
--   drop function if exists public.household_invite_create(uuid, text, text, integer);
--   drop function if exists public.household_repair_owner(uuid);
--   drop function if exists public.household_invite_claim(uuid, integer, integer);
--   drop function if exists public.household_max_members();
--   revoke update (status, left_at, role) on table public.household_members from service_role;
--   drop table if exists public.household_invites;
--   drop table if exists public.household_invite_issues;
--   commit;

begin;

set local lock_timeout = '5s';

create table if not exists public.household_invites (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  invited_by     uuid not null references public.users(id) on delete cascade,
  invitee_email  text not null,
  token_hash     text not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  constraint household_invites_email_shape check (
    invitee_email = btrim(invitee_email)
    and char_length(invitee_email) between 1 and 320
  ),
  constraint household_invites_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists household_invites_one_per_household
  on public.household_invites (household_id);

create unique index if not exists household_invites_token_hash_key
  on public.household_invites (token_hash);

create index if not exists household_invites_expires_at_idx
  on public.household_invites (expires_at);

create index if not exists household_invites_invited_by_idx
  on public.household_invites (invited_by);

create table if not exists public.household_invite_issues (
  user_id       uuid primary key references public.users(id) on delete cascade,
  window_start  timestamptz not null,
  window_count  int not null
);

revoke all on table public.household_invites from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only what the functions and the export use.
revoke all on table public.household_invites from service_role;
grant select, insert, delete on table public.household_invites to service_role;
alter table public.household_invites enable row level security;

revoke all on table public.household_invite_issues from public, anon, authenticated;
revoke all on table public.household_invite_issues from service_role;
grant select, insert, update on table public.household_invite_issues to service_role;
alter table public.household_invite_issues enable row level security;

grant update (status, left_at, role) on table public.household_members to service_role;

create or replace function public.household_max_members()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 2
$$;

create or replace function public.household_invite_claim(
  p_user_id uuid,
  p_max_count integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window interval;
  v_claimed boolean;
begin
  if p_user_id is null
     or p_max_count is null or p_max_count < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'household_invite_claim: invalid arguments'
      using errcode = '22023';
  end if;

  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  with claimed as (
    insert into public.household_invite_issues as s
      (user_id, window_start, window_count)
    values (p_user_id, pg_catalog.now(), 1)
    on conflict (user_id) do update
       set window_start = case
             when s.window_start <= pg_catalog.now() - v_window
               then pg_catalog.now()
             else s.window_start
           end,
           window_count = case
             when s.window_start <= pg_catalog.now() - v_window
               then 1
             else s.window_count + 1
           end
     where s.window_start <= pg_catalog.now() - v_window
        or s.window_count < p_max_count
    returning true
  )
  select exists (select 1 from claimed) into v_claimed;

  return v_claimed;
end
$$;

create or replace function public.household_repair_owner(p_user_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_reread uuid;
begin
  if p_user_id is null then
    raise exception 'household_repair_owner: a user id is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));

  select m.household_id
    into v_household
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_household is null then
    return 'none';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household_group:' || v_household::text, 0));

  select m.household_id
    into v_reread
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_reread is distinct from v_household then
    return 'none';
  end if;

  if exists (
    select 1
      from public.household_members m
     where m.household_id = v_household
       and m.status = 'active'
       and m.role = 'owner'
  ) then
    return 'ok';
  end if;

  update public.household_members
     set role = 'owner'
   where id = (
     select s.id
       from public.household_members s
      where s.household_id = v_household
        and s.status = 'active'
      order by s.joined_at asc, s.id asc
      limit 1
   );

  return 'repaired';
end
$$;

create or replace function public.household_invite_create(
  p_user_id uuid,
  p_email text,
  p_token_hash text,
  p_ttl_seconds integer
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_role text;
  v_active integer;
begin
  if p_user_id is null
     or p_email is null
     or p_token_hash is null
     or p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 86400 then
    raise exception 'household_invite_create: invalid arguments'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));

  select m.household_id
    into v_household
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_household is null then
    return 'not_owner';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household_group:' || v_household::text, 0));

  perform public.household_repair_owner(p_user_id);

  select m.role
    into v_role
    from public.household_members m
   where m.user_id = p_user_id
     and m.household_id = v_household
     and m.status = 'active';
  if v_role is distinct from 'owner' then
    return 'not_owner';
  end if;

  select count(*)
    into v_active
    from public.household_members m
   where m.household_id = v_household
     and m.status = 'active';
  if v_active >= public.household_max_members() then
    return 'household_full';
  end if;

  delete from public.household_invites i
   where i.expires_at <= pg_catalog.now();
  delete from public.household_invites i
   where i.household_id = v_household;

  insert into public.household_invites
    (household_id, invited_by, invitee_email, token_hash, expires_at)
  values (
    v_household,
    p_user_id,
    p_email,
    p_token_hash,
    pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds)
  );

  return 'created';
end
$$;

create or replace function public.household_invite_cancel(p_user_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_role text;
  v_deleted integer;
begin
  if p_user_id is null then
    raise exception 'household_invite_cancel: a user id is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));

  select m.household_id
    into v_household
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_household is null then
    return 'none';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household_group:' || v_household::text, 0));

  select m.role
    into v_role
    from public.household_members m
   where m.user_id = p_user_id
     and m.household_id = v_household
     and m.status = 'active';
  if v_role is null then
    return 'none';
  end if;
  if v_role <> 'owner' then
    return 'not_owner';
  end if;

  delete from public.household_invites i
   where i.household_id = v_household;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return 'none';
  end if;
  return 'cancelled';
end
$$;

create or replace function public.household_invite_accept(
  p_user_id uuid,
  p_token_hash text,
  p_email text
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_target uuid;
  v_current uuid;
  v_reread uuid;
  v_invite_id uuid;
  v_invite_household uuid;
  v_invited_by uuid;
  v_invitee_email text;
  v_expires_at timestamptz;
  v_active integer;
begin
  if p_user_id is null or p_token_hash is null or p_email is null then
    raise exception 'household_invite_accept: invalid arguments'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));

  -- Read before the household locks, only to learn which households to lock.
  select i.household_id
    into v_target
    from public.household_invites i
   where i.token_hash = p_token_hash;
  if v_target is null then
    return 'refused';
  end if;

  select m.household_id
    into v_current
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';

  if v_current is null or v_current = v_target then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('household_group:' || v_target::text, 0));
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('household_group:' || least(v_current, v_target)::text, 0));
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('household_group:' || greatest(v_current, v_target)::text, 0));
  end if;

  -- Read again under the household locks; decide only on these reads.
  select m.household_id
    into v_reread
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_reread is distinct from v_current then
    return 'retry';
  end if;

  select i.id, i.household_id, i.invited_by, i.invitee_email, i.expires_at
    into v_invite_id, v_invite_household, v_invited_by, v_invitee_email, v_expires_at
    from public.household_invites i
   where i.token_hash = p_token_hash;
  if v_invite_id is null
     or v_invite_household is distinct from v_target
     or v_expires_at <= pg_catalog.now()
     or v_invitee_email <> p_email then
    return 'refused';
  end if;

  -- From here on the caller's address matches the invite.
  if v_current = v_target then
    return 'already_member';
  end if;

  if v_current is not null and exists (
    select 1
      from public.household_members m
     where m.household_id = v_current
       and m.status = 'active'
       and m.user_id <> p_user_id
  ) then
    return 'must_leave_first';
  end if;

  select count(*)
    into v_active
    from public.household_members m
   where m.household_id = v_target
     and m.status = 'active';
  if v_active >= public.household_max_members() then
    return 'household_full';
  end if;

  if not exists (
    select 1
      from public.household_members m
     where m.household_id = v_target
       and m.user_id = v_invited_by
       and m.status = 'active'
  ) then
    delete from public.household_invites i
     where i.id = v_invite_id;
    return 'refused';
  end if;

  begin
    delete from public.household_invites i
     where i.id = v_invite_id;

    if v_current is not null then
      update public.household_members
         set status = 'left',
             left_at = pg_catalog.now()
       where user_id = p_user_id
         and household_id = v_current
         and status = 'active';
    end if;

    insert into public.household_members (household_id, user_id, role, status)
    values (v_target, p_user_id, 'member', 'active');
  exception
    when foreign_key_violation then
      -- The invite's household was deleted after the reads above. Everything
      -- in this block is rolled back, so the caller stays where they were.
      return 'refused';
  end;

  return 'accepted';
end
$$;

create or replace function public.household_leave(p_user_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_member_id uuid;
  v_role text;
  v_others integer;
begin
  if p_user_id is null then
    raise exception 'household_leave: a user id is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));

  select m.household_id
    into v_household
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_household is null then
    return 'none';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household_group:' || v_household::text, 0));

  select m.id, m.role
    into v_member_id, v_role
    from public.household_members m
   where m.user_id = p_user_id
     and m.household_id = v_household
     and m.status = 'active';
  if v_member_id is null then
    return 'none';
  end if;

  select count(*)
    into v_others
    from public.household_members m
   where m.household_id = v_household
     and m.status = 'active'
     and m.user_id <> p_user_id;
  if v_others = 0 then
    return 'solo';
  end if;

  if v_role = 'owner' then
    update public.household_members
       set role = 'owner'
     where id = (
       select s.id
         from public.household_members s
        where s.household_id = v_household
          and s.status = 'active'
          and s.user_id <> p_user_id
        order by s.joined_at asc, s.id asc
        limit 1
     );
  end if;

  update public.household_members
     set status = 'left',
         left_at = pg_catalog.now()
   where id = v_member_id;

  delete from public.household_invites i
   where i.invited_by = p_user_id
      or i.household_id = v_household;

  return 'left';
end
$$;

create or replace function public.household_invites_prune_expired()
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.household_invites i
   where i.expires_at <= pg_catalog.now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

revoke all on function public.household_max_members()
  from public, anon, authenticated;
grant execute on function public.household_max_members() to service_role;

revoke all on function public.household_invite_claim(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.household_invite_claim(uuid, integer, integer) to service_role;

revoke all on function public.household_repair_owner(uuid)
  from public, anon, authenticated;
grant execute on function public.household_repair_owner(uuid) to service_role;

revoke all on function public.household_invite_create(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.household_invite_create(uuid, text, text, integer) to service_role;

revoke all on function public.household_invite_cancel(uuid)
  from public, anon, authenticated;
grant execute on function public.household_invite_cancel(uuid) to service_role;

revoke all on function public.household_invite_accept(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.household_invite_accept(uuid, text, text) to service_role;

revoke all on function public.household_leave(uuid)
  from public, anon, authenticated;
grant execute on function public.household_leave(uuid) to service_role;

revoke all on function public.household_invites_prune_expired()
  from public, anon, authenticated;
grant execute on function public.household_invites_prune_expired() to service_role;

do $$
declare
  v_tables text[] := array['household_invites', 'household_invite_issues'];
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_functions regprocedure[] := array[
    'public.household_max_members()'::regprocedure,
    'public.household_invite_claim(uuid, integer, integer)'::regprocedure,
    'public.household_repair_owner(uuid)'::regprocedure,
    'public.household_invite_create(uuid, text, text, integer)'::regprocedure,
    'public.household_invite_cancel(uuid)'::regprocedure,
    'public.household_invite_accept(uuid, text, text)'::regprocedure,
    'public.household_leave(uuid)'::regprocedure,
    'public.household_invites_prune_expired()'::regprocedure
  ];
  v_name text;
  v_table regclass;
  v_expected text[];
  v_remaining text;
  v_rls boolean;
  v_policies integer;
  v_ok boolean;
  v_fk record;
  v_fn regprocedure;
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_count integer;
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_privileges := v_privileges || 'MAINTAIN'::text;
  end if;

  foreach v_name in array v_tables loop
    v_table := ('public.' || v_name)::regclass;

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

    -- 4. service_role holds exactly the privileges the functions and the
    --    export use.
    v_expected := case v_name
      when 'household_invites' then array['SELECT', 'INSERT', 'DELETE']
      else array['SELECT', 'INSERT', 'UPDATE']
    end;
    select string_agg(p.privilege, ', ')
      into v_remaining
      from unnest(v_privileges) as p(privilege)
     where (p.privilege = any(v_expected))
           <> has_table_privilege('service_role', v_table, p.privilege);
    if v_remaining is not null then
      raise exception '%: service_role privileges differ from % at: %',
        v_table, v_expected, v_remaining;
    end if;

    -- 5. The owner keeps DELETE, so the foreign-key cascades can delete rows.
    if not exists (
      select 1 from pg_class c
       where c.oid = v_table
         and has_table_privilege(c.relowner, v_table, 'DELETE')
    ) then
      raise exception '%: the table owner lacks DELETE', v_table;
    end if;
  end loop;

  -- 6. Every foreign key cascades on delete.
  for v_fk in
    select *
      from (values
        ('household_invites',       'household_id', 'public.households'),
        ('household_invites',       'invited_by',   'public.users'),
        ('household_invite_issues', 'user_id',      'public.users')
      ) as f(tbl, col, ref)
  loop
    select exists (
      select 1
        from pg_constraint k
        join pg_attribute a
          on a.attrelid = k.conrelid
         and a.attnum = k.conkey[1]
       where k.conrelid = ('public.' || v_fk.tbl)::regclass
         and k.contype = 'f'
         and cardinality(k.conkey) = 1
         and a.attname = v_fk.col
         and k.confrelid = v_fk.ref::regclass
         and k.confdeltype = 'c'
    ) into v_ok;
    if not v_ok then
      raise exception 'public.%: % does not reference % with on delete cascade',
        v_fk.tbl, v_fk.col, v_fk.ref;
    end if;
  end loop;

  -- 7. One open invite per household, and one row per token hash.
  foreach v_name in array array['household_id', 'token_hash'] loop
    select exists (
      select 1
        from pg_index i
        join pg_attribute a
          on a.attrelid = i.indrelid
         and a.attnum = i.indkey[0]
       where i.indrelid = 'public.household_invites'::regclass
         and i.indisunique
         and i.indnatts = 1
         and i.indpred is null
         and a.attname = v_name
    ) into v_ok;
    if not v_ok then
      raise exception 'public.household_invites: no unique index on %', v_name;
    end if;
  end loop;

  -- 8. household_members: service_role updates status, left_at and role and
  --    no other column, holds no table-level UPDATE or DELETE, and keeps
  --    SELECT and INSERT.
  v_table := 'public.household_members'::regclass;
  if has_table_privilege('service_role', v_table, 'UPDATE')
     or has_table_privilege('service_role', v_table, 'DELETE') then
    raise exception 'public.household_members: service_role holds table-level UPDATE or DELETE';
  end if;
  if not has_table_privilege('service_role', v_table, 'SELECT')
     or not has_table_privilege('service_role', v_table, 'INSERT') then
    raise exception 'public.household_members: service_role lacks SELECT or INSERT';
  end if;
  select string_agg(a.attname::text, ', ')
    into v_remaining
    from pg_attribute a
   where a.attrelid = v_table
     and a.attnum > 0
     and not a.attisdropped
     and (a.attname in ('status', 'left_at', 'role'))
         <> has_column_privilege('service_role', v_table, a.attnum, 'UPDATE');
  if v_remaining is not null then
    raise exception 'public.household_members: service_role column UPDATE differs at: %', v_remaining;
  end if;
  select string_agg(format('%s %s', r.role_name, a.attname), ', ')
    into v_remaining
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join pg_attribute a
   where a.attrelid = v_table
     and a.attnum > 0
     and not a.attisdropped
     and has_column_privilege(r.role_name, v_table, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES');
  if v_remaining is not null then
    raise exception 'public.household_members: client roles hold column privileges: %', v_remaining;
  end if;

  -- 9. Every function: SECURITY INVOKER, an empty search_path, no EXECUTE for
  --    PUBLIC, anon or authenticated, and EXECUTE for service_role.
  foreach v_fn in array v_functions loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '%: anon or authenticated still holds EXECUTE', v_fn;
    end if;
    select p.proacl, p.prosecdef, p.proconfig
      into v_proacl, v_prosecdef, v_proconfig
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
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '%: service_role lacks EXECUTE', v_fn;
    end if;
  end loop;

  -- 10. The most active members a household can have is two.
  if public.household_max_members() is distinct from 2 then
    raise exception 'public.household_max_members(): expected 2';
  end if;

  -- 11. household_members carries exactly one user trigger, the cleanup
  --     trigger, and neither new table carries one.
  select count(*) into v_count
    from pg_trigger t
   where t.tgrelid = 'public.household_members'::regclass
     and not t.tgisinternal;
  if v_count <> 1 or not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.household_members'::regclass
       and not t.tgisinternal
       and t.tgname = 'trg_household_members_cleanup'
  ) then
    raise exception 'public.household_members: expected only the cleanup trigger, found % triggers', v_count;
  end if;
  if exists (
    select 1
      from pg_trigger t
     where t.tgrelid in ('public.household_invites'::regclass, 'public.household_invite_issues'::regclass)
       and not t.tgisinternal
  ) then
    raise exception 'a new household table carries a trigger';
  end if;
end
$$;

commit;
