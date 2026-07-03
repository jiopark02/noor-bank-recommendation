begin;

create extension if not exists pgcrypto;

create table if not exists public.waitlist_signups (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null,
  name       text,
  source     text        not null default 'waitlist_page',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),

  constraint waitlist_signups_email_unique unique (email),
  constraint waitlist_signups_email_format check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$')
);

create index if not exists idx_waitlist_signups_email
  on public.waitlist_signups (email);

create index if not exists idx_waitlist_signups_created_at
  on public.waitlist_signups (created_at desc);

alter table public.waitlist_signups enable row level security;

comment on table public.waitlist_signups is
  'Waitlist email captures. Written by /api/waitlist (service role only). '
  'No approval flow — added immediately, notified at launch.';

commit;
