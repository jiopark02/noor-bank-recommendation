-- Migration: create cron_runs table for cron job monitoring
-- Date: 2026-05-30
-- Purpose: Record each cron execution (summarize / extract-facts) so we can
--          monitor health, detect silent failures, and surface stats in an
--          admin view. This is a SYSTEM operations log, NOT user data — it has
--          no user_id and is not accessible to regular users.
--
-- Recording model (B, simple): one row inserted when a cron run FINISHES.
-- Cron-down detection is inferred from "last finished_at is too old" rather
-- than tracking a 'running' state.
--
-- Retention: rows older than 180 days are deleted at the end of the
-- extract-facts cron run (isolated, best-effort — see cron route code).

begin;

-- gen_random_uuid() lives in pgcrypto. Already used by 20260518 memory tables;
-- declared here defensively (IF NOT EXISTS = harmless if already present).
create extension if not exists pgcrypto;

create table if not exists public.cron_runs (
  id               uuid primary key default gen_random_uuid(),
  job_name         text        not null,            -- 'summarize' | 'extract-facts'
  status           text        not null,            -- 'success' | 'partial' | 'failed'
  started_at       timestamptz not null,
  finished_at      timestamptz not null,
  duration_ms      integer,
  items_processed  integer     not null default 0,  -- sessions handled this run
  items_failed     integer     not null default 0,  -- of those, how many failed
  stats            jsonb,                            -- full per-run result payload
  error            text,
  created_at       timestamptz not null default now(),

  -- Guard rails: keep the small set of allowed values honest.
  constraint cron_runs_job_name_check
    check (job_name in ('summarize', 'extract-facts')),
  constraint cron_runs_status_check
    check (status in ('success', 'partial', 'failed'))
);

-- Index for "recent runs" queries (admin view) and for the retention DELETE.
create index if not exists idx_cron_runs_created_at
  on public.cron_runs (created_at desc);

-- Index for per-job "last run" lookups (e.g. last summarize finished_at).
create index if not exists idx_cron_runs_job_finished
  on public.cron_runs (job_name, finished_at desc);

-- Enable RLS. We intentionally create NO policies for regular users:
-- with RLS on and no permissive policy, normal (anon/authenticated) access is
-- denied by default. The cron routes and the admin view use the service-role
-- key (via createAdminClient), which BYPASSES RLS. So service role can
-- read/write freely; everyone else is blocked. This keeps ops data invisible
-- to end users.
alter table public.cron_runs enable row level security;

comment on table public.cron_runs is
  'System operations log: one row per cron run (summarize / extract-facts). Not user data; service-role access only.';

commit;
