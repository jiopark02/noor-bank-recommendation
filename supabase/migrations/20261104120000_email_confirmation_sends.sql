-- Migration: send limit for signup confirmation emails
-- Date: 2026-11-04
--
-- Purpose: one row per Auth user the application has sent a signup
-- confirmation email to. email_confirmation_claim decides, in one statement,
-- whether another email may go out now: at least 60 seconds since the last
-- one, and at most 5 inside a 24-hour window that starts at the first send of
-- the window. A claim that passes records itself; one that does not changes
-- nothing. Concurrent claims for the same user serialize on the row lock of
-- the upsert, so two of them cannot both pass on the same row.
--
-- What a row holds: the user id, two timestamps and a count. No email address.
--
-- Access: service role only. RLS is on with no policies; every privilege on
-- the table and EXECUTE on the function is revoked from PUBLIC, anon and
-- authenticated. service_role is granted exactly what the function uses on
-- the table, and EXECUTE on the function. The function is SECURITY INVOKER
-- with an empty search_path, so it runs with the caller's privileges. The DO
-- block checks the end state by property and rolls the file back unless every
-- property holds.
--
-- Deletion: the table has no foreign key to auth.users; deleting an Auth user
-- leaves its row.
--
-- The application treats a failed claim as "do not send", so this file is
-- applied before the code that calls the function is deployed, and removed
-- only after that code is reverted.
--
-- To reverse it (after the application code that calls the function is
-- reverted and deployed):
--   drop function if exists public.email_confirmation_claim(uuid);
--   drop table if exists public.email_confirmation_sends;

begin;

set local lock_timeout = '5s';

create table if not exists public.email_confirmation_sends (
  user_id       uuid primary key,
  last_sent_at  timestamptz not null,
  window_start  timestamptz not null,
  window_count  int not null
);

revoke all on table public.email_confirmation_sends from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only the three the function uses.
revoke all on table public.email_confirmation_sends from service_role;
grant select, insert, update on table public.email_confirmation_sends to service_role;
alter table public.email_confirmation_sends enable row level security;

create or replace function public.email_confirmation_claim(p_user_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  with claimed as (
    insert into public.email_confirmation_sends as s
      (user_id, last_sent_at, window_start, window_count)
    values (p_user_id, pg_catalog.now(), pg_catalog.now(), 1)
    on conflict (user_id) do update
       set last_sent_at = pg_catalog.now(),
           window_start = case
             when s.window_start <= pg_catalog.now() - interval '24 hours'
               then pg_catalog.now()
             else s.window_start
           end,
           window_count = case
             when s.window_start <= pg_catalog.now() - interval '24 hours'
               then 1
             else s.window_count + 1
           end
     where s.last_sent_at <= pg_catalog.now() - interval '60 seconds'
       and (s.window_start <= pg_catalog.now() - interval '24 hours'
            or s.window_count < 5)
    returning true
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.email_confirmation_claim(uuid)
  from public, anon, authenticated;
grant execute on function public.email_confirmation_claim(uuid) to service_role;

do $$
declare
  v_table regclass := 'public.email_confirmation_sends'::regclass;
  v_fn regprocedure := 'public.email_confirmation_claim(uuid)'::regprocedure;
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_remaining text;
  v_rls boolean;
  v_policies integer;
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
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
      'public.email_confirmation_sends: client roles still hold privileges after revoke: %',
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
    raise exception 'public.email_confirmation_sends: PUBLIC still holds a table privilege';
  end if;

  -- 3. RLS on, no policies.
  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
  if v_rls is distinct from true then
    raise exception 'public.email_confirmation_sends: row level security is not enabled';
  end if;
  select count(*) into v_policies from pg_policy where polrelid = v_table;
  if v_policies <> 0 then
    raise exception 'public.email_confirmation_sends: expected no policies, found %', v_policies;
  end if;

  -- 4. service_role reads, inserts and updates, and holds nothing else.
  if not has_table_privilege('service_role', v_table, 'SELECT')
     or not has_table_privilege('service_role', v_table, 'INSERT')
     or not has_table_privilege('service_role', v_table, 'UPDATE') then
    raise exception 'public.email_confirmation_sends: service_role lacks SELECT, INSERT or UPDATE';
  end if;
  select string_agg(p.privilege, ', ')
    into v_remaining
    from unnest(v_privileges) as p(privilege)
   where p.privilege not in ('SELECT', 'INSERT', 'UPDATE')
     and has_table_privilege('service_role', v_table, p.privilege);
  if v_remaining is not null then
    raise exception
      'public.email_confirmation_sends: service_role holds privileges beyond SELECT, INSERT, UPDATE: %',
      v_remaining;
  end if;

  -- 5. The function: no EXECUTE for anon, authenticated or PUBLIC, EXECUTE for
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
