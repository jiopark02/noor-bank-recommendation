-- Migration: enable RLS on public catalog/forum tables, drop a dead table
--
-- Context: Supabase Security Advisor flagged 7 public tables with RLS disabled
-- and full anon privileges (SELECT/INSERT/UPDATE/DELETE/TRUNCATE) — anyone with
-- the project URL could read or mutate them. Same exposure class as the saved_*
-- tables dropped in 20260604120000; this is the second RLS pass, covering the
-- catalog/reference and forum tables outside the first pass's scope.
--
-- Per table:
--   credit_cards, deals, jobs, universities, visa_types -> public read catalog:
--     RLS ON + public SELECT, no write policy (writes only via service-role /
--     admin routes, which bypass RLS).
--   comments -> user-owned forum data (paired with posts, secured in
--     20260604120000): RLS ON + public SELECT + self-row INSERT/UPDATE/DELETE.
--   bank_university_locations -> dead table superseded by bank_branches, zero
--     code refs, no inbound FKs (verified): DROP.
--
-- All policies use drop-if-exists + create for idempotency and to stay clear of
-- the identically-named "Public read access for visa_types" policy defined in
-- 20250129_country_specific_data.sql (not applied on remote, but defended anyway).

-- ── 1. Public read catalogs ──────────────────────────────────────────────
alter table public.credit_cards enable row level security;
drop policy if exists "Public read access for credit_cards" on public.credit_cards;
create policy "Public read access for credit_cards"
  on public.credit_cards for select using (true);

alter table public.deals enable row level security;
drop policy if exists "Public read access for deals" on public.deals;
create policy "Public read access for deals"
  on public.deals for select using (true);

alter table public.jobs enable row level security;
drop policy if exists "Public read access for jobs" on public.jobs;
create policy "Public read access for jobs"
  on public.jobs for select using (true);

alter table public.universities enable row level security;
drop policy if exists "Public read access for universities" on public.universities;
create policy "Public read access for universities"
  on public.universities for select using (true);

alter table public.visa_types enable row level security;
drop policy if exists "Public read access for visa_types" on public.visa_types;
create policy "Public read access for visa_types"
  on public.visa_types for select using (true);

-- ── 2. Forum comments (user-owned, paired with posts) ────────────────────
-- user_id is uuid (FK to users.id) -> auth.uid() compares directly, no cast.
alter table public.comments enable row level security;

drop policy if exists "Public read access for comments" on public.comments;
create policy "Public read access for comments"
  on public.comments for select using (true);

drop policy if exists "Users can insert their own comments" on public.comments;
create policy "Users can insert their own comments"
  on public.comments for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own comments" on public.comments;
create policy "Users can update their own comments"
  on public.comments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own comments" on public.comments;
create policy "Users can delete their own comments"
  on public.comments for delete using (auth.uid() = user_id);

-- ── 3. Drop dead table ───────────────────────────────────────────────────
drop table if exists public.bank_university_locations cascade;
