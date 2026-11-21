-- Migration: one-time email codes that confirm a recent sign-in before an
-- account action
-- Date: 2026-11-21
--
-- Purpose: one row per Auth user holding the latest code the application
-- issued to them, for one purpose: deleting the account or exporting its
-- data. The application makes the code, stores only its hash here, and emails
-- the code itself to the address on the verified token. Three functions
-- decide, each in one statement or under one row lock:
--
--   account_reauth_issue   stores a new code, unless the user is over the
--                          issue limit for the window. 'issued' or 'held'. A
--                          held call changes nothing. A new code replaces the
--                          previous one, its attempts and its verification.
--   account_reauth_verify  counts the attempt first, then compares the hash.
--                          'verified', 'refused' or 'locked'. An attempt is
--                          counted only on a code that is current: same
--                          purpose, not expired, not yet verified, under the
--                          attempt limit. A verification records the sign-in
--                          session that made it.
--   account_reauth_check   true while a verification for the purpose, made by
--                          the same sign-in session, is younger than the
--                          window. With p_consume it also ends the code, in
--                          the same statement, so one verification answers one
--                          check.
--
-- The session is the session_id claim of the access token the application
-- verified with the auth server; a verification made in one session does not
-- answer for another.
--
-- Every count, lifetime and window is an argument: the application holds the
-- values, and this file holds none. A function refuses an argument that is
-- null or out of range with SQLSTATE 22023 rather than deciding on it.
--
-- What a row holds: the user id, the purpose, the code's hash, three
-- timestamps, two counts and the id of the session that verified it. No
-- email address, no code.
--
-- Access: service role only. RLS is on with no policies; every privilege on
-- the table and EXECUTE on the functions is revoked from PUBLIC, anon and
-- authenticated. service_role is granted exactly what the functions and the
-- account export use on the table (SELECT, INSERT, UPDATE), and EXECUTE on
-- the three functions. The functions are SECURITY INVOKER with an empty
-- search_path, so they run with the caller's privileges. The DO block checks
-- the end state by property and rolls the file back unless every property
-- holds.
--
-- Deletion: user_id cascades from auth.users, so deleting the Auth user
-- removes its row. The cascade runs as the table's owner, which keeps DELETE.
-- The row references auth.users and not public.users: account deletion
-- removes the public.users row before the Auth user, and a retry after a
-- failure between the two steps still finds its verification.
--
-- Order: the application refuses an account deletion or export when a check
-- cannot be made, and the account export reads this table, so this file is
-- applied before the code that calls the functions or exports the table is
-- deployed, and removed only after that code is reverted.
--
-- To reverse it (after the application code that calls the functions and
-- exports the table is reverted and deployed):
--   drop function if exists public.account_reauth_check(uuid, text, uuid, integer, boolean);
--   drop function if exists public.account_reauth_verify(uuid, text, text, uuid, integer);
--   drop function if exists public.account_reauth_issue(uuid, text, text, integer, integer, integer);
--   drop table if exists public.account_reauth_codes;

begin;

set local lock_timeout = '5s';

create table if not exists public.account_reauth_codes (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  purpose       text not null,
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      int not null,
  verified_at   timestamptz,
  verified_session_id uuid,
  window_start  timestamptz not null,
  window_count  int not null,
  constraint account_reauth_codes_purpose_check
    check (purpose in ('delete_account', 'export_data')),
  constraint account_reauth_codes_counts_check
    check (attempts >= 0 and window_count >= 1),
  constraint account_reauth_codes_verified_session_check
    check ((verified_at is null) = (verified_session_id is null))
);

revoke all on table public.account_reauth_codes from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only the three the functions and the export use.
revoke all on table public.account_reauth_codes from service_role;
grant select, insert, update on table public.account_reauth_codes to service_role;
alter table public.account_reauth_codes enable row level security;

create or replace function public.account_reauth_issue(
  p_user_id uuid,
  p_purpose text,
  p_code_hash text,
  p_ttl_seconds integer,
  p_max_issues integer,
  p_window_seconds integer
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window interval;
  v_issued boolean;
begin
  if p_user_id is null
     or p_purpose is null or p_purpose not in ('delete_account', 'export_data')
     or p_code_hash is null or pg_catalog.length(p_code_hash) = 0
     or p_ttl_seconds is null or p_ttl_seconds < 1
     or p_max_issues is null or p_max_issues < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'account_reauth_issue: invalid arguments'
      using errcode = '22023';
  end if;

  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  with issued as (
    insert into public.account_reauth_codes as c
      (user_id, purpose, code_hash, expires_at, attempts, verified_at,
       verified_session_id, window_start, window_count)
    values
      (p_user_id, p_purpose, p_code_hash,
       pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds),
       0, null, null, pg_catalog.now(), 1)
    on conflict (user_id) do update
       set purpose = excluded.purpose,
           code_hash = excluded.code_hash,
           expires_at = excluded.expires_at,
           attempts = 0,
           verified_at = null,
           verified_session_id = null,
           window_start = case
             when c.window_start <= pg_catalog.now() - v_window
               then pg_catalog.now()
             else c.window_start
           end,
           window_count = case
             when c.window_start <= pg_catalog.now() - v_window
               then 1
             else c.window_count + 1
           end
     where c.window_start <= pg_catalog.now() - v_window
        or c.window_count < p_max_issues
    returning true
  )
  select exists (select 1 from issued) into v_issued;

  if v_issued then
    return 'issued';
  end if;
  return 'held';
end
$$;

revoke all on function public.account_reauth_issue(uuid, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.account_reauth_issue(uuid, text, text, integer, integer, integer)
  to service_role;

create or replace function public.account_reauth_verify(
  p_user_id uuid,
  p_purpose text,
  p_code_hash text,
  p_session_id uuid,
  p_max_attempts integer
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_hash text;
  v_attempts integer;
begin
  if p_user_id is null
     or p_purpose is null or p_purpose not in ('delete_account', 'export_data')
     or p_code_hash is null or pg_catalog.length(p_code_hash) = 0
     or p_session_id is null
     or p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'account_reauth_verify: invalid arguments'
      using errcode = '22023';
  end if;

  -- The attempt is counted before the hash is compared, in the statement
  -- that takes the row lock, so concurrent attempts are counted one by one.
  update public.account_reauth_codes c
     set attempts = c.attempts + 1
   where c.user_id = p_user_id
     and c.purpose = p_purpose
     and c.verified_at is null
     and c.expires_at > pg_catalog.now()
     and c.attempts < p_max_attempts
  returning c.code_hash, c.attempts into v_hash, v_attempts;

  if not found then
    if exists (
      select 1
        from public.account_reauth_codes c
       where c.user_id = p_user_id
         and c.purpose = p_purpose
         and c.verified_at is null
         and c.expires_at > pg_catalog.now()
         and c.attempts >= p_max_attempts
    ) then
      return 'locked';
    end if;
    return 'refused';
  end if;

  if v_hash = p_code_hash then
    update public.account_reauth_codes c
       set verified_at = pg_catalog.now(),
           verified_session_id = p_session_id
     where c.user_id = p_user_id;
    return 'verified';
  end if;

  if v_attempts >= p_max_attempts then
    return 'locked';
  end if;
  return 'refused';
end
$$;

revoke all on function public.account_reauth_verify(uuid, text, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.account_reauth_verify(uuid, text, text, uuid, integer)
  to service_role;

create or replace function public.account_reauth_check(
  p_user_id uuid,
  p_purpose text,
  p_session_id uuid,
  p_window_seconds integer,
  p_consume boolean
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window interval;
  v_ok boolean;
begin
  if p_user_id is null
     or p_purpose is null or p_purpose not in ('delete_account', 'export_data')
     or p_session_id is null
     or p_window_seconds is null or p_window_seconds < 1
     or p_consume is null then
    raise exception 'account_reauth_check: invalid arguments'
      using errcode = '22023';
  end if;

  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  if p_consume then
    -- Ends the code in the statement that finds the verification, so two
    -- concurrent checks cannot both pass on it.
    with consumed as (
      update public.account_reauth_codes c
         set verified_at = null,
             verified_session_id = null,
             expires_at = pg_catalog.now()
       where c.user_id = p_user_id
         and c.purpose = p_purpose
         and c.verified_session_id = p_session_id
         and c.verified_at is not null
         and c.verified_at > pg_catalog.now() - v_window
      returning true
    )
    select exists (select 1 from consumed) into v_ok;
    return v_ok;
  end if;

  select exists (
    select 1
      from public.account_reauth_codes c
     where c.user_id = p_user_id
       and c.purpose = p_purpose
       and c.verified_session_id = p_session_id
       and c.verified_at is not null
       and c.verified_at > pg_catalog.now() - v_window
  ) into v_ok;
  return v_ok;
end
$$;

revoke all on function public.account_reauth_check(uuid, text, uuid, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.account_reauth_check(uuid, text, uuid, integer, boolean)
  to service_role;

do $$
declare
  v_table regclass := 'public.account_reauth_codes'::regclass;
  v_fns regprocedure[] := array[
    'public.account_reauth_issue(uuid, text, text, integer, integer, integer)'::regprocedure,
    'public.account_reauth_verify(uuid, text, text, uuid, integer)'::regprocedure,
    'public.account_reauth_check(uuid, text, uuid, integer, boolean)'::regprocedure
  ];
  v_fn regprocedure;
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_remaining text;
  v_rls boolean;
  v_policies integer;
  v_triggers integer;
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_fk_ok boolean;
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_privileges := v_privileges || 'MAINTAIN'::text;
  end if;

  -- 1. No table privilege for anon or authenticated, at table or column level.
  select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
    into v_remaining
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(v_privileges) as p(privilege)
   where has_table_privilege(r.role_name, v_table, p.privilege)
      or has_any_column_privilege(r.role_name, v_table, 'SELECT,INSERT,UPDATE,REFERENCES');
  if v_remaining is not null then
    raise exception
      'public.account_reauth_codes: client roles still hold privileges after revoke: %',
      v_remaining;
  end if;

  -- 2. No table privilege for PUBLIC (grantee 0).
  if exists (
    select 1
      from pg_class c,
           lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = v_table
       and a.grantee = 0
  ) then
    raise exception 'public.account_reauth_codes: PUBLIC still holds a table privilege';
  end if;

  -- 3. RLS on, no policies, no triggers.
  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
  if v_rls is distinct from true then
    raise exception 'public.account_reauth_codes: row level security is not enabled';
  end if;
  select count(*) into v_policies from pg_policy where polrelid = v_table;
  if v_policies <> 0 then
    raise exception 'public.account_reauth_codes: expected no policies, found %', v_policies;
  end if;
  select count(*) into v_triggers
    from pg_trigger t
   where t.tgrelid = v_table
     and not t.tgisinternal;
  if v_triggers <> 0 then
    raise exception 'public.account_reauth_codes: expected no triggers, found %', v_triggers;
  end if;

  -- 4. service_role reads, inserts and updates, and holds nothing else.
  if not has_table_privilege('service_role', v_table, 'SELECT')
     or not has_table_privilege('service_role', v_table, 'INSERT')
     or not has_table_privilege('service_role', v_table, 'UPDATE') then
    raise exception 'public.account_reauth_codes: service_role lacks SELECT, INSERT or UPDATE';
  end if;
  select string_agg(p.privilege, ', ')
    into v_remaining
    from unnest(v_privileges) as p(privilege)
   where p.privilege not in ('SELECT', 'INSERT', 'UPDATE')
     and has_table_privilege('service_role', v_table, p.privilege);
  if v_remaining is not null then
    raise exception
      'public.account_reauth_codes: service_role holds privileges beyond SELECT, INSERT, UPDATE: %',
      v_remaining;
  end if;

  -- 5. user_id references auth.users and cascades on delete, and the owner
  --    keeps DELETE so the cascade can run. A table created before this
  --    file, without the key, fails here.
  select exists (
    select 1
      from pg_constraint k
      join pg_attribute a
        on a.attrelid = k.conrelid
       and a.attnum = k.conkey[1]
     where k.conrelid = v_table
       and k.contype = 'f'
       and cardinality(k.conkey) = 1
       and a.attname = 'user_id'
       and k.confrelid = 'auth.users'::regclass
       and k.confdeltype = 'c'
  ) into v_fk_ok;
  if not v_fk_ok then
    raise exception
      'public.account_reauth_codes: user_id does not reference auth.users with on delete cascade';
  end if;
  if not exists (
    select 1 from pg_class c
     where c.oid = v_table
       and has_table_privilege(c.relowner, v_table, 'DELETE')
  ) then
    raise exception
      'public.account_reauth_codes: the table owner lacks DELETE, so the cascade from auth.users would fail';
  end if;

  -- 6. A verification always names its session: the check constraint that
  --    holds verified_at and verified_session_id set or unset together. A
  --    table created before this file, without it, fails here.
  if not exists (
    select 1
      from pg_constraint k
     where k.conrelid = v_table
       and k.contype = 'c'
       and k.conname = 'account_reauth_codes_verified_session_check'
  ) then
    raise exception
      'public.account_reauth_codes: verified_at and verified_session_id are not held together';
  end if;

  -- 7. Each function: no EXECUTE for anon, authenticated or PUBLIC, EXECUTE
  --    for service_role, SECURITY INVOKER, empty search_path.
  foreach v_fn in array v_fns loop
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
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '%: service_role lacks EXECUTE', v_fn;
    end if;
    if v_prosecdef then
      raise exception '%: expected SECURITY INVOKER', v_fn;
    end if;
    if v_proconfig is null or not ('search_path=""' = any(v_proconfig)) then
      raise exception '%: expected an empty search_path, found %', v_fn, v_proconfig;
    end if;
  end loop;
end
$$;

commit;
