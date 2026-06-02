-- Migration: replace users.is_admin with a service-role-only admin_users table
-- Date: 2026-05-31
-- Background: The earlier approach (users.is_admin column + REVOKE + RLS WITH
-- CHECK) was tested against the authenticated role and FAILED — a normal user
-- could still self-promote (rows_changed: 1, became_admin: true). Root cause:
-- `users` is a table that users must access (their own profile row), and on
-- Supabase the table-level UPDATE grant to `authenticated` overrode the
-- column-level REVOKE; the RLS WITH CHECK did not block it either in testing.
--
-- Fix: don't keep the admin flag on a user-accessible table at all. Use a
-- separate `admin_users` table with RLS ON and NO policies → only the service
-- role can read/write it (same proven pattern as cron_runs). Users cannot read
-- or write it, so self-promotion is structurally impossible.
--
-- Admin designation (manual, service role only, via SQL Editor):
--   insert into public.admin_users (user_id)
--   select id from public.users where email = '...'
--   on conflict do nothing;

begin;

-- ---------------------------------------------------------------------------
-- 1. Roll back the previous is_admin approach.
-- ---------------------------------------------------------------------------

-- Restore users_update_own to its original form (drop the is_admin guard).
-- Original (20260321): plain self-row update, no column guard.
drop policy if exists users_update_own on public.users;
create policy users_update_own
on public.users
for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- Drop the column (CASCADE not needed; nothing references it).
alter table public.users
  drop column if exists is_admin;

-- (The REVOKEs on users.is_admin disappear automatically with the column.)

-- ---------------------------------------------------------------------------
-- 2. New approach: admin_users (service-role-only, same pattern as cron_runs).
-- ---------------------------------------------------------------------------

create table if not exists public.admin_users (
  user_id    uuid primary key references public.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

-- Belt-and-suspenders: even if RLS were ever accidentally disabled, deny the
-- authenticated/anon roles any direct privilege on this table. Service role
-- bypasses this. (RLS-on + no-policy already denies; this is a second layer.)
revoke all on table public.admin_users from authenticated;
revoke all on table public.admin_users from anon;

-- Enable RLS with NO policies. authenticated/anon are denied by default;
-- only the service role (which bypasses RLS) can read/write. Users can neither
-- see who is an admin nor make themselves one.
alter table public.admin_users enable row level security;

comment on table public.admin_users is
  'Admin allowlist by user account. Service-role-only (RLS on, no policies). '
  'There is NO app/PostgREST path to read or write this — admins are added '
  'manually via SQL Editor. requireAdmin checks membership using the service role.';

commit;
