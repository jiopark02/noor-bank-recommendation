-- One active connection per user per institution on public.plaid_connections.
--
-- What it does:
--   - creates the partial unique index
--     plaid_connections_user_institution_active_key on
--     (user_id, institution_id), over rows where institution_id is not null
--     and status = 'active'.
--
-- Why. The exchange path looks for an active row at the same institution
-- before it stores a new connection, but two requests running at once can
-- both read "none" and both insert. This index makes the database refuse the
-- second insert with a unique violation (23505).
--
-- The index condition is the application's duplicate filter
-- (getActivePlaidConnectionByInstitution in src/lib/plaidApiUtils.ts: the
-- same user, an equal institution_id, status = 'active'). Keep the two the
-- same: a row the filter would not find must not be a row the index refuses,
-- and the reverse. Rows with a NULL institution_id and rows whose status is
-- not 'active' are outside the index and are not constrained by it.
--
-- The index must only exist on a database whose every writer tells the two
-- causes of a 23505 apart. Both orders below follow from that.
--
-- Deploy order: deploy the code that handles both causes of a unique
-- violation on this table's insert (src/lib/plaidExchange.ts reads the user's
-- row for the Item to tell an existing row for the same Item from another
-- Item at the same institution) before applying this index to the database
-- that code writes to. Code that reads every 23505 as "the row for this Item
-- exists" would, on a conflict with another Item, stop without revoking the
-- Item it just created at Plaid.
--
-- Rollback order: to roll the code back to a version that reads every 23505
-- as the row for this Item, drop the index first; older code on a database
-- with the index stops on an institution conflict without revoking the Item
-- it just minted. The same holds for any older build that writes to a
-- database carrying the index.
--
-- An UPDATE can violate the index as well: setting a row's status back to
-- 'active', or changing its institution_id, fails with 23505 when the user
-- already has an active row at that institution.
--
-- Order inside the file, in one transaction, so a failure leaves nothing
-- behind:
--   1. A DO block that stops the file when rows the index would cover already
--      share a (user_id, institution_id). It reports the number of such pairs
--      and no values. Those connections are cleaned up through the
--      application's revocation path, never by deleting rows with SQL: a row
--      holds the only copy of its access token.
--   2. The index.
--   3. A DO block that reads the catalog and raises unless an index of that
--      name exists on the table, is unique and valid, is on exactly those two
--      columns in that order, and carries exactly that condition. `if not
--      exists` skips by name alone, so this is what catches an index of the
--      same name with another definition. The condition is compared as a
--      whole with the text PostgreSQL prints for it (pg_get_expr), not
--      searched for its parts: a condition such as status <> 'active' holds
--      every part and is still another index.
--
-- The text the check expects is how PostgreSQL prints the condition on a
-- table whose status column is character varying. Where that column has
-- another type the same condition prints differently (with a text column,
-- status = 'active'::text with no cast on the column), so there the correct
-- index raises in this check too and the whole file rolls back, the index
-- with it. The message carries both texts: read them before concluding the
-- index is wrong, and when only the printed form differs, change the expected
-- text to that database's form rather than removing the check.
--
-- When the check raises on an index that was already there under this name,
-- the file has changed nothing and that index is still in place; it has to be
-- looked at and replaced by hand before this file can pass.
--
-- Locks: a plain CREATE INDEX holds a SHARE lock on the table while it
-- builds, so inserts, updates and deletes of plaid_connections wait for it;
-- reads do not. It is not built CONCURRENTLY: that cannot run inside a
-- transaction, and a failed concurrent build leaves an invalid index behind.
-- lock_timeout bounds the wait for the lock, and a wait that runs out rolls
-- the whole file back.
--
-- Whether this file has been applied to a given database is live state; read
-- that database's indexes (pg_indexes) rather than inferring them from this
-- file.
--
-- Running this file again where it is applied changes nothing: the index is
-- skipped by name and the closing DO block checks it again.
--
-- To reverse it. The current code in src/lib/plaidExchange.ts works correctly
-- with or without the index, so dropping it needs no code change:
--   drop index if exists public.plaid_connections_user_institution_active_key;

begin;

set local lock_timeout = '5s';

do $$
declare
  v_duplicate_pairs bigint;
begin
  select count(*) into v_duplicate_pairs
    from (
      select 1
        from public.plaid_connections p
       where p.institution_id is not null
         and p.status = 'active'
       group by p.user_id, p.institution_id
      having count(*) > 1
    ) pairs;
  if v_duplicate_pairs <> 0 then
    raise exception
      'plaid_connections: % (user_id, institution_id) pairs have more than one active row; remove the extra connections through the application before creating the index',
      v_duplicate_pairs;
  end if;
end;
$$;

create unique index if not exists plaid_connections_user_institution_active_key
  on public.plaid_connections (user_id, institution_id)
  where institution_id is not null and status = 'active';

do $$
declare
  v_table regclass := 'public.plaid_connections'::regclass;
  v_unique boolean;
  v_valid boolean;
  v_columns name[];
  v_predicate text;
  v_expected_predicate constant text :=
    '((institution_id IS NOT NULL) AND ((status)::text = ''active''::text))';
begin
  select i.indisunique,
         i.indisvalid,
         (select array_agg(a.attname order by k.ord)
            from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
            join pg_attribute a
              on a.attrelid = i.indrelid and a.attnum = k.attnum),
         pg_get_expr(i.indpred, i.indrelid)
    into v_unique, v_valid, v_columns, v_predicate
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where i.indrelid = v_table
     and n.nspname = 'public'
     and c.relname = 'plaid_connections_user_institution_active_key';

  if not found then
    raise exception
      'plaid_connections: index plaid_connections_user_institution_active_key is missing';
  end if;
  if v_unique is not true then
    raise exception
      'plaid_connections: plaid_connections_user_institution_active_key is not unique';
  end if;
  if v_valid is not true then
    raise exception
      'plaid_connections: plaid_connections_user_institution_active_key is not valid';
  end if;
  if v_columns is distinct from array['user_id', 'institution_id']::name[] then
    raise exception
      'plaid_connections: plaid_connections_user_institution_active_key is on %, expected (user_id, institution_id)',
      v_columns;
  end if;
  if v_predicate is distinct from v_expected_predicate then
    raise exception
      'plaid_connections: plaid_connections_user_institution_active_key has the condition %, expected %',
      coalesce(v_predicate, '(none)'),
      v_expected_predicate;
  end if;
end;
$$;

commit;
