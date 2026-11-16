-- Migration: issue limit for new-connection Plaid link tokens
-- Date: 2026-11-13
--
-- Purpose: one row per Auth user who has been issued a link token for a new
-- bank connection. plaid_link_token_claim decides, in one statement, whether
-- another link token may be issued now: at most p_max_count inside a window of
-- p_window_seconds that starts at the first issue of the window. A claim that
-- passes records itself; one that does not changes nothing. Concurrent claims
-- for the same user serialize on the row lock of the upsert, so two of them
-- cannot both pass on the same row.
--
-- The count and the window length are arguments: the application holds their
-- values, and this file holds none. The function refuses an argument that is
-- null or below 1 with SQLSTATE 22023 rather than deciding on it.
--
-- What a row holds: the user id, one timestamp and a count. No email address,
-- no token.
--
-- Access: service role only. RLS is on with no policies; every privilege on
-- the table and EXECUTE on the function is revoked from PUBLIC, anon and
-- authenticated. service_role is granted exactly what the function and the
-- account export use on the table (SELECT, INSERT, UPDATE), and EXECUTE on the
-- function. The function is SECURITY INVOKER with an empty search_path, so it
-- runs with the caller's privileges. The DO block checks the end state by
-- property and rolls the file back unless every property holds.
--
-- Deletion: user_id cascades from auth.users, so deleting the Auth user
-- removes its row. The cascade runs as the table's owner, which keeps DELETE.
--
-- Order: the application treats a failed claim as "do not issue", and the
-- account export reads this table, so this file is applied before the code
-- that calls the function or exports the table is deployed, and removed only
-- after that code is reverted.
--
-- To reverse it (after the application code that calls the function and
-- exports the table is reverted and deployed):
--   drop function if exists public.plaid_link_token_claim(uuid, integer, integer);
--   drop table if exists public.plaid_link_token_issues;

begin;

set local lock_timeout = '5s';

create table if not exists public.plaid_link_token_issues (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  window_start  timestamptz not null,
  window_count  int not null
);

revoke all on table public.plaid_link_token_issues from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only the three the function and the export use.
revoke all on table public.plaid_link_token_issues from service_role;
grant select, insert, update on table public.plaid_link_token_issues to service_role;
alter table public.plaid_link_token_issues enable row level security;

create or replace function public.plaid_link_token_claim(
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
    raise exception 'plaid_link_token_claim: invalid arguments'
      using errcode = '22023';
  end if;

  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  with claimed as (
    insert into public.plaid_link_token_issues as s
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

revoke all on function public.plaid_link_token_claim(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.plaid_link_token_claim(uuid, integer, integer) to service_role;

do $$
declare
  v_table regclass := 'public.plaid_link_token_issues'::regclass;
  v_fn regprocedure := 'public.plaid_link_token_claim(uuid, integer, integer)'::regprocedure;
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_remaining text;
  v_rls boolean;
  v_policies integer;
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
      'public.plaid_link_token_issues: client roles still hold privileges after revoke: %',
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
    raise exception 'public.plaid_link_token_issues: PUBLIC still holds a table privilege';
  end if;

  -- 3. RLS on, no policies.
  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
  if v_rls is distinct from true then
    raise exception 'public.plaid_link_token_issues: row level security is not enabled';
  end if;
  select count(*) into v_policies from pg_policy where polrelid = v_table;
  if v_policies <> 0 then
    raise exception 'public.plaid_link_token_issues: expected no policies, found %', v_policies;
  end if;

  -- 4. service_role reads, inserts and updates, and holds nothing else.
  if not has_table_privilege('service_role', v_table, 'SELECT')
     or not has_table_privilege('service_role', v_table, 'INSERT')
     or not has_table_privilege('service_role', v_table, 'UPDATE') then
    raise exception 'public.plaid_link_token_issues: service_role lacks SELECT, INSERT or UPDATE';
  end if;
  select string_agg(p.privilege, ', ')
    into v_remaining
    from unnest(v_privileges) as p(privilege)
   where p.privilege not in ('SELECT', 'INSERT', 'UPDATE')
     and has_table_privilege('service_role', v_table, p.privilege);
  if v_remaining is not null then
    raise exception
      'public.plaid_link_token_issues: service_role holds privileges beyond SELECT, INSERT, UPDATE: %',
      v_remaining;
  end if;

  -- 5. user_id references auth.users and cascades on delete, and the owner
  --    keeps DELETE so the cascade can run (it would not if this file ran as
  --    service_role and revoked its own privilege above). A table created
  --    before this file, without the key, fails here.
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
      'public.plaid_link_token_issues: user_id does not reference auth.users with on delete cascade';
  end if;
  if not exists (
    select 1 from pg_class c
     where c.oid = v_table
       and has_table_privilege(c.relowner, v_table, 'DELETE')
  ) then
    raise exception
      'public.plaid_link_token_issues: the table owner lacks DELETE, so the cascade from auth.users would fail';
  end if;

  -- 6. The function: no EXECUTE for anon, authenticated or PUBLIC, EXECUTE for
  --    service_role, SECURITY INVOKER, empty search_path.
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
end
$$;

commit;
