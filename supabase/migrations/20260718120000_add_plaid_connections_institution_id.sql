-- Add institution_id to plaid_connections for app-level duplicate detection
-- (same user re-linking a bank they already have).
--
-- Nullable, no backfill: existing rows stay NULL and new connections populate
-- it going forward. Duplicate detection therefore only works between rows that
-- both have institution_id (i.e. connections created after this ships) — an
-- accepted limitation (see docs/design/connection-management.md §3, §5).
--
-- Deliberately NO unique index here. A partial unique index on
-- (user_id, institution_id) WHERE status='active' is a follow-up that can only
-- run AFTER existing duplicate rows are cleaned up, or index creation fails on
-- the existing duplicates (see design §9 roadmap, §10 cleanup). It must also not
-- assume institution_id is a uniformly trusted value (server itemGet vs client
-- fallback vs NULL for pre-ship rows — see design §3.2).
--
-- RLS is untouched: policies are column-agnostic (owner-only by user_id), so
-- adding a column needs no policy change.
alter table public.plaid_connections
  add column if not exists institution_id text;
