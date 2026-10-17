-- In chat_sessions, chat_messages, chat_summaries and user_facts, a signed-in
-- user keeps read access to their own rows, anon reads and writes nothing, and
-- no client role can write.
--
-- All application writes to these tables go through server code using the
-- service-role client (aiMemory.ts), which bypasses RLS and is not affected by
-- this file. Server code may read these rows as input to the chat model, so a
-- row a client role could write here could reach the model as a turn that
-- never happened.
--
-- This file drops the insert, update and delete policies on the four tables,
-- revokes every table privilege from PUBLIC, anon and authenticated, and grants
-- SELECT back to authenticated only. The <table>_select_own policies are kept,
-- so a signed-in user still reads only their own rows. anon holds no privilege
-- on these tables at all, so an anon-key request is refused rather than shown
-- an empty result. service_role is named only in the check.
--
-- Whether this file has been applied to a given database is live state; read
-- that database's policies and ACLs rather than inferring them from this file.
--
-- The end state is checked by property rather than assumed: a REVOKE removes
-- only grants made by the role that runs it, and a role can also hold a
-- privilege through PUBLIC or through membership in another role. The DO block
-- raises, and the whole file rolls back, unless for every table:
--   - anon holds no table privilege, SELECT included, and no column-level
--     SELECT, INSERT, UPDATE or REFERENCES;
--   - authenticated holds SELECT and none of INSERT, UPDATE, DELETE, TRUNCATE,
--     REFERENCES or TRIGGER (nor MAINTAIN on PostgreSQL 17 or later), and no
--     column-level INSERT, UPDATE or REFERENCES;
--   - PUBLIC holds no table privilege;
--   - row level security is enabled;
--   - the only policy is <table>_select_own, for SELECT;
--   - service_role holds SELECT, INSERT, UPDATE and DELETE.
-- If the check fails, look at where the remaining privilege or policy comes
-- from; do not widen this file to make it pass.
--
-- Running this file again reaches the same end state: DROP POLICY IF EXISTS,
-- revoking a privilege that is not held and granting one that is held change
-- nothing, and the check tests the same property.
--
-- To reverse it (this reopens client writes through the REST API), grant the
-- privileges back and recreate the policies. Record the table ACLs and policy
-- definitions before applying, because a grant reproduces an earlier ACL
-- exactly only when it is made by the same grantor:
--   grant select on table public.chat_sessions, public.chat_messages,
--     public.chat_summaries, public.user_facts to anon;
--   grant insert, update, delete, truncate, references, trigger on table
--     public.chat_sessions, public.chat_messages, public.chat_summaries,
--     public.user_facts to anon, authenticated;
--   create policy <table>_insert_own on public.<table>
--     for insert with check (auth.uid() = user_id);
--   create policy <table>_update_own on public.<table>
--     for update using (auth.uid() = user_id)
--     with check (auth.uid() = user_id);   -- not on chat_messages
--   create policy <table>_delete_own on public.<table>
--     for delete using (auth.uid() = user_id);

begin;

set local lock_timeout = '5s';

drop policy if exists chat_sessions_insert_own on public.chat_sessions;
drop policy if exists chat_sessions_update_own on public.chat_sessions;
drop policy if exists chat_sessions_delete_own on public.chat_sessions;
drop policy if exists chat_messages_insert_own on public.chat_messages;
drop policy if exists chat_messages_update_own on public.chat_messages;
drop policy if exists chat_messages_delete_own on public.chat_messages;
drop policy if exists chat_summaries_insert_own on public.chat_summaries;
drop policy if exists chat_summaries_update_own on public.chat_summaries;
drop policy if exists chat_summaries_delete_own on public.chat_summaries;
drop policy if exists user_facts_insert_own on public.user_facts;
drop policy if exists user_facts_update_own on public.user_facts;
drop policy if exists user_facts_delete_own on public.user_facts;

revoke all on table public.chat_sessions, public.chat_messages, public.chat_summaries, public.user_facts from public, anon, authenticated;
grant select on table public.chat_sessions, public.chat_messages, public.chat_summaries, public.user_facts to authenticated;

do $$
declare
  v_name text;
  v_table regclass;
  v_denied text[] := array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_all text[];
  v_found text;
  v_rls boolean;
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_denied := array_append(v_denied, 'MAINTAIN');
  end if;
  v_all := array_prepend('SELECT', v_denied);

  foreach v_name in array array[
    'chat_sessions', 'chat_messages', 'chat_summaries', 'user_facts'
  ] loop
    v_table := format('public.%I', v_name)::regclass;

    -- anon: nothing at all, SELECT included.
    select string_agg(p.privilege, ', ')
      into v_found
      from unnest(v_all) as p(privilege)
     where has_table_privilege('anon', v_table, p.privilege);
    if v_found is not null then
      raise exception '%: anon still holds table privileges: %', v_name, v_found;
    end if;

    -- has_table_privilege does not see column-level grants.
    if has_any_column_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception '%: anon still holds column privileges', v_name;
    end if;

    -- authenticated: SELECT and nothing else.
    select string_agg(p.privilege, ', ')
      into v_found
      from unnest(v_denied) as p(privilege)
     where has_table_privilege('authenticated', v_table, p.privilege);
    if v_found is not null then
      raise exception '%: authenticated still holds table privileges: %',
        v_name, v_found;
    end if;

    if has_any_column_privilege('authenticated', v_table, 'INSERT,UPDATE,REFERENCES') then
      raise exception '%: authenticated still holds column write privileges', v_name;
    end if;

    if not has_table_privilege('authenticated', v_table, 'SELECT') then
      raise exception '%: SELECT is missing for authenticated', v_name;
    end if;

    if exists (
      select 1
        from pg_class c,
             lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = v_table
         and a.grantee = 0
    ) then
      raise exception '%: PUBLIC still holds a table privilege', v_name;
    end if;

    select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
    if v_rls is distinct from true then
      raise exception '%: row level security is not enabled', v_name;
    end if;

    select string_agg(format('%s/%s', p.polname, p.polcmd), ', ' order by p.polname)
      into v_found
      from pg_policy p
     where p.polrelid = v_table;
    if v_found is distinct from format('%s_select_own/r', v_name) then
      raise exception '%: expected only %_select_own for SELECT, found %',
        v_name, v_name, coalesce(v_found, 'no policy');
    end if;

    select string_agg(p.privilege, ', ')
      into v_found
      from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
     where not has_table_privilege('service_role', v_table, p.privilege);
    if v_found is not null then
      raise exception
        '%: service_role lacks %; this file revokes nothing from service_role, so look at what else changed its grants',
        v_name, v_found;
    end if;
  end loop;
end
$$;

commit;
