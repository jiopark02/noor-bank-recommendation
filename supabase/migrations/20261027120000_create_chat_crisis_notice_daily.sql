-- Migration: daily count of crisis notices shown by POST /api/chat
-- Date: 2026-10-27
--
-- Purpose: the chat route attaches a fixed crisis notice to its response when
-- the user's latest message carries a crisis signal. chat_crisis_notice_record
-- adds one to the count for the current UTC day, category and variant, once
-- per request that received the notice.
--
-- What a row holds: a UTC day, a category, a variant and a count. Rows carry
-- no user, session, or generation identifier and no time finer than a UTC
-- day. No conversation text.
--
-- Access: service role only. RLS is on with no policies; every privilege on
-- the table and EXECUTE on the function is revoked from PUBLIC, anon and
-- authenticated, and only what the function needs is granted to
-- service_role. The function is SECURITY INVOKER with an empty search_path.
-- The privileges are stated explicitly, so the end state is the same whether
-- or not a default ACL grants privileges on new tables. The DO block checks
-- the end state by property and rolls the file back unless every property
-- holds.
--
-- The application treats a failed count as dropped (it never blocks or
-- changes a response), so a missing function loses counts silently. Apply
-- this file before the code that calls it is deployed.
--
-- To reverse it (after the application code that calls this function is
-- reverted and deployed; the counts are lost):
--   drop function if exists public.chat_crisis_notice_record(text, text);
--   drop table if exists public.chat_crisis_notice_daily;

begin;

set local lock_timeout = '5s';

create table if not exists public.chat_crisis_notice_daily (
  day          date   not null,
  category     text   not null,
  variant      text   not null,
  notice_count bigint not null default 0,
  primary key (day, category, variant),
  constraint chat_crisis_notice_daily_category_check
    check (category in ('self_harm', 'harm_to_others', 'eating')),
  constraint chat_crisis_notice_daily_variant_check
    check (variant in ('standard', 'escalated')),
  constraint chat_crisis_notice_daily_count_check
    check (notice_count >= 0)
);

revoke all on table public.chat_crisis_notice_daily from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only the three the function uses.
revoke all on table public.chat_crisis_notice_daily from service_role;
grant select, insert, update on table public.chat_crisis_notice_daily to service_role;
alter table public.chat_crisis_notice_daily enable row level security;

-- The day is decided by the database, in UTC.
create or replace function public.chat_crisis_notice_record(
  p_category text,
  p_variant text
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.chat_crisis_notice_daily as d (day, category, variant, notice_count)
  values ((now() at time zone 'utc')::date, p_category, p_variant, 1)
  on conflict (day, category, variant)
  do update set notice_count = d.notice_count + 1;
$$;

revoke all on function public.chat_crisis_notice_record(text, text)
  from public, anon, authenticated;
grant execute on function public.chat_crisis_notice_record(text, text)
  to service_role;

do $$
declare
  v_table regclass := 'public.chat_crisis_notice_daily'::regclass;
  v_fn regprocedure := 'public.chat_crisis_notice_record(text, text)'::regprocedure;
  v_expected_checks text[] := array[
    'chat_crisis_notice_daily_category_check',
    'chat_crisis_notice_daily_variant_check',
    'chat_crisis_notice_daily_count_check'
  ];
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_remaining text;
  v_column_grantees text;
  v_rls boolean;
  v_policies integer;
  v_missing text[];
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_provolatile "char";
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_privileges := v_privileges || 'MAINTAIN'::text;
  end if;

  -- 1. No table privilege for anon or authenticated.
  select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
    into v_remaining
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(v_privileges) as p(privilege)
   where has_table_privilege(r.role_name, v_table, p.privilege);
  if v_remaining is not null then
    raise exception
      'chat_crisis_notice_daily: client roles still hold privileges after revoke: %',
      v_remaining;
  end if;

  -- 2. has_table_privilege does not see column-level grants.
  select string_agg(r.role_name, ', ')
    into v_column_grantees
    from unnest(array['anon', 'authenticated']) as r(role_name)
   where has_any_column_privilege(
           r.role_name, v_table, 'SELECT,INSERT,UPDATE,REFERENCES'
         );
  if v_column_grantees is not null then
    raise exception
      'chat_crisis_notice_daily: client roles still hold column privileges after revoke: %',
      v_column_grantees;
  end if;

  -- 3. No table privilege for PUBLIC (grantee 0).
  if exists (
    select 1
      from pg_class c,
           lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = v_table
       and a.grantee = 0
  ) then
    raise exception 'chat_crisis_notice_daily: PUBLIC still holds a table privilege';
  end if;

  -- 4. RLS on, no policies.
  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
  if v_rls is distinct from true then
    raise exception 'chat_crisis_notice_daily: row level security is not enabled';
  end if;

  select count(*) into v_policies from pg_policy where polrelid = v_table;
  if v_policies <> 0 then
    raise exception 'chat_crisis_notice_daily: expected no policies, found %', v_policies;
  end if;

  -- 5. Every CHECK named above exists.
  v_missing := array(
    select unnest(v_expected_checks)
    except
    select conname::text
      from pg_constraint
     where conrelid = v_table and contype = 'c'
  );
  if cardinality(v_missing) > 0 then
    raise exception
      'chat_crisis_notice_daily: expected CHECK constraints are missing (the table may predate this file): %',
      array_to_string(v_missing, ', ');
  end if;

  -- 6. service_role can read, insert and update, and holds nothing else on the
  --    table, at table or column level. This holds whether or not a default
  --    ACL granted service_role privileges when the table was created.
  if not has_table_privilege('service_role', v_table, 'SELECT')
     or not has_table_privilege('service_role', v_table, 'INSERT')
     or not has_table_privilege('service_role', v_table, 'UPDATE') then
    raise exception 'chat_crisis_notice_daily: service_role lacks SELECT, INSERT or UPDATE';
  end if;

  select string_agg(p.privilege, ', ')
    into v_remaining
    from unnest(v_privileges) as p(privilege)
   where p.privilege not in ('SELECT', 'INSERT', 'UPDATE')
     and has_table_privilege('service_role', v_table, p.privilege);
  if v_remaining is not null then
    raise exception
      'chat_crisis_notice_daily: service_role holds privileges beyond SELECT, INSERT, UPDATE: %',
      v_remaining;
  end if;

  if has_any_column_privilege('service_role', v_table, 'REFERENCES') then
    raise exception 'chat_crisis_notice_daily: service_role holds column-level REFERENCES';
  end if;

  -- 7. The function: no EXECUTE for anon, authenticated or PUBLIC, EXECUTE for
  --    service_role, SECURITY INVOKER, empty search_path, VOLATILE.
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '%: anon or authenticated still holds EXECUTE', v_fn;
  end if;

  select p.proacl, p.prosecdef, p.proconfig, p.provolatile
    into v_proacl, v_prosecdef, v_proconfig, v_provolatile
    from pg_proc p
   where p.oid = v_fn;

  -- A null ACL is the default, which grants EXECUTE to PUBLIC.
  if v_proacl is null then
    raise exception '%: ACL is the default, which grants PUBLIC EXECUTE', v_fn;
  end if;
  if exists (select 1 from aclexplode(v_proacl) a where a.grantee = 0) then
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
  if v_provolatile <> 'v' then
    raise exception '%: expected VOLATILE', v_fn;
  end if;
end
$$;

commit;
