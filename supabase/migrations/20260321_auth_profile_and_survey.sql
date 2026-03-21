-- Auth + profile + survey integration for Noor
-- Ensures auth.users signup also mirrors into public.users.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key,
  email text not null,
  first_name text not null,
  last_name text,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  country_of_origin text,
  destination_country text,
  institution_id text,
  institution_type text,
  university text,
  academic_level text,
  year_in_program integer,
  major text,
  gpa numeric,
  student_level text,
  has_ssn boolean,
  has_itin boolean,
  has_nin boolean,
  has_sin boolean,
  has_us_credit_history boolean,
  has_us_address boolean,
  monthly_income numeric,
  expected_monthly_spending numeric,
  fee_sensitivity text,
  monthly_budget numeric,
  primary_banking_needs text[],
  digital_preference text,
  international_transfer_frequency text,
  avg_transfer_amount numeric,
  needs_nearby_branch boolean,
  needs_zelle boolean,
  prefers_online_banking boolean,
  preferred_bank_type text,
  campus_proximity text,
  campus_side text,
  primary_goals text[],
  credit_goals text,
  preferred_language text,
  onboarding_completed boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_current_timestamp_updated_at();

drop trigger if exists trg_survey_responses_updated_at on public.survey_responses;
create trigger trg_survey_responses_updated_at
before update on public.survey_responses
for each row execute function public.set_current_timestamp_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
begin
  v_first_name := coalesce(
    new.raw_user_meta_data ->> 'first_name',
    split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1),
    'User'
  );

  v_last_name := nullif(
    coalesce(
      new.raw_user_meta_data ->> 'last_name',
      regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '^\S+\s*', '')
    ),
    ''
  );

  insert into public.users (id, email, first_name, last_name, raw_user_meta_data, created_at, updated_at)
  values (new.id, new.email, v_first_name, v_last_name, new.raw_user_meta_data, now(), now())
  on conflict (id) do update
  set
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.users enable row level security;
alter table public.survey_responses enable row level security;

drop policy if exists users_select_own on public.users;
create policy users_select_own
on public.users
for select
using (auth.uid() = id);

drop policy if exists users_update_own on public.users;
create policy users_update_own
on public.users
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists survey_select_own on public.survey_responses;
create policy survey_select_own
on public.survey_responses
for select
using (auth.uid() = user_id);

drop policy if exists survey_insert_own on public.survey_responses;
create policy survey_insert_own
on public.survey_responses
for insert
with check (auth.uid() = user_id);

drop policy if exists survey_update_own on public.survey_responses;
create policy survey_update_own
on public.survey_responses
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
