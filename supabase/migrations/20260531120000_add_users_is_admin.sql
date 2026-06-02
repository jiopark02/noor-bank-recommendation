-- Migration: add is_admin to users with self-escalation protection
-- Date: 2026-05-31
-- Purpose: Admin authorization is keyed on the user ACCOUNT (users.is_admin),
--          not an email string — so admin status cannot be "pre-registered"
--          (squatted) by signing up with an admin email.
--
-- CRITICAL SECURITY: the existing `users_update_own` RLS policy lets a user
-- UPDATE their own row with NO column restriction. Adding is_admin naively
-- would let any logged-in user run
--     update users set is_admin = true where id = <self>
-- and self-promote. We defend in depth (multiple independent layers):
--   (1) REVOKE UPDATE(is_admin) from authenticated  — column-level grant
--   (2) RLS WITH CHECK that is_admin is unchanged    — policy-level guard
-- is_admin can therefore only be set via the service role (Supabase SQL
-- Editor), i.e. by whoever has direct DB access. There is NO app path to
-- change it. Admins are designated manually:
--     update public.users set is_admin = true where email = '...';

begin;

-- 1. Column. NOT NULL default false → every existing/new user starts non-admin.
alter table public.users
  add column if not exists is_admin boolean not null default false;

-- 2. Defense layer A — column-level privilege.
--    authenticated role loses the ability to UPDATE is_admin at all.
--    (Other columns remain updatable under users_update_own.)
--    service role is not affected (it bypasses grants/RLS).
revoke update (is_admin) on public.users from authenticated;
-- anon should never update users anyway, but be explicit/defensive.
revoke update (is_admin) on public.users from anon;

-- 3. Defense layer B — RLS WITH CHECK guard.
--    Recreate users_update_own so that an UPDATE is rejected if it would
--    change is_admin away from its current stored value. Even if layer A were
--    somehow bypassed, this blocks self-promotion. Non-is_admin updates
--    (e.g. language) still pass because is_admin stays equal to itself.
drop policy if exists users_update_own on public.users;
create policy users_update_own
on public.users
for update
using (auth.uid() = id)
with check (
  auth.uid() = id
  and is_admin is not distinct from (
    select u.is_admin from public.users u where u.id = auth.uid()
  )
);

-- NOTE on SELECT: users_select_own is left as-is. A user CAN read their own
-- is_admin value, which is harmless (knowing you are/aren't an admin is not
-- the same as becoming one). requireAdmin reads is_admin server-side via the
-- service role, never trusting the client.

-- Operational documentation: how is_admin is meant to be managed.
comment on column public.users.is_admin is
  'Admin flag. Changeable ONLY via service role (Supabase SQL Editor) or a controlled migration. No app/PostgREST path may set it; authenticated/anon are REVOKEd from updating this column and an RLS WITH CHECK guards it.';

commit;
