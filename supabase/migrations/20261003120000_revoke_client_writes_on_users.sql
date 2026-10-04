-- Client roles cannot insert, update, delete or truncate public.users.
--
-- Application writes to public.users go through server routes using the
-- service-role client: the email signup route inserts the row, the OAuth
-- profile sync route upserts it, the authenticated survey path updates its
-- names, and account deletion removes it. Browser code in this repository does
-- not write to public.users; the last such call, a language-preference update
-- aimed at a column no migration here creates, is removed in the same branch as
-- this file.
--
-- anon and authenticated nevertheless held table-level write privileges, and
-- the UPDATE policy defined in this directory limits only WHICH row may be
-- changed (auth.uid() = id), not which columns. A signed-in user could
-- therefore rewrite columns of their own row through the REST API with the
-- public anon key, including email.
-- This file revokes INSERT, UPDATE, DELETE and TRUNCATE on public.users from
-- both roles. Other privileges are untouched, and the RLS policies are
-- unchanged.
--
-- The privileges are revoked at table level. In PostgreSQL that also revokes
-- the matching column-level privileges on every column, but a REVOKE removes
-- only grants made by the role that runs it, and a role can also hold a
-- privilege through PUBLIC or through membership in another role. So the end
-- state is checked by property rather than assumed: afterwards neither role may
-- hold INSERT or UPDATE on the table or on any column, or DELETE or TRUNCATE on
-- the table.
-- If the check fails, the transaction rolls back. Stop and look at where the
-- remaining privilege comes from; do not widen this REVOKE to make it pass.
--
-- Running this file again reaches the same end state: revoking a privilege
-- that is not held changes nothing, and the check tests the same property.
--
-- To reverse it, grant the table-level privileges back:
--   grant insert, update, delete, truncate on table public.users
--     to anon, authenticated;
-- That restores table-level grants only. If the privileges recorded before this
-- file was applied included column-level grants (for example
-- `grant update (first_name) on public.users to authenticated`), those must be
-- granted again as well, and a grant that was made by a different grantor
-- reproduces the earlier state only when it is granted by that same role.

begin;

set local lock_timeout = '5s';

revoke insert, update, delete, truncate on table public.users
  from anon, authenticated;

do $$
declare
  v_remaining text;
begin
  select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
    into v_remaining
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
           as p(privilege)
   where case
           when p.privilege in ('DELETE', 'TRUNCATE') then
             has_table_privilege(r.role_name, 'public.users', p.privilege)
           else
             has_any_column_privilege(r.role_name, 'public.users', p.privilege)
         end;

  if v_remaining is not null then
    raise exception
      'public.users is still writable by a client role (table or column level): %',
      v_remaining;
  end if;
end
$$;

commit;
