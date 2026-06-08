-- Enable Row Level Security on tables that were created without it.
--
-- Context: createServerClient() uses the service-role key, which BYPASSES RLS.
-- So today the only thing protecting these tables is the app-level
-- `.eq('user_id', ...)` filter. That works, but it is a single line of defense:
-- one missing filter (or any path that reaches the DB with the anon key) would
-- expose every user's rows. This migration adds RLS as a safety net.
--
-- IMPORTANT: enabling RLS does NOT break the app's normal behavior, because the
-- server routes use the service-role client, which is exempt from RLS. These
-- policies only constrain non-service-role access (e.g. the public anon key).
--
-- Each table is in its own independent section so it can be applied or rolled
-- back on its own. If any single table misbehaves, drop just that section's
-- policies and disable RLS on that one table.
--
-- user_id column types (verified against the live DB):
--   plaid_connections.user_id  = text  -> policies must cast auth.uid()::text
--   recommendations_new.user_id = uuid -> no cast needed
--   posts.user_id               = uuid -> no cast needed
--   bank_accounts               = no user_id column (public catalog)


-- =====================================================================
-- SECTION 0: DROP saved_banks  (unused table, currently wide open)
--
-- saved_banks has RLS OFF and full GRANTs to the anon role
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE), so anyone with the public anon key
-- could read/write/empty it. It is empty and completely unused by the app:
-- a codebase search found zero runtime references (no .from('saved_banks')),
-- only a leftover schema definition, an FK-retarget migration, and an unused
-- TypeScript interface. Rather than add RLS to a dead table we will eventually
-- drop anyway, we remove it now to eliminate the attack surface entirely.
--
-- CASCADE drops the dependent FK constraint (saved_banks_user_id_fkey ->
-- users(id)) and any other dependent objects. Safe here because nothing
-- references this table.
--
-- (The unused SavedBank interface in src/types/database.ts is dead code after
-- this; it will be removed in the optimization/dead-code pass.)
-- =====================================================================
drop table if exists public.saved_banks cascade;


-- =====================================================================
-- SECTION 1: plaid_connections  (most sensitive: stores bank access tokens)
-- user_id is TEXT, so auth.uid() must be cast to text.
-- Private per-user data: owner-only for all operations.
-- =====================================================================
alter table public.plaid_connections enable row level security;

drop policy if exists plaid_connections_select_own on public.plaid_connections;
create policy plaid_connections_select_own
on public.plaid_connections
for select
using (auth.uid()::text = user_id);

drop policy if exists plaid_connections_insert_own on public.plaid_connections;
create policy plaid_connections_insert_own
on public.plaid_connections
for insert
with check (auth.uid()::text = user_id);

drop policy if exists plaid_connections_update_own on public.plaid_connections;
create policy plaid_connections_update_own
on public.plaid_connections
for update
using (auth.uid()::text = user_id)
with check (auth.uid()::text = user_id);

drop policy if exists plaid_connections_delete_own on public.plaid_connections;
create policy plaid_connections_delete_own
on public.plaid_connections
for delete
using (auth.uid()::text = user_id);


-- =====================================================================
-- SECTION 2: recommendations_new  (private per-user recommendations)
-- user_id is UUID, no cast needed.
-- Owner-only for all operations.
-- =====================================================================
alter table public.recommendations_new enable row level security;

drop policy if exists recommendations_new_select_own on public.recommendations_new;
create policy recommendations_new_select_own
on public.recommendations_new
for select
using (auth.uid() = user_id);

drop policy if exists recommendations_new_insert_own on public.recommendations_new;
create policy recommendations_new_insert_own
on public.recommendations_new
for insert
with check (auth.uid() = user_id);

drop policy if exists recommendations_new_update_own on public.recommendations_new;
create policy recommendations_new_update_own
on public.recommendations_new
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists recommendations_new_delete_own on public.recommendations_new;
create policy recommendations_new_delete_own
on public.recommendations_new
for delete
using (auth.uid() = user_id);


-- =====================================================================
-- SECTION 3: posts  (forum)
-- SELECT is PUBLIC on purpose: the forum GET route reads posts without auth.
-- Writes are owner-only so nobody can edit/delete another user's post.
-- user_id is UUID, no cast needed.
-- =====================================================================
alter table public.posts enable row level security;

-- Public read: keep the forum listing working for everyone (incl. anon).
drop policy if exists posts_select_public on public.posts;
create policy posts_select_public
on public.posts
for select
using (true);

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own
on public.posts
for insert
with check (auth.uid() = user_id);

drop policy if exists posts_update_own on public.posts;
create policy posts_update_own
on public.posts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own
on public.posts
for delete
using (auth.uid() = user_id);


-- =====================================================================
-- SECTION 4: bank_accounts  (public catalog of bank products)
-- No user_id column. SELECT is PUBLIC (anyone can read the catalog).
-- No write policies => writes are service-role-only (admin maintenance).
-- =====================================================================
alter table public.bank_accounts enable row level security;

drop policy if exists bank_accounts_select_public on public.bank_accounts;
create policy bank_accounts_select_public
on public.bank_accounts
for select
using (true);
