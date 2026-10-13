-- public.plaid_connections becomes service-role-only.
--
-- The table holds one row per linked bank: the encrypted Plaid access token,
-- the Item id, the institution and the connection status. Every application
-- read and write of it goes through server code using the service-role client
-- (createServerClient or createAdminClient), which bypasses RLS and is not
-- affected by this file. Application code must reach this table only through
-- the service-role client; client roles are not meant to touch it.
--
-- anon and authenticated nevertheless held every table privilege and every
-- privilege on the id sequence, and four owner-scoped policies
-- (plaid_connections_select_own, _insert_own, _update_own, _delete_own, each
-- `(auth.uid())::text = user_id`) let a signed-in user read, insert, update and
-- delete their own rows through the REST API with the public anon key. That
-- included reading the ciphertext of their access token and writing rows that
-- server code later reads as their own connections.
--
-- This file drops the four policies and revokes every privilege on the table
-- and on its id sequence from both roles. Row level security stays enabled, so
-- with no policy a role without BYPASSRLS sees no rows even if a privilege is
-- granted back later. End state: RLS on, no policies, no client-role
-- privileges. service_role is not named anywhere below except in the check.
--
-- The end state is checked by property rather than assumed. A REVOKE removes
-- only grants made by the role that runs it, and a role can also hold a
-- privilege through PUBLIC or through membership in another role; the
-- has_*_privilege functions see all of these. The DO block raises, and the
-- whole file rolls back, unless every one of these holds:
--   - neither anon nor authenticated holds SELECT, INSERT, UPDATE, DELETE,
--     TRUNCATE, REFERENCES or TRIGGER on the table, nor MAINTAIN on
--     PostgreSQL 17 or later;
--   - neither holds column-level SELECT, INSERT, UPDATE or REFERENCES;
--   - neither holds USAGE, SELECT or UPDATE on plaid_connections_id_seq;
--   - row level security is enabled on the table;
--   - the table has no policy at all, not only none of the four named above;
--   - service_role still holds SELECT, INSERT, UPDATE and DELETE on the table
--     and USAGE on the sequence.
-- If the check fails, stop and look at where the remaining privilege or policy
-- comes from; do not widen this file to make it pass. This file grants nothing.
--
-- Running this file again reaches the same end state: DROP POLICY IF EXISTS and
-- revoking a privilege that is not held change nothing, and the check tests the
-- same property.
--
-- To reverse it (this reopens the REST path described above):
--   grant select, insert, update, delete, truncate, references, trigger,
--     maintain on table public.plaid_connections to anon, authenticated;
--   grant usage, select, update on sequence public.plaid_connections_id_seq
--     to anon, authenticated;
--   create policy plaid_connections_select_own on public.plaid_connections
--     for select using ((auth.uid())::text = user_id);
--   create policy plaid_connections_insert_own on public.plaid_connections
--     for insert with check ((auth.uid())::text = user_id);
--   create policy plaid_connections_update_own on public.plaid_connections
--     for update using ((auth.uid())::text = user_id)
--     with check ((auth.uid())::text = user_id);
--   create policy plaid_connections_delete_own on public.plaid_connections
--     for delete using ((auth.uid())::text = user_id);
-- That restores the privileges and policies as they stood, but a grant
-- reproduces the earlier ACL exactly only when it is made by the same grantor
-- as the original, so record the table and sequence ACLs before applying.
-- MAINTAIN in the first statement exists from PostgreSQL 17.

begin;

set local lock_timeout = '5s';

drop policy if exists plaid_connections_select_own on public.plaid_connections;
drop policy if exists plaid_connections_insert_own on public.plaid_connections;
drop policy if exists plaid_connections_update_own on public.plaid_connections;
drop policy if exists plaid_connections_delete_own on public.plaid_connections;

revoke all on table public.plaid_connections from anon, authenticated;
revoke all on sequence public.plaid_connections_id_seq from anon, authenticated;

do $$
declare
  v_table regclass := 'public.plaid_connections'::regclass;
  v_sequence regclass := 'public.plaid_connections_id_seq'::regclass;
  v_table_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_found text;
  v_rls boolean;
  v_policies integer;
begin
  -- MAINTAIN exists from PostgreSQL 17; naming it on an earlier server is an
  -- error, so it is checked only where it exists.
  if current_setting('server_version_num')::integer >= 170000 then
    v_table_privileges := array_append(v_table_privileges, 'MAINTAIN');
  end if;

  select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
    into v_found
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(v_table_privileges) as p(privilege)
   where has_table_privilege(r.role_name, v_table, p.privilege);

  if v_found is not null then
    raise exception
      'plaid_connections: client roles still hold table privileges: %',
      v_found;
  end if;

  -- has_table_privilege does not see column-level grants.
  select string_agg(r.role_name, ', ')
    into v_found
    from unnest(array['anon', 'authenticated']) as r(role_name)
   where has_any_column_privilege(
           r.role_name, v_table, 'SELECT,INSERT,UPDATE,REFERENCES'
         );

  if v_found is not null then
    raise exception
      'plaid_connections: client roles still hold column privileges: %',
      v_found;
  end if;

  select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
    into v_found
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(privilege)
   where has_sequence_privilege(r.role_name, v_sequence, p.privilege);

  if v_found is not null then
    raise exception
      'plaid_connections_id_seq: client roles still hold privileges: %',
      v_found;
  end if;

  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
  if v_rls is distinct from true then
    raise exception 'plaid_connections: row level security is not enabled';
  end if;

  select count(*) into v_policies from pg_policy where polrelid = v_table;
  if v_policies <> 0 then
    raise exception 'plaid_connections: expected no policies, found %',
      v_policies;
  end if;

  select string_agg(p.privilege, ', ')
    into v_found
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
   where not has_table_privilege('service_role', v_table, p.privilege);

  if v_found is not null then
    raise exception
      'plaid_connections: service_role lacks % on the table; this file revokes nothing from service_role, so look at what else changed its grants',
      v_found;
  end if;

  if not has_sequence_privilege('service_role', v_sequence, 'USAGE') then
    raise exception
      'plaid_connections_id_seq: service_role lacks USAGE; inserts would fail on nextval()';
  end if;
end
$$;

commit;
