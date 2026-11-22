-- Migration: the bank connections another household member shares with a person
-- Date: 2026-11-23
--
-- Why. A share grant lets the owner of a bank connection let one other member
-- of their household see it. Until now nothing read a connection on the
-- grantee's behalf. This file adds the one function that answers which
-- connection rows a person may read because they were shared with them, so
-- every condition is decided in one statement, inside the database, and no
-- application module that reads bank data needs to name the sharing tables.
--
-- What this file does:
--   - Creates public.household_shared_connections(p_user_id uuid). It returns
--     one row per connection shared with p_user_id:
--       owner_user_id     the person whose connection it is
--       connection_id     plaid_connections.id of that connection
--       item_id           plaid_connections.item_id
--       access_token      plaid_connections.access_token, as stored
--                         (encrypted; it decrypts only with the owner's id)
--       institution_name  plaid_connections.institution_name
--     ordered by owner, then connection. A row is returned only when, in the
--     same statement:
--       - a grant of that connection names p_user_id as its grantee, is of
--         resource type 'plaid_connection' and scope 'view', and is not
--         revoked;
--       - the grant's owner is not p_user_id;
--       - both the owner and p_user_id are active members of the grant's
--         household;
--       - the connection row belongs to the grant's owner and has status
--         'active'.
--     The household id alone decides nothing: membership of both people is
--     read for the grant's own household.
--   - Changes no table, policy, privilege on a table, or trigger, and writes
--     nothing. The function is STABLE and takes no lock.
--
-- Access: SECURITY INVOKER with an empty search_path. EXECUTE is revoked
-- from PUBLIC, anon and authenticated and granted to service_role only, so
-- the caller is a server route that passes the id it verified from the
-- request's bearer token. It reads share_grants, household_members and
-- plaid_connections with the caller's privileges; service_role needs SELECT
-- on each, which the closing DO block checks.
--
-- Before it changes anything, the file raises unless
-- plaid_connections.user_id is a uuid and share_grants has grantee_user_id:
-- apply 20261121120000_household_share_grants.sql first.
--
-- The closing DO block checks the end state by property and raises, rolling
-- the whole file back, unless every property holds.
--
-- Order of deployment: apply this file to a database before deploying code
-- that calls the function against it. Whether this file is applied is live
-- state.
--
-- Running it again: create or replace keeps the same signature and result
-- columns, and the DO block passes again. Changing the result columns later
-- needs a drop of the function first.
--
-- 20261121120000_household_share_grants.sql should not be reversed while
-- this file is applied: its reverse drops share_grants.grantee_user_id,
-- which this function reads, and every later call would fail. Reverse this
-- file first.
--
-- To reverse it (after the application code that calls the function is
-- reverted and deployed):
--   drop function if exists public.household_shared_connections(uuid);

begin;

set local lock_timeout = '5s';

do $$
begin
  if (
    select format_type(a.atttypid, a.atttypmod)
      from pg_attribute a
     where a.attrelid = 'public.plaid_connections'::regclass
       and a.attname = 'user_id'
       and not a.attisdropped
  ) is distinct from 'uuid' then
    raise exception 'public.plaid_connections.user_id is not a uuid';
  end if;
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

create or replace function public.household_shared_connections(p_user_id uuid)
returns table (
  owner_user_id uuid,
  connection_id bigint,
  item_id text,
  access_token text,
  institution_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.user_id,
         c.id,
         c.item_id::text,
         c.access_token::text,
         c.institution_name::text
    from public.share_grants g
    join public.plaid_connections c
      on c.user_id = g.owner_user_id
     and c.id = g.resource_id
   where g.grantee_user_id = p_user_id
     and g.owner_user_id <> p_user_id
     and g.resource_type = 'plaid_connection'
     and g.scope = 'view'
     and g.revoked_at is null
     and c.status = 'active'
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
   order by c.user_id, c.id;
$$;

revoke all on function public.household_shared_connections(uuid)
  from public, anon, authenticated;
grant execute on function public.household_shared_connections(uuid) to service_role;

do $$
declare
  v_fn regprocedure := 'public.household_shared_connections(uuid)'::regprocedure;
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_provolatile "char";
  v_table regclass;
begin
  -- 1. No EXECUTE for anon or authenticated.
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '%: anon or authenticated still holds EXECUTE', v_fn;
  end if;

  select p.proacl, p.prosecdef, p.proconfig, p.provolatile
    into v_proacl, v_prosecdef, v_proconfig, v_provolatile
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

  -- 5. STABLE: it writes nothing.
  if v_provolatile <> 's' then
    raise exception '%: expected STABLE, found %', v_fn, v_provolatile;
  end if;

  -- 6. service_role executes it.
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception '%: service_role lacks EXECUTE', v_fn;
  end if;

  -- 7. service_role can read every table the function reads.
  foreach v_table in array array[
    'public.share_grants'::regclass,
    'public.household_members'::regclass,
    'public.plaid_connections'::regclass
  ] loop
    if not has_table_privilege('service_role', v_table, 'SELECT') then
      raise exception '%: service_role lacks SELECT on %', v_fn, v_table;
    end if;
  end loop;
end
$$;

commit;
