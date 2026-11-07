-- Integrity constraints on public.users and public.plaid_connections.
--
-- What this file adds:
--   - public.users.status: text, not null, default 'active', limited to
--     'active' and 'suspended' by users_status_check. Existing rows read the
--     default; nothing in this file writes a row.
--   - users_id_fkey: public.users.id references auth.users(id) on delete
--     cascade. Deleting an Auth user deletes its profile row, and through the
--     existing cascades every row of every table whose user_id references
--     public.users.
--   - plaid_connections.user_id becomes uuid (using user_id::uuid), and
--     plaid_connections_user_id_fkey makes it reference public.users(id) on
--     delete restrict.
--
-- Why RESTRICT on plaid_connections. A connection row holds the only copy of
-- the encrypted access token that can revoke its Plaid Item. Account deletion
-- revokes each Item and deletes its row first, and refuses to go on while any
-- row is left (src/lib/accountDeletion.ts). Until this file that rule lived in
-- application code only. With RESTRICT the database refuses to delete a
-- profile row, or an Auth user whose cascade would reach one, while a
-- connection row still points at it. A cascade here would do the opposite: it
-- would destroy the token rows of Items nobody revoked.
--
-- The uuid conversion keeps the stored text. The additional authenticated data
-- of each encrypted token is built from the owning user id as text, so a
-- conversion that changed the text (case, braces, hyphens) would make tokens
-- undecryptable. The first DO block therefore refuses unless every user_id is
-- already in lower-case canonical form, which is the form uuid::text returns.
--
-- Order, all in one transaction:
--   1. The lock on plaid_connections (see Locks below).
--   2. A DO block that raises, and rolls the whole file back, if any
--      plaid_connections.user_id is not lower-case canonical uuid text, if any
--      plaid_connections.user_id has no public.users row, or if any
--      public.users row has no auth.users row. It changes nothing; fix the
--      rows first, never this check.
--   3. The status column and its check.
--   4. users_id_fkey.
--   5. The user_id type change, then plaid_connections_user_id_fkey.
--   6. A DO block that checks the end state by property, not by constraint
--      name, and raises unless:
--        - public.users(id) has a single-column foreign key to auth.users
--          with on delete cascade, and the owner of public.users holds
--          DELETE on it, so the cascade can run;
--        - plaid_connections(user_id) has a single-column foreign key to
--          public.users with on delete restrict, and its type is uuid;
--        - users.status is not null, defaults to 'active', and carries a
--          check that admits exactly 'active' and 'suspended';
--        - anon and authenticated hold no INSERT, UPDATE or DELETE on
--          public.users, at table level or on any column;
--        - plaid_connections has no policy, and anon and authenticated hold
--          no table privilege on it.
--
-- Locks: plaid_connections is locked in ACCESS EXCLUSIVE mode before the
-- first DO block reads it, and held to commit. Without that lock a row
-- inserted after the check and before the type change would be converted
-- unchecked: upper-case uuid text casts without error and comes back
-- lower-case, so that row's token would no longer decrypt, and nothing would
-- report it. Taking the final mode at the start also means no lock upgrade
-- later in the file. Reads and writes of plaid_connections wait while the
-- file runs. The type change then rewrites the table and rebuilds its
-- indexes; adding each foreign key takes SHARE ROW EXCLUSIVE on both tables
-- it joins, auth.users included. lock_timeout bounds every wait, and a wait
-- that runs out rolls the whole file back.
--
-- Whether this file has been applied to a given database is live state; read
-- that database's constraints and column types rather than inferring them
-- from this file.
--
-- Running this file again fails at the status column, which already exists,
-- and the transaction rolls back with nothing changed.
--
-- To reverse it. Drop the status column only after no deployed code selects
-- it (src/lib/accountExport.ts names it):
--   begin;
--   alter table public.plaid_connections drop constraint plaid_connections_user_id_fkey;
--   alter table public.users drop constraint users_id_fkey;
--   alter table public.plaid_connections alter column user_id type text using user_id::text;
--   alter table public.users drop constraint users_status_check;
--   alter table public.users drop column status;
--   commit;

begin;

set local lock_timeout = '5s';

lock table public.plaid_connections in access exclusive mode;

do $$
declare
  v_not_canonical bigint;
  v_without_profile bigint;
  v_without_auth bigint;
begin
  select count(*) into v_not_canonical
    from public.plaid_connections p
   where p.user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if v_not_canonical <> 0 then
    raise exception
      'plaid_connections: % rows have a user_id that is not lower-case canonical uuid text',
      v_not_canonical;
  end if;

  select count(*) into v_without_profile
    from public.plaid_connections p
   where not exists (
           select 1 from public.users u where u.id::text = p.user_id
         );
  if v_without_profile <> 0 then
    raise exception
      'plaid_connections: % rows have a user_id with no public.users row',
      v_without_profile;
  end if;

  select count(*) into v_without_auth
    from public.users u
   where not exists (
           select 1 from auth.users a where a.id = u.id
         );
  if v_without_auth <> 0 then
    raise exception
      'public.users: % rows have no auth.users row',
      v_without_auth;
  end if;
end
$$;

alter table public.users
  add column status text not null default 'active',
  add constraint users_status_check check (status in ('active', 'suspended'));

alter table public.users
  add constraint users_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

alter table public.plaid_connections
  alter column user_id type uuid using user_id::uuid;

alter table public.plaid_connections
  add constraint plaid_connections_user_id_fkey
  foreign key (user_id) references public.users(id) on delete restrict;

do $$
declare
  v_users regclass := 'public.users'::regclass;
  v_plaid regclass := 'public.plaid_connections'::regclass;
  v_plaid_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_found text;
  v_ok boolean;
  v_policies integer;
begin
  -- MAINTAIN exists from PostgreSQL 17; naming it on an earlier server is an
  -- error, so it is checked only where it exists.
  if current_setting('server_version_num')::integer >= 170000 then
    v_plaid_privileges := array_append(v_plaid_privileges, 'MAINTAIN');
  end if;

  -- public.users(id) -> auth.users, on delete cascade.
  select exists (
    select 1
      from pg_constraint k
      join pg_attribute a
        on a.attrelid = k.conrelid
       and a.attnum = k.conkey[1]
     where k.conrelid = v_users
       and k.contype = 'f'
       and cardinality(k.conkey) = 1
       and a.attname = 'id'
       and k.confrelid = 'auth.users'::regclass
       and k.confdeltype = 'c'
  ) into v_ok;
  if not v_ok then
    raise exception
      'public.users: id does not reference auth.users with on delete cascade';
  end if;

  -- The cascade from auth.users deletes as the owner of public.users.
  if not exists (
    select 1 from pg_class c
     where c.oid = v_users
       and has_table_privilege(c.relowner, v_users, 'DELETE')
  ) then
    raise exception
      'public.users: the table owner lacks DELETE, so the cascade from auth.users would fail';
  end if;

  -- plaid_connections(user_id) -> public.users, on delete restrict.
  select exists (
    select 1
      from pg_constraint k
      join pg_attribute a
        on a.attrelid = k.conrelid
       and a.attnum = k.conkey[1]
     where k.conrelid = v_plaid
       and k.contype = 'f'
       and cardinality(k.conkey) = 1
       and a.attname = 'user_id'
       and k.confrelid = v_users
       and k.confdeltype = 'r'
  ) into v_ok;
  if not v_ok then
    raise exception
      'plaid_connections: user_id does not reference public.users with on delete restrict';
  end if;

  select exists (
    select 1 from pg_attribute a
     where a.attrelid = v_plaid
       and a.attname = 'user_id'
       and not a.attisdropped
       and a.atttypid = 'uuid'::regtype
  ) into v_ok;
  if not v_ok then
    raise exception 'plaid_connections: user_id is not of type uuid';
  end if;

  -- users.status: not null, default 'active', check on exactly two values.
  select exists (
    select 1 from pg_attribute a
     where a.attrelid = v_users
       and a.attname = 'status'
       and not a.attisdropped
       and a.attnotnull
  ) into v_ok;
  if not v_ok then
    raise exception 'public.users: status is missing or nullable';
  end if;

  select exists (
    select 1
      from pg_attrdef d
      join pg_attribute a
        on a.attrelid = d.adrelid
       and a.attnum = d.adnum
     where d.adrelid = v_users
       and a.attname = 'status'
       and pg_get_expr(d.adbin, d.adrelid) = '''active''::text'
  ) into v_ok;
  if not v_ok then
    raise exception 'public.users: status does not default to ''active''';
  end if;

  select exists (
    select 1
      from pg_constraint k
      join pg_attribute a
        on a.attrelid = k.conrelid
       and a.attnum = k.conkey[1]
     where k.conrelid = v_users
       and k.contype = 'c'
       and cardinality(k.conkey) = 1
       and a.attname = 'status'
       and pg_get_constraintdef(k.oid)
           = 'CHECK ((status = ANY (ARRAY[''active''::text, ''suspended''::text])))'
  ) into v_ok;
  if not v_ok then
    raise exception
      'public.users: status has no check admitting exactly active and suspended';
  end if;

  -- No client write on public.users, at table level.
  select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
    into v_found
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as p(privilege)
   where has_table_privilege(r.role_name, v_users, p.privilege);
  if v_found is not null then
    raise exception
      'public.users: client roles hold table write privileges: %',
      v_found;
  end if;

  -- Nor on any column; has_table_privilege does not see column-level grants.
  select string_agg(format('%s %s %s', r.role_name, p.privilege, a.attname), ', ')
    into v_found
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(array['INSERT', 'UPDATE']) as p(privilege)
   cross join pg_attribute a
   where a.attrelid = v_users
     and a.attnum > 0
     and not a.attisdropped
     and has_column_privilege(r.role_name, v_users, a.attname, p.privilege);
  if v_found is not null then
    raise exception
      'public.users: client roles hold column write privileges: %',
      v_found;
  end if;

  select count(*) into v_policies from pg_policy where polrelid = v_plaid;
  if v_policies <> 0 then
    raise exception 'plaid_connections: expected no policies, found %',
      v_policies;
  end if;

  select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
    into v_found
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(v_plaid_privileges) as p(privilege)
   where has_table_privilege(r.role_name, v_plaid, p.privilege);
  if v_found is not null then
    raise exception
      'plaid_connections: client roles hold table privileges: %',
      v_found;
  end if;
end
$$;

commit;
