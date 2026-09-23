-- Profile rows are created by the application, not by the database.
--
-- The application owns profile row creation, and each of its paths answers for
-- what it creates. The email signup route writes the profile row right after it
-- creates the auth user, and attempts to delete the auth user it just created
-- when the write fails. The OAuth path writes the row on the first callback;
-- when that write fails for someone who has not finished signing up it stops
-- there and says so, and a later sign-in syncs again. What they have in common
-- is that the outcome reaches the person waiting on it. A trigger on auth.users
-- reaches no one, so the trigger path is removed here and the application is
-- left as the only writer. A profile row therefore exists only once one of
-- these paths has written it: an auth user created by any other means has none
-- until then, which is an expected state and not a gap for a trigger to fill.
--
-- The trigger is removed by dropping the function it calls, with CASCADE,
-- rather than with DROP TRIGGER. Dropping a trigger requires ownership of the
-- table it sits on, and the role that applies migrations here is not guaranteed
-- to own auth.users. Dropping a function requires only ownership of that
-- function, and dropping the function takes the trigger with it.
--
-- The function is dropped under every name this file knows it by. The version
-- defined in this directory is created in 20260321_auth_profile_and_survey.sql,
-- which is left as it is; a function filling the same role can also have been
-- created under a different name outside these files. Each known name is
-- dropped IF EXISTS, so the file reaches the same end state whichever of those
-- names is present, and on a database carrying none of them. A name this file
-- does not know is not dropped; if a function under such a name is still
-- attached to a trigger on auth.users, the first of the two assertions after
-- the drops rolls the transaction back. One attached to nothing is not dropped
-- either, and that assertion does not look at it.
--
-- A companion function that deletes the corresponding auth user when a profile
-- row is deleted is dropped as well, and without CASCADE. Nothing is expected
-- to depend on it; if something does, the engine refuses and this transaction
-- rolls back rather than removing an object nobody looked at. If that DROP does
-- fail that way, stop and look at what depends on it — do not take the engine's
-- hint and add CASCADE.
--
-- The assertions divide the work between them. The one before the drops refuses
-- to cascade over any dependent other than the signup trigger. Of the two after
-- them, the first looks for a trigger left on auth.users that is not internal
-- to the engine, and the second looks for a function in the public schema that
-- is marked SECURITY DEFINER, is not part of an extension, and whose body text
-- names auth.users.

begin;

set local lock_timeout = '5s';

do $$
declare
  v_name text;
  v_oid oid;
  v_dependents text;
begin
  foreach v_name in array array[
    'public.handle_auth_user_created()',
    'public.handle_new_auth_user()'
  ]
  loop
    v_oid := to_regprocedure(v_name)::oid;
    if v_oid is null then
      continue;
    end if;

    select string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ')
      into v_dependents
      from pg_depend d
     where d.refclassid = 'pg_proc'::regclass
       and d.refobjid = v_oid
       and not exists (
             select 1
               from pg_trigger t
              where d.classid = 'pg_trigger'::regclass
                and t.oid = d.objid
                and t.tgrelid = 'auth.users'::regclass
                and t.tgname = 'on_auth_user_created'
           );

    if v_dependents is not null then
      raise exception
        'Refusing to drop %: depended on by something other than the signup trigger on auth.users: %',
        v_name, v_dependents;
    end if;
  end loop;
end
$$;

drop function if exists public.handle_auth_user_created() cascade;
drop function if exists public.handle_new_auth_user() cascade;
drop function if exists public.handle_public_user_deleted();

do $$
declare
  v_trigger_names text;
  v_function_names text;
begin
  select string_agg(t.tgname, ', ')
    into v_trigger_names
    from pg_trigger t
   where t.tgrelid = 'auth.users'::regclass
     and not t.tgisinternal;

  if v_trigger_names is not null then
    raise exception
      'auth.users still carries a trigger that is not internal to the engine: %',
      v_trigger_names;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
    into v_function_names
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.prosrc ~* '"?\mauth"?\s*\.\s*"?users\M'
     and not exists (
           select 1
             from pg_depend d
            where d.classid = 'pg_proc'::regclass
              and d.objid = p.oid
              and d.deptype = 'e'
         );

  if v_function_names is not null then
    raise exception
      'a security definer function still names auth.users in its body: %',
      v_function_names;
  end if;
end
$$;

commit;
