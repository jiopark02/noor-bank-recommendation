-- Migration: chat usage ledger for the per-user limit on POST /api/chat
-- Date: 2026-10-16
--
-- Purpose: one row per chat request the application admitted for counting.
-- chat_usage_reserve decides whether a request is within the per-user limits
-- and records it, under a per-user advisory lock, in one transaction, so two
-- concurrent requests from the same user cannot both pass on the same count.
-- A row exists from the moment the request is admitted, so a request that is
-- still running is counted. chat_usage_settle replaces the row's estimated
-- cost with the cost the application observed. A row that is never settled
-- keeps its estimate and leaves the windows as it ages; nothing releases it.
--
-- What a row holds: the user id, database timestamps, an estimated and a
-- settled provider cost, an attempt count and the mode. No conversation text.
--
-- Access: service role only. RLS is on with no policies; every privilege on
-- the table and EXECUTE on both functions is revoked from PUBLIC, anon and
-- authenticated, and only what the application needs is granted to
-- service_role. Both functions are SECURITY INVOKER with an empty search_path.
-- The DO block checks the end state by property and rolls the file back
-- unless every property holds.
--
-- Deletion: user_id cascades from auth.users, so deleting the Auth user
-- removes the user's rows.
--
-- The application refuses chat requests when these functions are missing
-- and enforcement is on, so this file is applied before the code that calls
-- them is deployed, and removed only after that code is reverted.
--
-- To reverse it (after the application code that calls these functions is
-- reverted and deployed):
--   drop function if exists public.chat_usage_settle(uuid, uuid, numeric, integer);
--   drop function if exists public.chat_usage_reserve(uuid, uuid, numeric, integer, integer, numeric, boolean);
--   drop table if exists public.chat_usage_reservations;

begin;

set local lock_timeout = '5s';

create table if not exists public.chat_usage_reservations (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default clock_timestamp(),
  mode          text not null,
  hold_cost     numeric(14, 8) not null,
  settled_cost  numeric(14, 8),
  attempts      smallint,
  settled_at    timestamptz,
  constraint chat_usage_reservations_mode_check
    check (mode in ('observe', 'enforce')),
  constraint chat_usage_reservations_hold_cost_check
    check (hold_cost >= 0),
  constraint chat_usage_reservations_settled_cost_check
    check (settled_cost is null or settled_cost >= 0),
  constraint chat_usage_reservations_attempts_check
    check (attempts is null or attempts between 0 and 10),
  constraint chat_usage_reservations_settled_pair_check
    check ((settled_at is null) = (settled_cost is null))
);

-- Serves the window reads and keeps the ON DELETE CASCADE from auth.users off
-- a sequential scan.
create index if not exists idx_chat_usage_reservations_user_created
  on public.chat_usage_reservations (user_id, created_at desc);

revoke all on table public.chat_usage_reservations from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only the three the functions use. The ON DELETE
-- CASCADE from auth.users runs as this table's owner, not as service_role.
revoke all on table public.chat_usage_reservations from service_role;
grant select, insert, update on table public.chat_usage_reservations to service_role;
alter table public.chat_usage_reservations enable row level security;

create or replace function public.chat_usage_reserve(
  p_reservation_id uuid,
  p_user_id        uuid,
  p_hold_cost      numeric,
  p_max_per_hour   integer,   -- null: this limit is off
  p_max_per_day    integer,   -- null: this limit is off
  p_max_cost_30d   numeric,   -- null: this limit is off
  p_enforce        boolean
)
returns table (
  allowed    boolean,
  limit_hit  text,           -- 'hour' | 'day' | '30d' | null
  retry_at   timestamptz,
  hour_count integer,
  day_count  integer,
  cost_30d   numeric
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now        timestamptz;
  v_hour_count integer;
  v_day_count  integer;
  v_cost_30d   numeric;
  v_hit_hour   boolean := false;
  v_hit_day    boolean := false;
  v_hit_cost   boolean := false;
  v_retry_hour timestamptz;
  v_retry_day  timestamptz;
  v_retry_cost timestamptz;
  v_limit_hit  text;
  v_retry_at   timestamptz;
begin
  if p_reservation_id is null or p_user_id is null or p_hold_cost is null
     or p_enforce is null then
    raise exception 'chat_usage_reserve: id, user, hold cost and mode are required';
  end if;
  if (p_max_per_hour is not null and p_max_per_hour < 1)
     or (p_max_per_day is not null and p_max_per_day < 1)
     or (p_max_cost_30d is not null and p_max_cost_30d <= 0) then
    raise exception 'chat_usage_reserve: a limit that is on must be positive';
  end if;

  perform set_config('lock_timeout', '2s', true);
  perform pg_advisory_xact_lock(
    hashtextextended('chat_usage:' || p_user_id::text, 0));
  -- Taken after the lock so a wait does not shift the windows.
  v_now := clock_timestamp();

  -- Idempotent: a call with an id already recorded for this user returns
  -- admitted without inserting.
  if exists (
    select 1
      from public.chat_usage_reservations r
     where r.id = p_reservation_id
       and r.user_id = p_user_id
  ) then
    return query
      select true, null::text, null::timestamptz,
             null::integer, null::integer, null::numeric;
    return;
  end if;

  -- The counts, the cost sum and the cost retry time come from one statement,
  -- so one snapshot. chat_usage_settle takes no lock and can commit between two
  -- statements of this function, lowering a row from its hold; a sum read in
  -- one statement and a running sum read in another could then disagree. Here
  -- the running sum at the oldest row equals the sum, so a sum at or over the
  -- max always yields a retry time.
  select count(*) filter (where s.created_at > v_now - interval '1 hour'),
         count(*) filter (where s.created_at > v_now - interval '1 day'),
         coalesce(sum(s.cost), 0),
         max(s.created_at) filter (where s.running_cost >= p_max_cost_30d)
           + interval '30 days'
    into v_hour_count, v_day_count, v_cost_30d, v_retry_cost
    from (
      select r.created_at,
             coalesce(r.settled_cost, r.hold_cost) as cost,
             sum(coalesce(r.settled_cost, r.hold_cost)) over (
               order by r.created_at desc, r.id desc
               rows between unbounded preceding and current row
             ) as running_cost
        from public.chat_usage_reservations r
       where r.user_id = p_user_id
         and r.created_at > v_now - interval '30 days'
    ) s;

  -- A count limit of C is hit at C rows in the window; the request is admitted
  -- again once the C-th newest row leaves it.
  if p_max_per_hour is not null and v_hour_count >= p_max_per_hour then
    v_hit_hour := true;
    select r.created_at + interval '1 hour'
      into v_retry_hour
      from public.chat_usage_reservations r
     where r.user_id = p_user_id
       and r.created_at > v_now - interval '1 hour'
     order by r.created_at desc, r.id desc
    offset p_max_per_hour - 1
     limit 1;
  end if;

  if p_max_per_day is not null and v_day_count >= p_max_per_day then
    v_hit_day := true;
    select r.created_at + interval '1 day'
      into v_retry_day
      from public.chat_usage_reservations r
     where r.user_id = p_user_id
       and r.created_at > v_now - interval '1 day'
     order by r.created_at desc, r.id desc
    offset p_max_per_day - 1
     limit 1;
  end if;

  -- The cost limit is hit when the window's sum reaches the max; the request
  -- is admitted again once the newest row at which the running sum, newest
  -- first, reaches the max leaves the window. Costs are never negative, so the
  -- rows at which the running sum reaches the max are the oldest ones, and the
  -- newest of them is the first the running sum reaches.
  if p_max_cost_30d is not null and v_cost_30d >= p_max_cost_30d then
    v_hit_cost := true;
  end if;

  -- retry_at is the latest across hit limits (greatest ignores nulls).
  v_retry_at := greatest(v_retry_hour, v_retry_day, v_retry_cost);
  v_limit_hit := case
    when v_hit_cost and v_retry_cost is not distinct from v_retry_at then '30d'
    when v_hit_day and v_retry_day is not distinct from v_retry_at then 'day'
    when v_hit_hour then 'hour'
    when v_hit_day then 'day'
    when v_hit_cost then '30d'
    else null
  end;

  if v_limit_hit is not null and p_enforce then
    return query
      select false, v_limit_hit, v_retry_at,
             v_hour_count, v_day_count, v_cost_30d;
    return;
  end if;

  insert into public.chat_usage_reservations (id, user_id, created_at, mode, hold_cost)
  values (
    p_reservation_id,
    p_user_id,
    v_now,
    case when p_enforce then 'enforce' else 'observe' end,
    p_hold_cost
  );

  return query
    select v_limit_hit is null, v_limit_hit, v_retry_at,
           v_hour_count, v_day_count, v_cost_30d;
end
$$;

create or replace function public.chat_usage_settle(
  p_reservation_id uuid,
  p_user_id        uuid,
  p_cost           numeric,
  p_attempts       integer
)
returns integer   -- rows settled: 1, or 0 when absent or already settled
language sql
volatile
security invoker
set search_path = ''
as $$
  with u as (
    update public.chat_usage_reservations
       set settled_cost = p_cost,
           attempts = p_attempts,
           settled_at = clock_timestamp()
     where id = p_reservation_id
       and user_id = p_user_id
       and settled_at is null
    returning 1
  )
  select count(*)::integer from u;
$$;

revoke all on function public.chat_usage_reserve(uuid, uuid, numeric, integer, integer, numeric, boolean)
  from public, anon, authenticated;
revoke all on function public.chat_usage_settle(uuid, uuid, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.chat_usage_reserve(uuid, uuid, numeric, integer, integer, numeric, boolean)
  to service_role;
grant execute on function public.chat_usage_settle(uuid, uuid, numeric, integer)
  to service_role;

do $$
declare
  v_table regclass := 'public.chat_usage_reservations'::regclass;
  v_functions regprocedure[] := array[
    'public.chat_usage_reserve(uuid, uuid, numeric, integer, integer, numeric, boolean)'::regprocedure,
    'public.chat_usage_settle(uuid, uuid, numeric, integer)'::regprocedure
  ];
  v_expected_checks text[] := array[
    'chat_usage_reservations_mode_check',
    'chat_usage_reservations_hold_cost_check',
    'chat_usage_reservations_settled_cost_check',
    'chat_usage_reservations_attempts_check',
    'chat_usage_reservations_settled_pair_check'
  ];
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_remaining text;
  v_column_grantees text;
  v_rls boolean;
  v_policies integer;
  v_missing text[];
  v_fk_ok boolean;
  v_fn regprocedure;
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
      'chat_usage_reservations: client roles still hold privileges after revoke: %',
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
      'chat_usage_reservations: client roles still hold column privileges after revoke: %',
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
    raise exception 'chat_usage_reservations: PUBLIC still holds a table privilege';
  end if;

  -- 4. RLS on, no policies.
  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
  if v_rls is distinct from true then
    raise exception 'chat_usage_reservations: row level security is not enabled';
  end if;

  select count(*) into v_policies from pg_policy where polrelid = v_table;
  if v_policies <> 0 then
    raise exception 'chat_usage_reservations: expected no policies, found %', v_policies;
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
      'chat_usage_reservations: expected CHECK constraints are missing (the table may predate this file): %',
      array_to_string(v_missing, ', ');
  end if;

  -- 6. user_id references auth.users and cascades on delete.
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
      'chat_usage_reservations: user_id does not reference auth.users with on delete cascade';
  end if;

  -- 7. service_role can read, insert and update, and holds nothing else on the
  --    table, at table or column level.
  if not has_table_privilege('service_role', v_table, 'SELECT')
     or not has_table_privilege('service_role', v_table, 'INSERT')
     or not has_table_privilege('service_role', v_table, 'UPDATE') then
    raise exception 'chat_usage_reservations: service_role lacks SELECT, INSERT or UPDATE';
  end if;

  select string_agg(p.privilege, ', ')
    into v_remaining
    from unnest(v_privileges) as p(privilege)
   where p.privilege not in ('SELECT', 'INSERT', 'UPDATE')
     and has_table_privilege('service_role', v_table, p.privilege);
  if v_remaining is not null then
    raise exception
      'chat_usage_reservations: service_role holds privileges beyond SELECT, INSERT, UPDATE: %',
      v_remaining;
  end if;

  if has_any_column_privilege('service_role', v_table, 'REFERENCES') then
    raise exception 'chat_usage_reservations: service_role holds column-level REFERENCES';
  end if;

  -- The cascade from auth.users deletes as the table owner, so the owner must
  -- keep DELETE (it would not if this file ran as service_role and revoked
  -- its own privilege above).
  if not exists (
    select 1 from pg_class c
     where c.oid = v_table
       and has_table_privilege(c.relowner, v_table, 'DELETE')
  ) then
    raise exception
      'chat_usage_reservations: the table owner lacks DELETE, so the cascade from auth.users would fail';
  end if;

  -- 8. Each function: no EXECUTE for anon, authenticated or PUBLIC, EXECUTE for
  --    service_role, SECURITY INVOKER, empty search_path, VOLATILE.
  foreach v_fn in array v_functions loop
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
  end loop;
end
$$;

commit;
