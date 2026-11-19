-- In public.users, anon and authenticated keep SELECT, a signed-in user still
-- reads only their own row, and no client role can write: not through a
-- privilege and not through a policy.
--
-- All application writes to this table go through server routes using the
-- service-role client, which bypasses RLS and is not affected by this file.
-- Browser code reads its own row's names and writes nothing here.
--
-- 20261003120000_revoke_client_writes_on_users.sql revoked the write
-- privileges and left the UPDATE policies in place. A policy with no privilege
-- behind it allows nothing, but it limits only which row may be changed, not
-- which columns: a later grant of UPDATE to a client role would at once open
-- every column of the user's own row, email included. This file removes the
-- policies, so such a grant alone opens nothing, and takes the remaining
-- non-SELECT table privileges away from the client roles.
--
-- It drops the UPDATE policy under both names it has been created with (the
-- name used in this directory and the name created directly in a database),
-- revokes every table privilege from PUBLIC, anon and authenticated, and
-- grants SELECT back to anon and authenticated. The SELECT policy is not
-- touched, whatever its name. public.survey_responses is only read, to check
-- that it is left as it was. service_role is named only in the check.
--
-- Whether this file has been applied to a given database is live state; read
-- that database's policies and ACLs rather than inferring them from this file.
--
-- Order inside the file, in one transaction, so a failure leaves nothing
-- behind:
--   1. A DO block that stops the file before anything changes unless, on
--      public.users, row level security is enabled, every policy is for
--      SELECT or UPDATE, and there is exactly one SELECT policy, permissive,
--      whose condition is (auth.uid() = id). It also records the row level
--      security flags, table ACL, column ACLs and policies of
--      public.survey_responses for the comparison in step 3.
--   2. The drops, the revoke and the grant.
--   3. A DO block that raises, and the whole file rolls back, unless:
--      - anon and authenticated each hold SELECT and none of INSERT, UPDATE,
--        DELETE, TRUNCATE, REFERENCES or TRIGGER (nor MAINTAIN on PostgreSQL
--        17 or later), and no column-level INSERT, UPDATE or REFERENCES;
--      - no role that anon or authenticated is a member of, directly or
--        through other roles, holds any of those privileges, at table or
--        column level;
--      - PUBLIC holds no table privilege;
--      - no column carries an explicit ACL entry for PUBLIC, anon or
--        authenticated, for any privilege;
--      - row level security is enabled;
--      - the table has exactly one policy: for SELECT, permissive, with the
--        condition (auth.uid() = id) and no with check;
--      - public.survey_responses reads the same as it did in step 1;
--      - service_role holds SELECT, INSERT, UPDATE and DELETE.
-- The end state is checked by property rather than assumed: a REVOKE removes
-- only grants made by the role that runs it, and a role can also hold a
-- privilege through PUBLIC or through membership in another role. A privilege
-- check on a role sees what it inherits; a membership that does not inherit
-- is invisible to it, which is why the roles a client role is a member of are
-- read one by one. That check covers the privileges named above only: it does
-- not look at SELECT held by such a role, nor at whether such a role bypasses
-- row level security. If a check fails, look at where the remaining privilege
-- or policy comes from; do not widen this file to make it pass.
--
-- The policy condition is compared as a whole with the text PostgreSQL prints
-- for it (pg_get_expr), not searched for its parts. search_path is emptied for
-- the transaction so that text names the function with its schema whatever
-- the session's own search_path is; every object in this file is named with
-- its schema. The message carries the text that was found: when only the
-- printed form differs, change the expected text to that database's form
-- rather than removing the check.
--
-- Running this file again reaches the same end state: DROP POLICY IF EXISTS,
-- revoking a privilege that is not held and granting one that is held change
-- nothing, and both DO blocks test properties that hold before and after.
--
-- To reverse it. The statements below reproduce the state this file was
-- written against: an UPDATE policy "Users can update their own data", TO
-- public, permissive, using (auth.uid() = id), with no with check; an UPDATE
-- policy users_update_own, TO public, permissive, using and with check
-- (auth.uid() = id); REFERENCES, TRIGGER and MAINTAIN held by anon and
-- authenticated beside SELECT; no column-level grants. Record a database's
-- own policies and ACLs, with the grantor of each entry, before applying,
-- since they are live state. Run the reversal as the role that had granted
-- the earlier entries, read from that record: made by the same grantor, the
-- grants give back the same ACL entries once the ACL is expanded (the order
-- of the entries in the stored relacl can differ). The reversal gives back no
-- write privilege, so it does not by itself reopen client writes:
--   begin;
--   create policy "Users can update their own data"
--     on public.users
--     for update
--     using (auth.uid() = id);
--   create policy users_update_own
--     on public.users
--     for update
--     using (auth.uid() = id)
--     with check (auth.uid() = id);
--   grant maintain, references, trigger
--     on table public.users to anon, authenticated;
--   commit;

begin;

set local lock_timeout = '5s';
set local search_path = '';

do $$
declare
  v_users regclass := 'public.users'::regclass;
  v_survey regclass := 'public.survey_responses'::regclass;
  v_expected_qual constant text := '(auth.uid() = id)';
  v_found text;
  v_rls boolean;
  v_select_count integer;
  v_matching integer;
  v_snapshot text;
begin
  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_users;
  if v_rls is distinct from true then
    raise exception 'public.users: row level security is not enabled; nothing was changed';
  end if;

  -- This file drops UPDATE policies only. A policy for any other write is not
  -- one it knows how to reverse, so it stops here rather than after the drops.
  select string_agg(format('%s/%s', p.polname, p.polcmd), ', ' order by p.polname)
    into v_found
    from pg_policy p
   where p.polrelid = v_users
     and p.polcmd not in ('r', 'w');
  if v_found is not null then
    raise exception
      'public.users: found a policy that is for neither SELECT nor UPDATE: %; nothing was changed',
      v_found;
  end if;

  -- By property, not by name: the SELECT policy has different names in the
  -- repository and in the databases.
  select count(*) filter (where p.polcmd = 'r'),
         count(*) filter (
           where p.polcmd = 'r'
             and p.polpermissive
             and pg_get_expr(p.polqual, p.polrelid) = v_expected_qual
         ),
         string_agg(
           format('%s/%s/%s', p.polname, p.polpermissive,
                  coalesce(pg_get_expr(p.polqual, p.polrelid), '(none)')),
           ', ' order by p.polname
         ) filter (where p.polcmd = 'r')
    into v_select_count, v_matching, v_found
    from pg_policy p
   where p.polrelid = v_users;
  if v_select_count <> 1 or v_matching <> 1 then
    raise exception
      'public.users: expected exactly one SELECT policy, permissive, with the condition %, found %; nothing was changed',
      v_expected_qual, coalesce(v_found, 'no SELECT policy');
  end if;

  select jsonb_build_object(
           'rls', c.relrowsecurity,
           'force_rls', c.relforcerowsecurity,
           'acl', c.relacl::text,
           'policies', (
             select jsonb_agg(
                      jsonb_build_array(
                        p.polname::text,
                        p.polcmd::text,
                        p.polpermissive,
                        p.polroles::text,
                        pg_get_expr(p.polqual, p.polrelid),
                        pg_get_expr(p.polwithcheck, p.polrelid)
                      )
                      order by p.polname
                    )
               from pg_policy p
              where p.polrelid = c.oid
           ),
           'column_acl', (
             select jsonb_agg(
                      jsonb_build_array(a.attname::text, a.attacl::text)
                      order by a.attnum
                    )
               from pg_attribute a
              where a.attrelid = c.oid
                and a.attnum > 0
                and not a.attisdropped
                and a.attacl is not null
           )
         )::text
    into v_snapshot
    from pg_class c
   where c.oid = v_survey;
  if v_snapshot is null then
    raise exception 'survey_responses: could not be read before the change; nothing was changed';
  end if;

  -- Transaction-local, so the closing block reads it and nothing outlives the
  -- file.
  perform set_config('noor.survey_responses_before', v_snapshot, true);
end
$$;

drop policy if exists users_update_own on public.users;
drop policy if exists "Users can update their own data" on public.users;

revoke all on table public.users from public, anon, authenticated;
grant select on table public.users to anon, authenticated;

do $$
declare
  v_users regclass := 'public.users'::regclass;
  v_survey regclass := 'public.survey_responses'::regclass;
  v_expected_qual constant text := '(auth.uid() = id)';
  v_role text;
  v_denied text[] := array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_found text;
  v_rls boolean;
  v_policy_count integer;
  v_matching integer;
  v_snapshot text;
  v_before text;
begin
  -- MAINTAIN is checked only where the server is PostgreSQL 17 or later.
  if current_setting('server_version_num')::integer >= 170000 then
    v_denied := array_append(v_denied, 'MAINTAIN');
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    select string_agg(p.privilege, ', ')
      into v_found
      from unnest(v_denied) as p(privilege)
     where has_table_privilege(v_role, v_users, p.privilege);
    if v_found is not null then
      raise exception 'public.users: % still holds table privileges: %',
        v_role, v_found;
    end if;

    -- has_table_privilege does not see column-level grants.
    if has_any_column_privilege(v_role, v_users, 'INSERT,UPDATE,REFERENCES') then
      raise exception 'public.users: % still holds column write privileges', v_role;
    end if;

    if not has_table_privilege(v_role, v_users, 'SELECT') then
      raise exception 'public.users: SELECT is missing for %', v_role;
    end if;
  end loop;

  -- The checks above read what a client role holds or inherits. A membership
  -- that does not inherit is invisible to them, so every role a client role is
  -- a member of, directly or through other roles, is read on its own. A
  -- membership in a role that holds none of these privileges passes.
  select string_agg(
           format('%s through %s: %s', m.client, m.via, m.held),
           '; ' order by m.client, m.via
         )
    into v_found
    from (
      select k.client,
             r.rolname::text as via,
             concat_ws(
               ', ',
               (select string_agg(p.privilege, ', ')
                  from unnest(v_denied) as p(privilege)
                 where has_table_privilege(r.oid, v_users, p.privilege)),
               case
                 when has_any_column_privilege(r.oid, v_users, 'INSERT,UPDATE,REFERENCES')
                 then 'INSERT, UPDATE or REFERENCES on a column'
               end
             ) as held
        from unnest(array['anon', 'authenticated']) as k(client)
        join pg_roles r
          on r.rolname <> k.client
         and pg_has_role(k.client::name, r.oid, 'MEMBER')
    ) m
   where m.held <> '';
  if v_found is not null then
    raise exception
      'public.users: a client role is a member of a role that holds privileges on the table: %',
      v_found;
  end if;

  if exists (
    select 1
      from pg_class c,
           lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = v_users
       and a.grantee = 0
  ) then
    raise exception 'public.users: PUBLIC still holds a table privilege';
  end if;

  -- Explicit column ACL entries, SELECT included: the checks above read
  -- effective privileges, which a table-level grant satisfies and hides.
  select string_agg(format('%s %s', a.attname, a.attacl::text), ', ' order by a.attnum)
    into v_found
    from pg_attribute a
   where a.attrelid = v_users
     and a.attnum > 0
     and not a.attisdropped
     and exists (
           select 1
             from aclexplode(a.attacl) x
            where x.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
         );
  if v_found is not null then
    raise exception
      'public.users: columns still carry an ACL entry for PUBLIC, anon or authenticated: %',
      v_found;
  end if;

  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_users;
  if v_rls is distinct from true then
    raise exception 'public.users: row level security is not enabled';
  end if;

  -- By property, not by name: the SELECT policy has different names in the
  -- repository and in the databases.
  select count(*),
         count(*) filter (
           where p.polcmd = 'r'
             and p.polpermissive
             and pg_get_expr(p.polqual, p.polrelid) = v_expected_qual
             and p.polwithcheck is null
         ),
         string_agg(
           format('%s/%s/%s/%s', p.polname, p.polcmd, p.polpermissive,
                  coalesce(pg_get_expr(p.polqual, p.polrelid), '(none)')),
           ', ' order by p.polname
         )
    into v_policy_count, v_matching, v_found
    from pg_policy p
   where p.polrelid = v_users;
  if v_policy_count <> 1 or v_matching <> 1 then
    raise exception
      'public.users: expected exactly one policy, for SELECT, permissive, with the condition % and no with check, found %',
      v_expected_qual, coalesce(v_found, 'no policy');
  end if;

  select jsonb_build_object(
           'rls', c.relrowsecurity,
           'force_rls', c.relforcerowsecurity,
           'acl', c.relacl::text,
           'policies', (
             select jsonb_agg(
                      jsonb_build_array(
                        p.polname::text,
                        p.polcmd::text,
                        p.polpermissive,
                        p.polroles::text,
                        pg_get_expr(p.polqual, p.polrelid),
                        pg_get_expr(p.polwithcheck, p.polrelid)
                      )
                      order by p.polname
                    )
               from pg_policy p
              where p.polrelid = c.oid
           ),
           'column_acl', (
             select jsonb_agg(
                      jsonb_build_array(a.attname::text, a.attacl::text)
                      order by a.attnum
                    )
               from pg_attribute a
              where a.attrelid = c.oid
                and a.attnum > 0
                and not a.attisdropped
                and a.attacl is not null
           )
         )::text
    into v_snapshot
    from pg_class c
   where c.oid = v_survey;
  v_before := nullif(current_setting('noor.survey_responses_before', true), '');
  if v_before is null or v_snapshot is distinct from v_before then
    raise exception
      'survey_responses: its policies or privileges are not what they were before this file ran; before %, after %',
      coalesce(v_before, '(not recorded)'), coalesce(v_snapshot, '(unreadable)');
  end if;

  select string_agg(p.privilege, ', ')
    into v_found
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
   where not has_table_privilege('service_role', v_users, p.privilege);
  if v_found is not null then
    raise exception
      'public.users: service_role lacks %; this file revokes nothing from service_role, so look at what else changed its grants',
      v_found;
  end if;
end
$$;

commit;
