-- Migration: households, household members, share grants and goals
-- Date: 2026-11-08
--
-- What this file does:
--   - Creates four tables. Ownership stays with the person; a household is a
--     sharing layer above people, and every user is meant to have exactly one
--     active household, a one-person household by default.
--       households         id, created_at. No column points at a user.
--       household_members  one row per membership. household_id cascades from
--                          households, user_id cascades from public.users.
--                          role is 'owner' or 'member', status is 'active' or
--                          'left', and left_at is set exactly when status is
--                          'left'. A partial unique index allows at most one
--                          active membership per user.
--       share_grants       a person's permission for a household to see one
--                          of their resources. owner_user_id cascades from
--                          public.users, household_id from households.
--                          resource_type admits only 'plaid_connection' (a
--                          plaid_connections row, named by resource_id), and
--                          scope admits only 'view'.
--       goals              a personal goal (owner_user_id set, household_id
--                          null) or a joint goal (household_id set,
--                          owner_user_id null), never both and never neither.
--                          created_by is set null when its user is deleted,
--                          so a joint goal outlives the member who made it.
--                          Amounts are integer cents. monthly_amount_cents is
--                          the amount the user chose and may be null. status
--                          is 'active', 'completed' or 'archived'.
--   - Creates public.household_ensure_for_user(uuid): returns the user's
--     active household id, creating a one-person household and its owner
--     membership in the same transaction when there is none. Concurrent calls
--     for the same user serialize on a per-user advisory lock, so only one
--     household is created. A user id with no public.users row fails on the
--     foreign key and rolls the whole call back, household included.
--   - Creates public.household_delete_if_no_active_members() and an AFTER
--     DELETE OR UPDATE OF status trigger on household_members that deletes a
--     household once it has no active member. Deleting a public.users row
--     cascades to that user's memberships, so the trigger removes a
--     one-person household in the same statement as the users delete, and the
--     household's joint goals and share grants go with it through their own
--     cascades.
--   - Drops public.update_updated_at_column() and the type public.account_type.
--     Nothing depends on either once 20261104130000_drop_unused_legacy_tables.sql
--     is applied: the legacy-table triggers that call
--     public.update_updated_at_column() are dropped with their tables by that
--     file. This drop therefore passes only in a database where that migration
--     was applied first. In a database where it was not, the drop, which has
--     no cascade, fails on those triggers and the whole file rolls back.
--     Both are named with the public schema: a
--     function with the same name exists in the storage schema and has a
--     trigger on it, and it must stay.
--
-- What this file does not do:
--   - It writes no row. There is no backfill: a user gets a household the
--     next time household_ensure_for_user runs for them.
--   - share_grants.resource_id has no foreign key, because resource_type and
--     resource_id name a resource generically. Disconnecting a bank connection
--     does not remove grants that name it.
--   - goals carry no progress or accumulated amount, and no suggested value.
--
-- Access: service role only. RLS is on with no policies, and every privilege
-- on the four tables and EXECUTE on both functions is revoked from PUBLIC,
-- anon and authenticated. service_role is granted only what this stage uses:
-- SELECT and INSERT on households and household_members (the ensure function
-- and the account export), SELECT on share_grants and goals (the export), and
-- EXECUTE on household_ensure_for_user. Both functions have an empty
-- search_path. household_ensure_for_user is SECURITY INVOKER.
-- household_delete_if_no_active_members is SECURITY DEFINER, owned by the
-- owner of households, and no role holds EXECUTE on it: EXECUTE is revoked
-- from PUBLIC, anon, authenticated and service_role.
--
-- Why the cleanup function is SECURITY DEFINER. An AFTER trigger fired by a
-- foreign-key cascade runs as the role that issued the outer delete, not as
-- the owner of the table: service_role when the account deletion deletes the
-- public.users row, supabase_auth_admin when an Auth user is deleted. Neither
-- holds DELETE on households, and the trigger's delete is checked for
-- privilege even when it matches no row, so as SECURITY INVOKER the trigger
-- made every such delete fail with 42501 and roll back. As SECURITY DEFINER
-- the delete runs with the owner's privileges whoever issued the outer
-- statement, and no role is granted DELETE on households. The function body
-- names only schema-qualified objects and deletes at most the one household
-- named by OLD.household_id, and only when it has no active member. A future
-- path that sets a member to 'left' as service_role needs UPDATE on
-- household_members, not DELETE on households.
--
-- The closing DO block checks the end state by property and raises, rolling
-- the whole file back, unless every property holds.
--
-- Order of deployment: the account export reads three of these tables, so
-- apply this file to a database before deploying code that exports them.
-- The profile sync calls household_ensure_for_user but treats a failure as
-- non-fatal.
--
-- Running it again: every statement is idempotent (create ... if not exists,
-- create or replace, drop ... if exists, revoke then grant, drop and
-- recreate the triggers), so a second run changes nothing and the DO block
-- passes again.
--
-- To reverse it (after the application code that reads these tables or calls
-- the function is reverted and deployed):
--   begin;
--   drop table if exists public.goals;
--   drop table if exists public.share_grants;
--   drop table if exists public.household_members;
--   drop table if exists public.households;
--   drop function if exists public.household_ensure_for_user(uuid);
--   drop function if exists public.household_delete_if_no_active_members();
--   create or replace function public.update_updated_at_column()
--   returns trigger as $$
--   begin
--     new.updated_at = now();
--     return new;
--   end;
--   $$ language plpgsql;
--   commit;
-- The definition of public.account_type is not in this repository; no
-- migration creates it. Recreating it uses the type's DDL from the
-- operator's catalog backup taken before the legacy-table drop.

begin;

set local lock_timeout = '5s';

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          text not null check (role in ('owner', 'member')),
  status        text not null default 'active' check (status in ('active', 'left')),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  constraint household_members_left_at_matches_status
    check ((status = 'left') = (left_at is not null))
);

create unique index if not exists household_members_one_active_per_user
  on public.household_members (user_id)
  where status = 'active';

create index if not exists household_members_household_id_idx
  on public.household_members (household_id);

create table if not exists public.share_grants (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  household_id   uuid not null references public.households(id) on delete cascade,
  resource_type  text not null check (resource_type in ('plaid_connection')),
  resource_id    bigint not null,
  scope          text not null check (scope in ('view')),
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

create unique index if not exists share_grants_one_open_grant
  on public.share_grants (household_id, resource_type, resource_id, scope)
  where revoked_at is null;

create index if not exists share_grants_owner_user_id_idx
  on public.share_grants (owner_user_id);

create table if not exists public.goals (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('personal', 'joint')),
  owner_user_id         uuid references public.users(id) on delete cascade,
  household_id          uuid references public.households(id) on delete cascade,
  created_by            uuid references public.users(id) on delete set null,
  target_amount_cents   bigint not null check (target_amount_cents > 0),
  target_date           date,
  monthly_amount_cents  bigint check (monthly_amount_cents > 0),
  status                text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint goals_owner_matches_kind check (
    (kind = 'personal' and owner_user_id is not null and household_id is null)
    or (kind = 'joint' and household_id is not null and owner_user_id is null)
  )
);

create index if not exists goals_owner_user_id_idx
  on public.goals (owner_user_id);

create index if not exists goals_household_id_idx
  on public.goals (household_id);

create index if not exists goals_created_by_idx
  on public.goals (created_by);

drop trigger if exists trg_goals_updated_at on public.goals;
create trigger trg_goals_updated_at
before update on public.goals
for each row execute function public.set_current_timestamp_updated_at();

revoke all on table public.households from public, anon, authenticated;
revoke all on table public.households from service_role;
grant select, insert on table public.households to service_role;
alter table public.households enable row level security;

revoke all on table public.household_members from public, anon, authenticated;
revoke all on table public.household_members from service_role;
grant select, insert on table public.household_members to service_role;
alter table public.household_members enable row level security;

revoke all on table public.share_grants from public, anon, authenticated;
revoke all on table public.share_grants from service_role;
grant select on table public.share_grants to service_role;
alter table public.share_grants enable row level security;

revoke all on table public.goals from public, anon, authenticated;
revoke all on table public.goals from service_role;
grant select on table public.goals to service_role;
alter table public.goals enable row level security;

create or replace function public.household_ensure_for_user(p_user_id uuid)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  if p_user_id is null then
    raise exception 'household_ensure_for_user: a user id is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));

  select m.household_id
    into v_household_id
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_household_id is not null then
    return v_household_id;
  end if;

  insert into public.households default values
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, role, status)
  values (v_household_id, p_user_id, 'owner', 'active');

  return v_household_id;
end;
$$;

revoke all on function public.household_ensure_for_user(uuid)
  from public, anon, authenticated;
grant execute on function public.household_ensure_for_user(uuid) to service_role;

create or replace function public.household_delete_if_no_active_members()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return null;
  end if;

  delete from public.households h
   where h.id = old.household_id
     and not exists (
       select 1
         from public.household_members m
        where m.household_id = old.household_id
          and m.status = 'active'
     );

  return null;
end;
$$;

revoke all on function public.household_delete_if_no_active_members()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_household_members_cleanup on public.household_members;
create trigger trg_household_members_cleanup
after delete or update of status on public.household_members
for each row execute function public.household_delete_if_no_active_members();

drop function if exists public.update_updated_at_column();
drop type if exists public.account_type;

do $$
declare
  v_tables text[] := array['households', 'household_members', 'share_grants', 'goals'];
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
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
  v_proowner oid;
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_privileges := v_privileges || 'MAINTAIN'::text;
  end if;

  foreach v_name in array v_tables loop
    v_table := ('public.' || v_name)::regclass;

    -- D-a. No table or column privilege for anon or authenticated.
    select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
      into v_remaining
      from unnest(array['anon', 'authenticated']) as r(role_name)
     cross join unnest(v_privileges) as p(privilege)
     where has_table_privilege(r.role_name, v_table, p.privilege)
        or has_any_column_privilege(r.role_name, v_table, 'SELECT,INSERT,UPDATE,REFERENCES');
    if v_remaining is not null then
      raise exception '%: client roles still hold privileges: %', v_table, v_remaining;
    end if;

    -- D-b. No table privilege for PUBLIC (grantee 0).
    if exists (
      select 1
        from pg_class c,
             lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = v_table
         and a.grantee = 0
    ) then
      raise exception '%: PUBLIC still holds a table privilege', v_table;
    end if;

    -- D-c. RLS on, no policies.
    select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
    if v_rls is distinct from true then
      raise exception '%: row level security is not enabled', v_table;
    end if;
    select count(*) into v_policies from pg_policy where polrelid = v_table;
    if v_policies <> 0 then
      raise exception '%: expected no policies, found %', v_table, v_policies;
    end if;

    -- D-d. service_role holds exactly the privileges this stage uses.
    v_expected := case
      when v_name in ('households', 'household_members') then array['SELECT', 'INSERT']
      else array['SELECT']
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

    -- D-j. The owner keeps DELETE, so the foreign-key cascades, which run as
    --      the table owner, can delete rows. The cleanup trigger does not run
    --      as the owner; D-m checks the function that gives it the owner's
    --      privileges.
    if not exists (
      select 1 from pg_class c
       where c.oid = v_table
         and has_table_privilege(c.relowner, v_table, 'DELETE')
    ) then
      raise exception '%: the table owner lacks DELETE', v_table;
    end if;
  end loop;

  -- D-e. Every foreign key and its on delete action: c is cascade, n is set
  --      null. A key missing, pointing elsewhere, or with another action fails.
  for v_fk in
    select *
      from (values
        ('household_members', 'household_id',  'public.households', 'c'),
        ('household_members', 'user_id',       'public.users',      'c'),
        ('share_grants',      'owner_user_id', 'public.users',      'c'),
        ('share_grants',      'household_id',  'public.households', 'c'),
        ('goals',             'owner_user_id', 'public.users',      'c'),
        ('goals',             'household_id',  'public.households', 'c'),
        ('goals',             'created_by',    'public.users',      'n')
      ) as f(tbl, col, ref, action)
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
         and k.confdeltype::text = v_fk.action
    ) into v_ok;
    if not v_ok then
      raise exception 'public.%: % does not reference % with on delete action %',
        v_fk.tbl, v_fk.col, v_fk.ref, v_fk.action;
    end if;
  end loop;

  -- No foreign key from these tables to public.users may restrict or take no
  -- action: account deletion deletes the users row.
  if exists (
    select 1
      from pg_constraint k
     where k.conrelid = any(array[
             'public.household_members'::regclass,
             'public.share_grants'::regclass,
             'public.goals'::regclass])
       and k.contype = 'f'
       and k.confrelid = 'public.users'::regclass
       and k.confdeltype not in ('c', 'n')
  ) then
    raise exception 'a foreign key to public.users restricts or takes no action on delete';
  end if;

  -- D-f. At most one active membership per user.
  select exists (
    select 1
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid
       and a.attnum = i.indkey[0]
     where i.indrelid = 'public.household_members'::regclass
       and i.indisunique
       and i.indnatts = 1
       and a.attname = 'user_id'
       and pg_get_expr(i.indpred, i.indrelid) = '(status = ''active''::text)'
  ) into v_ok;
  if not v_ok then
    raise exception 'public.household_members: no unique index on user_id where status is active';
  end if;

  -- D-k. share_grants.scope admits exactly 'view'.
  select exists (
    select 1
      from pg_constraint k
      join pg_attribute a
        on a.attrelid = k.conrelid
       and a.attnum = k.conkey[1]
     where k.conrelid = 'public.share_grants'::regclass
       and k.contype = 'c'
       and cardinality(k.conkey) = 1
       and a.attname = 'scope'
       and pg_get_constraintdef(k.oid) = 'CHECK ((scope = ''view''::text))'
  ) into v_ok;
  if not v_ok then
    raise exception 'public.share_grants: scope has no check admitting exactly view';
  end if;

  -- D-l. goals.status admits exactly 'active', 'completed' and 'archived'.
  select exists (
    select 1
      from pg_constraint k
      join pg_attribute a
        on a.attrelid = k.conrelid
       and a.attnum = k.conkey[1]
     where k.conrelid = 'public.goals'::regclass
       and k.contype = 'c'
       and cardinality(k.conkey) = 1
       and a.attname = 'status'
       and pg_get_constraintdef(k.oid)
           = 'CHECK ((status = ANY (ARRAY[''active''::text, ''completed''::text, ''archived''::text])))'
  ) into v_ok;
  if not v_ok then
    raise exception 'public.goals: status has no check admitting exactly active, completed and archived';
  end if;

  -- D-g. Both functions: no EXECUTE for anon, authenticated or PUBLIC, and
  --      an empty search_path. The ensure function: SECURITY INVOKER, and
  --      service_role executes it.
  foreach v_fn in array array[
    'public.household_ensure_for_user(uuid)'::regprocedure,
    'public.household_delete_if_no_active_members()'::regprocedure
  ] loop
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
    if v_proconfig is null or not ('search_path=""' = any(v_proconfig)) then
      raise exception '%: expected an empty search_path, found %', v_fn, v_proconfig;
    end if;
  end loop;
  select p.prosecdef into v_prosecdef
    from pg_proc p
   where p.oid = 'public.household_ensure_for_user(uuid)'::regprocedure;
  if v_prosecdef then
    raise exception 'public.household_ensure_for_user(uuid): expected SECURITY INVOKER';
  end if;
  if not has_function_privilege(
       'service_role', 'public.household_ensure_for_user(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'public.household_ensure_for_user(uuid): service_role lacks EXECUTE';
  end if;

  -- D-m. The cleanup function: SECURITY DEFINER, owned by the owner of
  --      households, that owner holds DELETE on households, and no role other
  --      than the owner holds EXECUTE, service_role included.
  v_fn := 'public.household_delete_if_no_active_members()'::regprocedure;
  select p.proacl, p.prosecdef, p.proowner
    into v_proacl, v_prosecdef, v_proowner
    from pg_proc p
   where p.oid = v_fn;
  if v_prosecdef is distinct from true then
    raise exception '%: expected SECURITY DEFINER', v_fn;
  end if;
  if v_proowner is distinct from (
    select c.relowner from pg_class c where c.oid = 'public.households'::regclass
  ) then
    raise exception '%: not owned by the owner of public.households', v_fn;
  end if;
  if not has_table_privilege(v_proowner, 'public.households'::regclass, 'DELETE') then
    raise exception '%: its owner lacks DELETE on public.households', v_fn;
  end if;
  if v_proacl is null
     or exists (
       select 1 from aclexplode(v_proacl) a where a.grantee <> v_proowner
     ) then
    raise exception '%: a role other than its owner holds EXECUTE', v_fn;
  end if;
  if has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception '%: service_role holds EXECUTE', v_fn;
  end if;

  -- D-h. The cleanup trigger: enabled, row level, AFTER, on DELETE and UPDATE.
  select exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.household_members'::regclass
       and t.tgfoid = 'public.household_delete_if_no_active_members()'::regprocedure
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and (t.tgtype & 1) = 1
       and (t.tgtype & 2) = 0
       and (t.tgtype & 8) = 8
       and (t.tgtype & 16) = 16
  ) into v_ok;
  if not v_ok then
    raise exception 'public.household_members: the cleanup trigger is missing or not an enabled AFTER DELETE OR UPDATE row trigger';
  end if;

  -- D-i. The two public objects are gone; the storage function stays.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'update_updated_at_column'
  ) then
    raise exception 'public.update_updated_at_column still exists';
  end if;
  if to_regtype('public.account_type') is not null then
    raise exception 'public.account_type still exists';
  end if;
  if to_regnamespace('storage') is not null
     and not exists (
       select 1
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'storage'
          and p.proname = 'update_updated_at_column'
     ) then
    raise exception 'storage.update_updated_at_column is missing';
  end if;
end
$$;

commit;
