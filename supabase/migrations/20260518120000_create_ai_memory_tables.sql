-- =============================================================================
-- AI Memory Tables for Noor AI 3-Layer Memory System
--
-- Creates four tables to enable persistent conversation memory across sessions:
--   1) chat_sessions   - groups messages into conversation sessions
--   2) chat_messages   - stores every user/assistant message (raw)
--   3) user_facts      - Layer 2: extracted facts about the user (semi-permanent)
--   4) chat_summaries  - Layer 3: compressed summaries per session
--
-- Layer 1 (survey_responses) already exists from a previous migration.
--
-- Author: NOOR Tech Team
-- Date:   2026-05-18
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) chat_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text,                            -- auto-generated short title (optional)
  started_at timestamptz not null default now(),
  ended_at timestamptz,                  -- null = active session
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0,
  summarized boolean not null default false,  -- true once chat_summaries has a row
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_user_id
  on public.chat_sessions(user_id);

create index if not exists idx_chat_sessions_user_active
  on public.chat_sessions(user_id, last_message_at desc)
  where ended_at is null;

create index if not exists idx_chat_sessions_needs_summary
  on public.chat_sessions(user_id, ended_at)
  where summarized = false and ended_at is not null;

-- ---------------------------------------------------------------------------
-- 2) chat_messages
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  model text,                            -- which model produced this (assistant only)
  input_tokens integer,                  -- usage tracking
  output_tokens integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session
  on public.chat_messages(session_id, created_at);

create index if not exists idx_chat_messages_user
  on public.chat_messages(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3) user_facts (Layer 2)
-- ---------------------------------------------------------------------------
create table if not exists public.user_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null,                -- 'financial' | 'personal' | 'goal' | 'preference' | 'visa' | 'banking' | 'other'
  fact text not null,                    -- English, concise statement
  confidence numeric not null default 1.0 check (confidence >= 0 and confidence <= 1),
  source_message_id uuid references public.chat_messages(id) on delete set null,
  source_session_id uuid references public.chat_sessions(id) on delete set null,
  extracted_by_model text,               -- e.g. 'gemini-2.0-flash-lite'
  status text not null default 'active' check (status in ('active', 'expired', 'superseded')),
  superseded_by uuid references public.user_facts(id) on delete set null,
  expires_at timestamptz,                -- null = no expiry
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent exact duplicate active facts per user (case-insensitive)
create unique index if not exists ux_user_facts_user_active_fact
  on public.user_facts(user_id, lower(fact))
  where status = 'active';

create index if not exists idx_user_facts_user_active
  on public.user_facts(user_id, category, created_at desc)
  where status = 'active';

create index if not exists idx_user_facts_user_recent
  on public.user_facts(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4) chat_summaries (Layer 3)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  summary text not null,
  topics text[] not null default '{}',   -- e.g. ['chase', 'student_account', 'itin']
  message_count integer not null default 0,
  generated_by_model text,               -- which model generated this
  raw_backup text,                       -- fallback raw messages if summarization failed (TODO #8)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_summaries_user_recent
  on public.chat_summaries(user_id, created_at desc);

create index if not exists idx_chat_summaries_topics
  on public.chat_summaries using gin(topics);

-- ---------------------------------------------------------------------------
-- 5) Updated_at triggers (reuse existing helper function)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_chat_sessions_updated_at on public.chat_sessions;
create trigger trg_chat_sessions_updated_at
before update on public.chat_sessions
for each row execute function public.set_current_timestamp_updated_at();

drop trigger if exists trg_user_facts_updated_at on public.user_facts;
create trigger trg_user_facts_updated_at
before update on public.user_facts
for each row execute function public.set_current_timestamp_updated_at();

drop trigger if exists trg_chat_summaries_updated_at on public.chat_summaries;
create trigger trg_chat_summaries_updated_at
before update on public.chat_summaries
for each row execute function public.set_current_timestamp_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Maintain chat_sessions counters when chat_messages changes
-- ---------------------------------------------------------------------------
create or replace function public.bump_chat_session_on_message()
returns trigger
language plpgsql
as $$
begin
  update public.chat_sessions
  set
    message_count = message_count + 1,
    last_message_at = new.created_at
  where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_bump_session on public.chat_messages;
create trigger trg_chat_messages_bump_session
after insert on public.chat_messages
for each row execute function public.bump_chat_session_on_message();

-- ---------------------------------------------------------------------------
-- 7) Row Level Security (matches existing pattern from survey_responses)
-- ---------------------------------------------------------------------------
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.user_facts enable row level security;
alter table public.chat_summaries enable row level security;

-- chat_sessions policies
drop policy if exists chat_sessions_select_own on public.chat_sessions;
create policy chat_sessions_select_own
on public.chat_sessions for select
using (auth.uid() = user_id);

drop policy if exists chat_sessions_insert_own on public.chat_sessions;
create policy chat_sessions_insert_own
on public.chat_sessions for insert
with check (auth.uid() = user_id);

drop policy if exists chat_sessions_update_own on public.chat_sessions;
create policy chat_sessions_update_own
on public.chat_sessions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists chat_sessions_delete_own on public.chat_sessions;
create policy chat_sessions_delete_own
on public.chat_sessions for delete
using (auth.uid() = user_id);

-- chat_messages policies
drop policy if exists chat_messages_select_own on public.chat_messages;
create policy chat_messages_select_own
on public.chat_messages for select
using (auth.uid() = user_id);

drop policy if exists chat_messages_insert_own on public.chat_messages;
create policy chat_messages_insert_own
on public.chat_messages for insert
with check (auth.uid() = user_id);

drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own
on public.chat_messages for delete
using (auth.uid() = user_id);

-- user_facts policies
drop policy if exists user_facts_select_own on public.user_facts;
create policy user_facts_select_own
on public.user_facts for select
using (auth.uid() = user_id);

drop policy if exists user_facts_insert_own on public.user_facts;
create policy user_facts_insert_own
on public.user_facts for insert
with check (auth.uid() = user_id);

drop policy if exists user_facts_update_own on public.user_facts;
create policy user_facts_update_own
on public.user_facts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_facts_delete_own on public.user_facts;
create policy user_facts_delete_own
on public.user_facts for delete
using (auth.uid() = user_id);

-- chat_summaries policies
drop policy if exists chat_summaries_select_own on public.chat_summaries;
create policy chat_summaries_select_own
on public.chat_summaries for select
using (auth.uid() = user_id);

drop policy if exists chat_summaries_insert_own on public.chat_summaries;
create policy chat_summaries_insert_own
on public.chat_summaries for insert
with check (auth.uid() = user_id);

drop policy if exists chat_summaries_update_own on public.chat_summaries;
create policy chat_summaries_update_own
on public.chat_summaries for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists chat_summaries_delete_own on public.chat_summaries;
create policy chat_summaries_delete_own
on public.chat_summaries for delete
using (auth.uid() = user_id);

COMMIT;
