-- Migration: sharing a bank connection with the other household member
-- Date: 2026-11-21
--
-- What this file does:
--   - share_grants, created by 20261108120000_create_households_and_goals.sql
--     with no writer until now, becomes a permission given to one person:
--       grantee_user_id  uuid, not null, references public.users on delete
--                        cascade. The person the owner shares with. A check
--                        keeps it different from owner_user_id.
--       (owner_user_id, resource_id) references plaid_connections (user_id,
--                        id) on delete cascade, so a grant names a connection
--                        of its own owner and disappears with that row.
--     A grant exists exactly while the connection is shared: turning sharing
--     off deletes the row. revoked_at stays, always null, because the
--     existing partial unique index share_grants_one_open_grant is defined
--     on it; nothing here sets it.
--   - Creates a unique index plaid_connections_user_id_id_key on
--     plaid_connections (user_id, id), which the composite foreign keys
--     need. id is already the primary key, so no insert or update can
--     violate it, and it adds no new cause of a 23505 on that table.
--   - Creates share_prompt_answers: one row per connection and person, meaning
--     "the owner was asked whether to share this connection with this
--     person". It records that the question was answered, not the answer.
--     The primary key is a uuid id, the single column the account export
--     pages on. A unique constraint, share_prompt_answers_resource_grantee_key
--     on (resource_id, grantee_user_id), allows one row per connection and
--     person; household_share_set's insert names it as its conflict
--     target. owner_user_id and
--     grantee_user_id reference public.users, household_id references
--     households, and (owner_user_id, resource_id) references
--     plaid_connections (user_id, id), all on delete cascade. A new partner
--     is a new question: a row for one person does not answer for another.
--   - Creates public.household_share_set(p_user_id, p_item_id, p_shared),
--     the only function that inserts into either table. It answers one of:
--       none           the caller has no active household
--       solo           the caller's household does not have exactly one other
--                      active member
--       no_connection  the caller has no connection with that item id
--       shared         a grant to the other member exists
--       unshared       no grant for that connection exists
--       refused        a row it depends on disappeared while it ran
--     The connection is looked up by the caller's own user id and the item
--     id, so another person's item id answers no_connection. Before it
--     writes, it deletes the caller's grants on that connection whose
--     grantee is not the current other member. Either answer records that
--     the question was answered.
--   - Replaces public.household_leave(uuid) with the body from
--     20261120120000_household_invites_and_membership_changes.sql plus two
--     deletes, under the locks it already holds: every share_grants and
--     share_prompt_answers row of the household being left whose owner or
--     grantee is the person leaving. Rows between members who stay are kept,
--     should a household ever hold more than two. The signature, the
--     answers, the locks and the owner succession are unchanged.
--   - Deletes every grant and answer whose owner or grantee is not an
--     active member of the row's household, and checks that none is left
--     (see "Rows left by a household_leave without the deletes" below).
--
-- How grants end:
--   - Leaving a household: household_leave, above, for the rows the person
--     leaving gave or received there.
--   - Disconnecting a bank, by any path that deletes the plaid_connections
--     row: the composite foreign keys, in the same statement.
--   - Deleting an account, owner or grantee: the foreign keys to
--     public.users, from any path that deletes the users row.
--   - Deleting a household: the existing household_id foreign key.
--   No trigger is added; the closing DO block of
--   20261120120000_household_invites_and_membership_changes.sql requires
--   household_members to carry only its cleanup trigger.
--
-- What a future reader of a grant must check. A row says the owner allowed
-- one person to see one connection. A reader must require grantee_user_id to
-- be the person reading, and both the owner and the reader to be active
-- members of the row's household_id. household_id alone decides nothing.
--
-- Locking. household_share_set takes the caller's user lock, the same key as
-- household_ensure_for_user, then the household's lock, and decides only on
-- what it reads under both, as the functions in
-- 20261120120000_household_invites_and_membership_changes.sql do.
--
-- Access: service role only. RLS is on with no policies on both tables.
-- Every privilege on them and EXECUTE on both functions is revoked from
-- PUBLIC, anon and authenticated. service_role holds exactly SELECT, INSERT
-- and DELETE on both tables, no UPDATE, and EXECUTE on both functions. Both
-- functions are SECURITY INVOKER with an empty search_path. The table
-- owners keep DELETE, which the cascades need.
--
-- Before it changes anything, the file raises unless
-- plaid_connections.user_id is a uuid, and, when grantee_user_id does not
-- exist yet, unless share_grants is empty: a row written without a grantee
-- has no meaning under this file.
--
-- Locks: share_grants is locked in ACCESS EXCLUSIVE mode and
-- plaid_connections in SHARE ROW EXCLUSIVE mode at the start and held to
-- commit, so writes to plaid_connections wait while the file runs. Adding a
-- foreign key also takes SHARE ROW EXCLUSIVE on public.users and households.
-- lock_timeout bounds every wait, and a wait that runs out rolls the whole
-- file back.
--
-- The closing DO block checks the end state by property and raises, rolling
-- the whole file back, unless every property holds.
--
-- Order of deployment: apply this file to a database before deploying code
-- that calls household_share_set or exports share_prompt_answers against it.
-- The new household_leave works with the code deployed before it. Whether
-- this file is applied is live state.
--
-- Running it again: every statement is idempotent, and the DO block passes
-- again. Two earlier files undo part of it when they run again, and their
-- own checks pass:
--   - 20261108120000_create_households_and_goals.sql takes back service_role
--     INSERT and DELETE on share_grants. Until this file is applied again,
--     every call that reaches a delete from share_grants as service_role
--     fails with 42501: household_leave for a person leaving a household
--     that has another active member, and household_share_set for a
--     caller with exactly one other active member and a connection with
--     that item id. Answers given before that delete (none, solo,
--     no_connection) are not affected.
--   - 20261120120000_household_invites_and_membership_changes.sql replaces
--     household_leave with the body that deletes no grant.
-- After running either again, run this file again; its DO block is the one
-- that detects both.
--
-- Rows left by a household_leave without the deletes. While the second file
-- above is the last to have run, a person who leaves keeps every
-- share_grants and share_prompt_answers row they gave or received. Just
-- before the closing DO block, this file deletes every row of either table
-- whose owner or grantee is not an active member of the row's household,
-- and the DO block then requires that no such row is left. On a first
-- application both tables are empty and the deletes remove nothing; in
-- normal operation no such row exists, because household_share_set writes a
-- row only while both people are active members there and household_leave
-- deletes it in the same transaction that ends the membership. What the
-- deletes cannot tell apart: a person who left during that window and has
-- since joined the same household again is an active member there again, so
-- the rows from before they left are kept and count as shared.
--
-- 20261107130000_add_integrity_constraints_users_plaid_connections.sql
-- cannot be reversed while this file is applied: the composite foreign keys
-- need plaid_connections.user_id to stay a uuid. Reverse this file first.
--
-- To reverse it (after the application code that calls household_share_set
-- or exports share_prompt_answers is reverted and deployed): first apply
-- 20261120120000_household_invites_and_membership_changes.sql again, which
-- restores household_leave without the two deletes, then run:
--   begin;
--   drop function if exists public.household_share_set(uuid, text, boolean);
--   drop table if exists public.share_prompt_answers;
--   delete from public.share_grants;
--   alter table public.share_grants drop constraint if exists share_grants_connection_fkey;
--   alter table public.share_grants drop constraint if exists share_grants_grantee_not_owner;
--   alter table public.share_grants drop column if exists grantee_user_id;
--   drop index if exists public.share_grants_household_id_idx;
--   drop index if exists public.share_grants_grantee_user_id_idx;
--   drop index if exists public.plaid_connections_user_id_id_key;
--   revoke insert, delete on table public.share_grants from service_role;
--   commit;
-- The delete removes every grant: without its grantee a row would read as
-- a permission for the whole household, which is not what the owner gave.

begin;

set local lock_timeout = '5s';

lock table public.share_grants in access exclusive mode;
lock table public.plaid_connections in share row exclusive mode;

do $$
begin
  if (
    select pg_catalog.format_type(a.atttypid, a.atttypmod)
      from pg_attribute a
     where a.attrelid = 'public.plaid_connections'::regclass
       and a.attname = 'user_id'
       and not a.attisdropped
  ) is distinct from 'uuid' then
    raise exception 'public.plaid_connections.user_id is not a uuid; apply 20261107130000_add_integrity_constraints_users_plaid_connections.sql first';
  end if;

  if not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.share_grants'::regclass
       and a.attname = 'grantee_user_id'
       and not a.attisdropped
  ) and exists (select 1 from public.share_grants) then
    raise exception 'public.share_grants has rows without a grantee; this file does not convert them';
  end if;
end
$$;

alter table public.share_grants
  add column if not exists grantee_user_id uuid not null;

alter table public.share_grants
  drop constraint if exists share_grants_grantee_user_id_fkey;
alter table public.share_grants
  add constraint share_grants_grantee_user_id_fkey
  foreign key (grantee_user_id) references public.users(id) on delete cascade;

alter table public.share_grants
  drop constraint if exists share_grants_grantee_not_owner;
alter table public.share_grants
  add constraint share_grants_grantee_not_owner
  check (grantee_user_id <> owner_user_id);

create unique index if not exists plaid_connections_user_id_id_key
  on public.plaid_connections (user_id, id);

alter table public.share_grants
  drop constraint if exists share_grants_connection_fkey;
alter table public.share_grants
  add constraint share_grants_connection_fkey
  foreign key (owner_user_id, resource_id)
  references public.plaid_connections (user_id, id) on delete cascade;

create index if not exists share_grants_grantee_user_id_idx
  on public.share_grants (grantee_user_id);

create index if not exists share_grants_household_id_idx
  on public.share_grants (household_id);

create table if not exists public.share_prompt_answers (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references public.users(id) on delete cascade,
  grantee_user_id  uuid not null references public.users(id) on delete cascade,
  household_id     uuid not null references public.households(id) on delete cascade,
  resource_id      bigint not null,
  answered_at      timestamptz not null default now(),
  constraint share_prompt_answers_resource_grantee_key unique (resource_id, grantee_user_id),
  constraint share_prompt_answers_grantee_not_owner check (grantee_user_id <> owner_user_id),
  constraint share_prompt_answers_connection_fkey
    foreign key (owner_user_id, resource_id)
    references public.plaid_connections (user_id, id) on delete cascade
);

create index if not exists share_prompt_answers_owner_user_id_idx
  on public.share_prompt_answers (owner_user_id);

create index if not exists share_prompt_answers_grantee_user_id_idx
  on public.share_prompt_answers (grantee_user_id);

create index if not exists share_prompt_answers_household_id_idx
  on public.share_prompt_answers (household_id);

revoke all on table public.share_grants from public, anon, authenticated;
revoke all on table public.share_grants from service_role;
grant select, insert, delete on table public.share_grants to service_role;
alter table public.share_grants enable row level security;

revoke all on table public.share_prompt_answers from public, anon, authenticated;
-- A default ACL can hand service_role every table privilege at creation; take
-- them back so it holds only what the function and the export use.
revoke all on table public.share_prompt_answers from service_role;
grant select, insert, delete on table public.share_prompt_answers to service_role;
alter table public.share_prompt_answers enable row level security;

create or replace function public.household_share_set(
  p_user_id uuid,
  p_item_id text,
  p_shared boolean
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_reread uuid;
  v_others integer;
  v_partner uuid;
  v_connection bigint;
begin
  if p_user_id is null or p_item_id is null or p_shared is null then
    raise exception 'household_share_set: invalid arguments'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));

  select m.household_id
    into v_household
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_household is null then
    return 'none';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household_group:' || v_household::text, 0));

  -- Read again under the household lock; decide only on these reads.
  select m.household_id
    into v_reread
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_reread is distinct from v_household then
    return 'none';
  end if;

  select count(*)
    into v_others
    from public.household_members m
   where m.household_id = v_household
     and m.status = 'active'
     and m.user_id <> p_user_id;
  if v_others <> 1 then
    return 'solo';
  end if;

  select m.user_id
    into v_partner
    from public.household_members m
   where m.household_id = v_household
     and m.status = 'active'
     and m.user_id <> p_user_id;

  select c.id
    into v_connection
    from public.plaid_connections c
   where c.user_id = p_user_id
     and c.item_id = p_item_id;
  if v_connection is null then
    return 'no_connection';
  end if;

  begin
    delete from public.share_grants g
     where g.owner_user_id = p_user_id
       and g.resource_id = v_connection
       and g.grantee_user_id <> v_partner;

    insert into public.share_prompt_answers
      (owner_user_id, grantee_user_id, household_id, resource_id)
    values (p_user_id, v_partner, v_household, v_connection)
    on conflict (resource_id, grantee_user_id) do nothing;

    if p_shared then
      insert into public.share_grants
        (owner_user_id, grantee_user_id, household_id, resource_type, resource_id, scope)
      values (p_user_id, v_partner, v_household, 'plaid_connection', v_connection, 'view')
      on conflict (household_id, resource_type, resource_id, scope)
        where revoked_at is null
        do nothing;

      if not exists (
        select 1
          from public.share_grants g
         where g.owner_user_id = p_user_id
           and g.resource_id = v_connection
           and g.grantee_user_id = v_partner
           and g.household_id = v_household
      ) then
        return 'refused';
      end if;
      return 'shared';
    end if;

    delete from public.share_grants g
     where g.owner_user_id = p_user_id
       and g.resource_id = v_connection;
  exception
    when foreign_key_violation then
      -- A row this write depends on (the connection, a user, the household)
      -- was deleted after the reads above. Everything in this block is
      -- rolled back.
      return 'refused';
  end;

  return 'unshared';
end
$$;

create or replace function public.household_leave(p_user_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_member_id uuid;
  v_role text;
  v_others integer;
begin
  if p_user_id is null then
    raise exception 'household_leave: a user id is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || p_user_id::text, 0));

  select m.household_id
    into v_household
    from public.household_members m
   where m.user_id = p_user_id
     and m.status = 'active';
  if v_household is null then
    return 'none';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household_group:' || v_household::text, 0));

  select m.id, m.role
    into v_member_id, v_role
    from public.household_members m
   where m.user_id = p_user_id
     and m.household_id = v_household
     and m.status = 'active';
  if v_member_id is null then
    return 'none';
  end if;

  select count(*)
    into v_others
    from public.household_members m
   where m.household_id = v_household
     and m.status = 'active'
     and m.user_id <> p_user_id;
  if v_others = 0 then
    return 'solo';
  end if;

  if v_role = 'owner' then
    update public.household_members
       set role = 'owner'
     where id = (
       select s.id
         from public.household_members s
        where s.household_id = v_household
          and s.status = 'active'
          and s.user_id <> p_user_id
        order by s.joined_at asc, s.id asc
        limit 1
     );
  end if;

  update public.household_members
     set status = 'left',
         left_at = pg_catalog.now()
   where id = v_member_id;

  delete from public.household_invites i
   where i.invited_by = p_user_id
      or i.household_id = v_household;

  delete from public.share_grants g
   where g.household_id = v_household
     and (g.owner_user_id = p_user_id or g.grantee_user_id = p_user_id);

  delete from public.share_prompt_answers a
   where a.household_id = v_household
     and (a.owner_user_id = p_user_id or a.grantee_user_id = p_user_id);

  return 'left';
end
$$;

revoke all on function public.household_share_set(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.household_share_set(uuid, text, boolean) to service_role;

revoke all on function public.household_leave(uuid)
  from public, anon, authenticated;
grant execute on function public.household_leave(uuid) to service_role;

-- Delete every grant and answer whose owner or grantee is not an active
-- member of the row's household (see "Rows left by a household_leave
-- without the deletes" above). Nothing matches on a first application.
delete from public.share_grants g
 where not exists (
         select 1
           from public.household_members m
          where m.household_id = g.household_id
            and m.user_id = g.owner_user_id
            and m.status = 'active'
       )
    or not exists (
         select 1
           from public.household_members m
          where m.household_id = g.household_id
            and m.user_id = g.grantee_user_id
            and m.status = 'active'
       );

delete from public.share_prompt_answers a
 where not exists (
         select 1
           from public.household_members m
          where m.household_id = a.household_id
            and m.user_id = a.owner_user_id
            and m.status = 'active'
       )
    or not exists (
         select 1
           from public.household_members m
          where m.household_id = a.household_id
            and m.user_id = a.grantee_user_id
            and m.status = 'active'
       );

do $$
declare
  v_tables text[] := array['share_grants', 'share_prompt_answers'];
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_functions regprocedure[] := array[
    'public.household_share_set(uuid, text, boolean)'::regprocedure,
    'public.household_leave(uuid)'::regprocedure
  ];
  v_name text;
  v_table regclass;
  v_remaining text;
  v_rls boolean;
  v_policies integer;
  v_ok boolean;
  v_fk record;
  v_fn regprocedure;
  v_proacl aclitem[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_prosrc text;
  v_count integer;
  v_search_path text;
  v_triggerdef text;
  v_tgtype smallint;
  v_tgenabled "char";
begin
  -- MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it before.
  if current_setting('server_version_num')::integer >= 170000 then
    v_privileges := v_privileges || 'MAINTAIN'::text;
  end if;

  foreach v_name in array v_tables loop
    v_table := ('public.' || v_name)::regclass;

    -- 1. No table or column privilege for anon or authenticated.
    select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
      into v_remaining
      from unnest(array['anon', 'authenticated']) as r(role_name)
     cross join unnest(v_privileges) as p(privilege)
     where has_table_privilege(r.role_name, v_table, p.privilege)
        or has_any_column_privilege(r.role_name, v_table, 'SELECT,INSERT,UPDATE,REFERENCES');
    if v_remaining is not null then
      raise exception '%: client roles still hold privileges: %', v_table, v_remaining;
    end if;

    -- 2. No table privilege for PUBLIC (grantee 0).
    if exists (
      select 1
        from pg_class c,
             lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = v_table
         and a.grantee = 0
    ) then
      raise exception '%: PUBLIC still holds a table privilege', v_table;
    end if;

    -- 3. RLS on, no policies.
    select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
    if v_rls is distinct from true then
      raise exception '%: row level security is not enabled', v_table;
    end if;
    select count(*) into v_policies from pg_policy where polrelid = v_table;
    if v_policies <> 0 then
      raise exception '%: expected no policies, found %', v_table, v_policies;
    end if;

    -- 4. service_role holds exactly SELECT, INSERT and DELETE, and no
    --    column privilege beyond them.
    select string_agg(p.privilege, ', ')
      into v_remaining
      from unnest(v_privileges) as p(privilege)
     where (p.privilege = any(array['SELECT', 'INSERT', 'DELETE']))
           <> has_table_privilege('service_role', v_table, p.privilege);
    if v_remaining is not null then
      raise exception '%: service_role privileges differ from SELECT, INSERT, DELETE at: %',
        v_table, v_remaining;
    end if;
    if has_any_column_privilege('service_role', v_table, 'UPDATE,REFERENCES') then
      raise exception '%: service_role holds a column UPDATE or REFERENCES', v_table;
    end if;

    -- 5. The owner keeps DELETE, so the foreign-key cascades can delete rows.
    if not exists (
      select 1 from pg_class c
       where c.oid = v_table
         and has_table_privilege(c.relowner, v_table, 'DELETE')
    ) then
      raise exception '%: the table owner lacks DELETE', v_table;
    end if;

    -- 6. No user trigger, with one exception: share_grants may carry, alone,
    --    the delete trigger that 20261122120000_chat_shared_sources.sql
    --    defines, enabled and exactly as defined there. So this file passes
    --    both before that file is applied and after. The definition is read
    --    under an empty search_path, which makes pg_get_triggerdef write the
    --    function with its schema whatever the caller's search_path is.
    select count(*)
      into v_count
      from pg_trigger t
     where t.tgrelid = v_table
       and not t.tgisinternal;
    if v_count <> 0 then
      if v_name <> 'share_grants' or v_count <> 1 then
        raise exception '%: carries a trigger', v_table;
      end if;
      v_search_path := current_setting('search_path');
      perform set_config('search_path', '', true);
      select pg_get_triggerdef(t.oid), t.tgtype, t.tgenabled
        into v_triggerdef, v_tgtype, v_tgenabled
        from pg_trigger t
       where t.tgrelid = v_table
         and not t.tgisinternal;
      perform set_config('search_path', v_search_path, true);
      -- tgtype 9 is row (1) + delete (8): AFTER, no other event.
      if v_triggerdef is distinct from
           'CREATE TRIGGER trg_share_grants_purge_chat AFTER DELETE ON public.share_grants FOR EACH ROW EXECUTE FUNCTION public.chat_shared_sources_purge_on_grant_delete()'
         or v_tgtype <> 9
         or v_tgenabled <> 'O' then
        raise exception '%: its trigger is not the enabled chat purge trigger as defined: %',
          v_table, v_triggerdef;
      end if;
    end if;
  end loop;

  -- 7. Every foreign key, with its columns in order, and on delete cascade.
  for v_fk in
    select *
      from (values
        ('share_grants',         array['owner_user_id'],                'public.users',             array['id']),
        ('share_grants',         array['grantee_user_id'],              'public.users',             array['id']),
        ('share_grants',         array['household_id'],                 'public.households',        array['id']),
        ('share_grants',         array['owner_user_id', 'resource_id'], 'public.plaid_connections', array['user_id', 'id']),
        ('share_prompt_answers', array['owner_user_id'],                'public.users',             array['id']),
        ('share_prompt_answers', array['grantee_user_id'],              'public.users',             array['id']),
        ('share_prompt_answers', array['household_id'],                 'public.households',        array['id']),
        ('share_prompt_answers', array['owner_user_id', 'resource_id'], 'public.plaid_connections', array['user_id', 'id'])
      ) as f(tbl, cols, ref, refcols)
  loop
    select exists (
      select 1
        from pg_constraint k
       where k.conrelid = ('public.' || v_fk.tbl)::regclass
         and k.contype = 'f'
         and k.confrelid = v_fk.ref::regclass
         and k.confdeltype = 'c'
         and array(
               select a.attname::text
                 from unnest(k.conkey) with ordinality as u(attnum, n)
                 join pg_attribute a
                   on a.attrelid = k.conrelid
                  and a.attnum = u.attnum
                order by u.n
             ) = v_fk.cols
         and array(
               select a.attname::text
                 from unnest(k.confkey) with ordinality as u(attnum, n)
                 join pg_attribute a
                   on a.attrelid = k.confrelid
                  and a.attnum = u.attnum
                order by u.n
             ) = v_fk.refcols
    ) into v_ok;
    if not v_ok then
      raise exception 'public.%: % does not reference %(%) with on delete cascade',
        v_fk.tbl, v_fk.cols, v_fk.ref, v_fk.refcols;
    end if;
  end loop;

  -- 8. grantee_user_id is not null and differs from owner_user_id on both
  --    tables.
  foreach v_name in array v_tables loop
    v_table := ('public.' || v_name)::regclass;
    if not exists (
      select 1
        from pg_attribute a
       where a.attrelid = v_table
         and a.attname = 'grantee_user_id'
         and a.attnotnull
         and not a.attisdropped
    ) then
      raise exception '%: grantee_user_id is missing or nullable', v_table;
    end if;
    if not exists (
      select 1
        from pg_constraint k
       where k.conrelid = v_table
         and k.contype = 'c'
         and pg_get_constraintdef(k.oid) = 'CHECK ((grantee_user_id <> owner_user_id))'
    ) then
      raise exception '%: no check that grantee_user_id differs from owner_user_id', v_table;
    end if;
  end loop;

  -- 9. plaid_connections has a unique, valid, non-partial index on exactly
  --    (user_id, id), in that order.
  select exists (
    select 1
      from pg_index i
     where i.indrelid = 'public.plaid_connections'::regclass
       and i.indisunique
       and i.indisvalid
       and i.indpred is null
       and i.indexprs is null
       and i.indnatts = 2
       and array(
             select a.attname::text
               from unnest(i.indkey::int2[]) with ordinality as u(attnum, n)
               join pg_attribute a
                 on a.attrelid = i.indrelid
                and a.attnum = u.attnum
              order by u.n
           ) = array['user_id', 'id']
  ) into v_ok;
  if not v_ok then
    raise exception 'public.plaid_connections: no unique index on (user_id, id)';
  end if;

  -- 10. The one-open-grant index still has the condition the function's
  --     insert names.
  select exists (
    select 1
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
     where i.indrelid = 'public.share_grants'::regclass
       and ic.relname = 'share_grants_one_open_grant'
       and i.indisunique
       and pg_get_expr(i.indpred, i.indrelid) = '(revoked_at IS NULL)'
  ) into v_ok;
  if not v_ok then
    raise exception 'public.share_grants: share_grants_one_open_grant is missing or has another condition';
  end if;

  -- 11. household_leave deletes the leaving person's grants and answers in
  --     the household. A run of
  --     20261120120000_household_invites_and_membership_changes.sql after
  --     this file replaces it with a body that does not.
  select p.prosrc into v_prosrc
    from pg_proc p
   where p.oid = 'public.household_leave(uuid)'::regprocedure;
  if strpos(v_prosrc, 'delete from public.share_grants g') = 0
     or strpos(v_prosrc, 'delete from public.share_prompt_answers a') = 0 then
    raise exception 'public.household_leave(uuid): does not delete the leaving person''s share grants and answers; apply this file again';
  end if;

  -- 12. Both functions: SECURITY INVOKER, an empty search_path, no EXECUTE
  --     for PUBLIC, anon or authenticated, and EXECUTE for service_role.
  foreach v_fn in array v_functions loop
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
    if v_prosecdef then
      raise exception '%: expected SECURITY INVOKER', v_fn;
    end if;
    if v_proconfig is null or not ('search_path=""' = any(v_proconfig)) then
      raise exception '%: expected an empty search_path, found %', v_fn, v_proconfig;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '%: service_role lacks EXECUTE', v_fn;
    end if;
  end loop;

  -- 13. household_members still carries exactly one user trigger, the
  --     cleanup trigger.
  select count(*) into v_count
    from pg_trigger t
   where t.tgrelid = 'public.household_members'::regclass
     and not t.tgisinternal;
  if v_count <> 1 or not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.household_members'::regclass
       and not t.tgisinternal
       and t.tgname = 'trg_household_members_cleanup'
  ) then
    raise exception 'public.household_members: expected only the cleanup trigger, found % triggers', v_count;
  end if;

  -- 14. plaid_connections.user_id is still a uuid.
  if (
    select pg_catalog.format_type(a.atttypid, a.atttypmod)
      from pg_attribute a
     where a.attrelid = 'public.plaid_connections'::regclass
       and a.attname = 'user_id'
       and not a.attisdropped
  ) is distinct from 'uuid' then
    raise exception 'public.plaid_connections.user_id is not a uuid';
  end if;

  -- 15. share_prompt_answers has a unique constraint on exactly
  --     (resource_id, grantee_user_id), in that order. household_share_set's
  --     insert names those columns as its conflict target, which needs a
  --     unique constraint or index on exactly them.
  select exists (
    select 1
      from pg_constraint k
     where k.conrelid = 'public.share_prompt_answers'::regclass
       and k.contype = 'u'
       and array(
             select a.attname::text
               from unnest(k.conkey) with ordinality as u(attnum, n)
               join pg_attribute a
                 on a.attrelid = k.conrelid
                and a.attnum = u.attnum
              order by u.n
           ) = array['resource_id', 'grantee_user_id']
  ) into v_ok;
  if not v_ok then
    raise exception 'public.share_prompt_answers: no unique constraint on (resource_id, grantee_user_id)';
  end if;

  -- 16. No grant or answer names an owner or grantee who is not an active
  --     member of the row's household.
  foreach v_name in array v_tables loop
    execute format(
      'select count(*) from public.%I r
        where not exists (
                select 1 from public.household_members m
                 where m.household_id = r.household_id
                   and m.user_id = r.owner_user_id
                   and m.status = ''active'')
           or not exists (
                select 1 from public.household_members m
                 where m.household_id = r.household_id
                   and m.user_id = r.grantee_user_id
                   and m.status = ''active'')',
      v_name
    ) into v_count;
    if v_count <> 0 then
      raise exception 'public.%: % rows name someone who is not an active member of the row''s household', v_name, v_count;
    end if;
  end loop;
end
$$;

commit;
