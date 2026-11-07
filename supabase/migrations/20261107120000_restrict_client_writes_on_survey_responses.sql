-- In survey_responses, anon and authenticated keep SELECT, a signed-in user
-- still reads only their own row, and no client role can write.
--
-- All application writes to this table go through server routes using the
-- service-role client, which bypasses RLS and is not affected by this file.
-- The survey answers are read back as input to the chat model, and the server
-- validates money fields before it writes them. A client role that can write
-- this table skips that validation and puts its own values into its prompt.
--
-- This file drops the insert and update policies under both names they have
-- been created with (the names in 20260321_auth_profile_and_survey.sql and the
-- names created directly in the database), so a schema rebuilt from this
-- directory keeps no write policy either. It revokes every table privilege
-- from PUBLIC, anon and authenticated, and grants SELECT back to anon and
-- authenticated. The SELECT policy is not touched, whatever its name.
-- service_role is named only in the check.
--
-- Whether this file has been applied to a given database is live state; read
-- that database's policies and ACLs rather than inferring them from this file.
--
-- The end state is checked by property rather than assumed: a REVOKE removes
-- only grants made by the role that runs it, and a role can also hold a
-- privilege through PUBLIC or through membership in another role. The DO block
-- raises, and the whole file rolls back, unless:
--   - anon and authenticated each hold SELECT and none of INSERT, UPDATE,
--     DELETE, TRUNCATE, REFERENCES or TRIGGER (nor MAINTAIN on PostgreSQL 17
--     or later), and no column-level INSERT, UPDATE or REFERENCES;
--   - PUBLIC holds no table privilege;
--   - row level security is enabled;
--   - the table has exactly one policy, and it is for SELECT;
--   - service_role holds SELECT, INSERT, UPDATE and DELETE.
-- If the check fails, look at where the remaining privilege or policy comes
-- from; do not widen this file to make it pass.
--
-- Running this file again reaches the same end state: DROP POLICY IF EXISTS,
-- revoking a privilege that is not held and granting one that is held change
-- nothing, and the check tests the same property.
--
-- To reverse it (this reopens client writes through the REST API). Before this
-- file, both databases held: table ACL arwdDxtm for anon and authenticated,
-- granted by postgres; no column-level grants; an INSERT policy "Users can
-- insert their own survey", TO public, permissive, with check
-- (auth.uid() = user_id); an UPDATE policy "Users can update their own
-- survey", TO public, permissive, using (auth.uid() = user_id), with no
-- with check. Run as postgres, since a grant reproduces an earlier ACL exactly
-- only when it is made by the same grantor:
--   grant insert, update, delete, truncate, references, trigger, maintain
--     on table public.survey_responses to anon, authenticated;
--   create policy "Users can insert their own survey"
--     on public.survey_responses
--     for insert with check (auth.uid() = user_id);
--   create policy "Users can update their own survey"
--     on public.survey_responses
--     for update using (auth.uid() = user_id);

begin;

set local lock_timeout = '5s';

drop policy if exists "Users can insert their own survey" on public.survey_responses;
drop policy if exists "Users can update their own survey" on public.survey_responses;
drop policy if exists survey_insert_own on public.survey_responses;
drop policy if exists survey_update_own on public.survey_responses;

revoke all on table public.survey_responses from public, anon, authenticated;
grant select on table public.survey_responses to anon, authenticated;

do $$
declare
  v_table regclass := 'public.survey_responses'::regclass;
  v_role text;
  v_denied text[] := array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_found text;
  v_rls boolean;
  v_policy_count integer;
  v_non_select integer;
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_denied := array_append(v_denied, 'MAINTAIN');
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    select string_agg(p.privilege, ', ')
      into v_found
      from unnest(v_denied) as p(privilege)
     where has_table_privilege(v_role, v_table, p.privilege);
    if v_found is not null then
      raise exception 'survey_responses: % still holds table privileges: %',
        v_role, v_found;
    end if;

    -- has_table_privilege does not see column-level grants.
    if has_any_column_privilege(v_role, v_table, 'INSERT,UPDATE,REFERENCES') then
      raise exception 'survey_responses: % still holds column write privileges', v_role;
    end if;

    if not has_table_privilege(v_role, v_table, 'SELECT') then
      raise exception 'survey_responses: SELECT is missing for %', v_role;
    end if;
  end loop;

  if exists (
    select 1
      from pg_class c,
           lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = v_table
       and a.grantee = 0
  ) then
    raise exception 'survey_responses: PUBLIC still holds a table privilege';
  end if;

  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
  if v_rls is distinct from true then
    raise exception 'survey_responses: row level security is not enabled';
  end if;

  -- By property, not by name: the SELECT policy has different names in the
  -- repository and in the databases.
  select count(*), count(*) filter (where p.polcmd <> 'r'),
         string_agg(format('%s/%s', p.polname, p.polcmd), ', ' order by p.polname)
    into v_policy_count, v_non_select, v_found
    from pg_policy p
   where p.polrelid = v_table;
  if v_policy_count <> 1 or v_non_select <> 0 then
    raise exception 'survey_responses: expected exactly one policy, for SELECT, found %',
      coalesce(v_found, 'no policy');
  end if;

  select string_agg(p.privilege, ', ')
    into v_found
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
   where not has_table_privilege('service_role', v_table, p.privilege);
  if v_found is not null then
    raise exception
      'survey_responses: service_role lacks %; this file revokes nothing from service_role, so look at what else changed its grants',
      v_found;
  end if;
end
$$;

commit;
