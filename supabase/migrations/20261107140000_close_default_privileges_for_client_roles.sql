-- New tables, sequences and functions that postgres creates in schema public
-- start with no privileges for anon or authenticated, and new functions that
-- postgres creates in any schema start without EXECUTE for PUBLIC.
--
-- Until this file, the default privileges of postgres in public gave anon,
-- authenticated and service_role every table privilege (arwdDxtm), every
-- sequence privilege (rwU) and function EXECUTE (X), and postgres had no
-- global default-privilege entry, so the built-in default also gave PUBLIC
-- EXECUTE on every new function. supabase_admin held the same entries in
-- public. Every migration that created an object therefore had to revoke from
-- the client roles by hand, and one that forgot left the client roles
-- holding every privilege on the object, with only row level security
-- between them and its rows.
--
-- What this file does not change:
--   - Privileges on objects that already exist. Default privileges apply only
--     when an object is created.
--   - Objects created by supabase_admin. postgres is not a member of
--     supabase_admin and cannot alter that role's default privileges.
--   - The default privileges of service_role, or the entries postgres keeps
--     for service_role.
-- A migration that creates an object still grants what it needs explicitly
-- and asserts the end state; it does not rely on this file having been
-- applied. Whether this file is applied in a given database is live state;
-- read pg_default_acl there rather than inferring it from this file.
--
-- The end state is checked by property, and by creating objects, rather than
-- assumed. The DO block raises, and the whole file rolls back, unless:
--   - it runs as postgres, so the objects it creates get the default
--     privileges this file changes;
--   - no postgres entry for tables, sequences or functions in public names
--     anon or authenticated;
--   - postgres has a global entry for functions, and it gives PUBLIC no
--     EXECUTE;
--   - a table with a serial column, its sequence, and a function, created in
--     public inside this transaction, give anon and authenticated no table or
--     sequence privilege and no EXECUTE, give PUBLIC no EXECUTE on the
--     function, and give service_role SELECT, INSERT, UPDATE and DELETE on
--     the table, USAGE on the sequence and EXECUTE on the function.
-- The test objects are dropped in the same block. If the check fails, look at
-- where the remaining privilege comes from; do not widen this file to make it
-- pass.
--
-- Running this file again reaches the same end state: revoking a default
-- privilege that is not held changes nothing, and the test objects are
-- created and dropped inside the transaction. If an object with a test
-- object's name already exists, the create fails and the file rolls back.
--
-- To reverse it, run as postgres. Granting EXECUTE to PUBLIC globally makes
-- the global entry equal to the built-in default, so PostgreSQL removes it and
-- postgres is left with no global entry, as before this file:
--   alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
--   alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
--   alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
--   alter default privileges for role postgres grant execute on functions to public;

begin;

set local lock_timeout = '5s';

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

do $$
declare
  v_role text;
  v_found text;
  v_acl aclitem[];
  v_table regclass;
  v_seq regclass;
  v_fn regprocedure;
  v_denied text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
begin
  -- The test objects get the default privileges of the role that creates
  -- them, so they test postgres only when postgres creates them.
  if current_user <> 'postgres' then
    raise exception 'default privileges: run this file as postgres, not %', current_user;
  end if;

  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_denied := array_append(v_denied, 'MAINTAIN');
  end if;

  -- By property: any postgres entry in public that still names a client role.
  select string_agg(format('%s:%s', d.defaclobjtype, a.grantee::regrole), ', ')
    into v_found
    from pg_default_acl d,
         lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype in ('r', 'S', 'f')
     and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid);
  if v_found is not null then
    raise exception 'default privileges: postgres entries in public still name client roles: %', v_found;
  end if;

  -- Without a global entry the built-in default gives PUBLIC EXECUTE.
  select d.defaclacl
    into v_acl
    from pg_default_acl d
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 0
     and d.defaclobjtype = 'f';
  if not found then
    raise exception 'default privileges: postgres has no global entry for functions';
  end if;

  if exists (
    select 1
      from aclexplode(v_acl) a
     where a.grantee = 0
       and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'default privileges: the global postgres entry still gives PUBLIC EXECUTE';
  end if;

  -- Create objects and read the privileges they were actually given.
  create table public.default_privileges_probe (id bigserial primary key);
  create function public.default_privileges_probe_fn() returns integer
    language sql as $probe$ select 1 $probe$;

  v_table := 'public.default_privileges_probe'::regclass;
  v_seq := pg_get_serial_sequence('public.default_privileges_probe', 'id')::regclass;
  v_fn := 'public.default_privileges_probe_fn()'::regprocedure;

  -- Without the sequence every sequence check below would pass on a null.
  if v_seq is null then
    raise exception 'default privileges: the test table has no serial sequence';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    select string_agg(p.privilege, ', ')
      into v_found
      from unnest(v_denied) as p(privilege)
     where has_table_privilege(v_role, v_table, p.privilege);
    if v_found is not null then
      raise exception 'default privileges: % holds table privileges on a new table: %', v_role, v_found;
    end if;

    select string_agg(p.privilege, ', ')
      into v_found
      from unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(privilege)
     where has_sequence_privilege(v_role, v_seq, p.privilege);
    if v_found is not null then
      raise exception 'default privileges: % holds sequence privileges on a new sequence: %', v_role, v_found;
    end if;

    if has_function_privilege(v_role, v_fn, 'EXECUTE') then
      raise exception 'default privileges: % holds EXECUTE on a new function', v_role;
    end if;
  end loop;

  if exists (
    select 1
      from pg_proc p,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_fn
       and a.grantee = 0
  ) then
    raise exception 'default privileges: PUBLIC holds EXECUTE on a new function';
  end if;

  -- service_role keeps its default privileges. These checks also show that
  -- default privileges reached each test object, so the checks above did not
  -- pass on objects that received no default privileges at all.
  select string_agg(p.privilege, ', ')
    into v_found
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
   where not has_table_privilege('service_role', v_table, p.privilege);
  if v_found is not null then
    raise exception 'default privileges: service_role lacks % on a new table', v_found;
  end if;

  if not has_sequence_privilege('service_role', v_seq, 'USAGE') then
    raise exception 'default privileges: service_role lacks USAGE on a new sequence';
  end if;

  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'default privileges: service_role lacks EXECUTE on a new function';
  end if;

  drop function public.default_privileges_probe_fn();
  drop table public.default_privileges_probe;
end
$$;

commit;
