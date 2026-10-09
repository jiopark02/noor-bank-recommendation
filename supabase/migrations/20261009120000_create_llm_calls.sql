-- Migration: create llm_calls, one row per LLM call attempt
-- Date: 2026-10-09
--
-- Purpose: record every attempt the application makes to call an LLM through
-- OpenRouter, so cost, latency, failure rate and model drift can be measured
-- per route and per user. Three call sites write here: the chat route's model
-- attempt loop (one row per model tried) and the two memory crons
-- (summarize, extract-facts).
--
-- What a row never holds: conversation text, prompt text, the provider's error
-- message, or any of the user's financial amounts. Errors are kept as the HTTP
-- status plus a classification the application chooses (error_class).
-- provider_cost is what the provider charged for the call, as reported by
-- OpenRouter usage.cost; it is not a user's money.
--
-- Access: service role only, the same shape as admin_users and cron_runs.
-- RLS is on with no policies, and every privilege is revoked from anon and
-- authenticated. The DO block at the end checks the end state by property and
-- rolls the whole file back unless all of these hold: neither anon nor
-- authenticated holds any table privilege (REFERENCES and TRIGGER included),
-- RLS is on, no policy exists, every CHECK constraint named below exists (so a
-- pre-existing table of another shape, which `create table if not exists`
-- would silently keep, is caught), and service_role can INSERT and SELECT.
-- This file grants nothing; if service_role lacks either privilege, the file
-- stops here rather than leaving every insert to fail with 42501.
--
-- Deletion: user_id cascades from public.users, so account deletion removes a
-- user's rows with the rest of their data. session_id is set to NULL when a
-- chat session row is deleted on its own. There is no time-based retention.
--
-- To reverse it (after the application code that writes here is reverted and
-- deployed):
--   drop table if exists public.llm_calls;

begin;

set local lock_timeout = '5s';

create extension if not exists pgcrypto;

create table if not exists public.llm_calls (
  id                            uuid primary key default gen_random_uuid(),
  created_at                    timestamptz not null default now(),
  started_at                    timestamptz not null,
  route                         text        not null,
  attempt_index                 smallint    not null,
  request_model                 text        not null,
  response_model                text,
  generation_id                 text,
  succeeded                     boolean     not null,
  http_status                   smallint,
  error_class                   text,
  finish_reason                 text,
  latency_ms                    integer     not null,
  prompt_tokens                 integer,
  completion_tokens             integer,
  cached_tokens                 integer,
  reasoning_tokens              integer,
  provider_cost                 numeric(14, 8),
  has_memory_block              boolean,
  has_plaid_scaffold_block      boolean,
  has_balance_block             boolean,
  has_financial_snapshot_block  boolean,
  engine_reason_code            text,
  user_id                       uuid not null
                                  references public.users(id) on delete cascade,
  session_id                    uuid
                                  references public.chat_sessions(id) on delete set null,

  constraint llm_calls_route_check
    check (route in ('chat', 'cron_summarize', 'cron_extract_facts')),
  constraint llm_calls_attempt_index_check
    check (attempt_index >= 1),
  constraint llm_calls_request_model_length_check
    check (char_length(request_model) <= 200),
  constraint llm_calls_response_model_length_check
    check (response_model is null or char_length(response_model) <= 200),
  constraint llm_calls_generation_id_length_check
    check (generation_id is null or char_length(generation_id) <= 200),
  constraint llm_calls_http_status_check
    check (http_status is null or http_status between 100 and 599),
  constraint llm_calls_error_class_check
    check (error_class is null or error_class in (
      'empty_content', 'invalid_json', 'auth', 'insufficient_credits',
      'rate_limited', 'client_error', 'provider_error', 'network_error',
      'unknown'
    )),
  constraint llm_calls_failure_has_class_check
    check (succeeded or error_class is not null),
  constraint llm_calls_finish_reason_check
    check (finish_reason is null or finish_reason ~ '^[a-z_]{1,32}$'),
  constraint llm_calls_latency_check
    check (latency_ms >= 0),
  constraint llm_calls_tokens_check
    check (
      (prompt_tokens is null or prompt_tokens >= 0) and
      (completion_tokens is null or completion_tokens >= 0) and
      (cached_tokens is null or cached_tokens >= 0) and
      (reasoning_tokens is null or reasoning_tokens >= 0)
    ),
  constraint llm_calls_provider_cost_check
    check (provider_cost is null or provider_cost >= 0),
  constraint llm_calls_engine_reason_code_check
    check (engine_reason_code is null or engine_reason_code ~ '^[a-z0-9_]{1,64}$'),
  constraint llm_calls_block_flags_chat_only_check
    check (
      route = 'chat' or (
        has_memory_block is null and
        has_plaid_scaffold_block is null and
        has_balance_block is null and
        has_financial_snapshot_block is null
      )
    )
);

-- Per-user reads, and keeps the ON DELETE CASCADE from public.users off a
-- sequential scan.
create index if not exists idx_llm_calls_user_created
  on public.llm_calls (user_id, created_at desc);

create index if not exists idx_llm_calls_created
  on public.llm_calls (created_at desc);

-- Keeps ON DELETE SET NULL from chat_sessions off a sequential scan.
create index if not exists idx_llm_calls_session
  on public.llm_calls (session_id)
  where session_id is not null;

revoke all on table public.llm_calls from anon;
revoke all on table public.llm_calls from authenticated;

alter table public.llm_calls enable row level security;

comment on table public.llm_calls is
  'One row per LLM call attempt (chat model loop, summarize cron, extract-facts '
  'cron). No conversation or prompt text, no provider error text, no user '
  'financial amounts. Service-role-only (RLS on, no policies).';
comment on column public.llm_calls.provider_cost is
  'As reported by OpenRouter usage.cost.';
comment on column public.llm_calls.engine_reason_code is
  'Reserved for recommendation-engine reason codes. Nothing writes it yet.';
comment on column public.llm_calls.succeeded is
  'True when the route accepted the provider response as its reply. For chat '
  'this includes a 2xx whose body was not JSON or whose content was empty (the '
  'user receives the fallback text). A real success is error_class IS NULL.';
comment on column public.llm_calls.error_class is
  'Application-chosen classification, never provider text. invalid_json: the '
  'body did not parse as JSON; on cron rows it also covers a connection '
  'dropped while the body was being read.';
comment on column public.llm_calls.has_balance_block is
  'True only when the Verified Balance Snapshot block was attached to the '
  'system prompt; the no-snapshot fallback sentence does not count. NULL on '
  'cron rows.';
comment on column public.llm_calls.has_plaid_scaffold_block is
  'True when the Plaid capability block was attached, including the '
  'unknown-state fallback block used when the Plaid state read failed. NULL on '
  'cron rows.';

do $$
declare
  v_table regclass := 'public.llm_calls'::regclass;
  v_expected_checks text[] := array[
    'llm_calls_route_check',
    'llm_calls_attempt_index_check',
    'llm_calls_request_model_length_check',
    'llm_calls_response_model_length_check',
    'llm_calls_generation_id_length_check',
    'llm_calls_http_status_check',
    'llm_calls_error_class_check',
    'llm_calls_failure_has_class_check',
    'llm_calls_finish_reason_check',
    'llm_calls_latency_check',
    'llm_calls_tokens_check',
    'llm_calls_provider_cost_check',
    'llm_calls_engine_reason_code_check',
    'llm_calls_block_flags_chat_only_check'
  ];
  v_remaining text;
  v_rls boolean;
  v_policies integer;
  v_missing text[];
begin
  select string_agg(format('%s %s', r.role_name, p.privilege), ', ')
    into v_remaining
    from unnest(array['anon', 'authenticated']) as r(role_name)
   cross join unnest(array[
           'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
           'TRIGGER'
         ]) as p(privilege)
   where has_table_privilege(r.role_name, v_table, p.privilege);

  if v_remaining is not null then
    raise exception
      'llm_calls: client roles still hold privileges after revoke: %',
      v_remaining;
  end if;

  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_table;
  if v_rls is distinct from true then
    raise exception 'llm_calls: row level security is not enabled';
  end if;

  select count(*) into v_policies
    from pg_policies
   where schemaname = 'public' and tablename = 'llm_calls';
  if v_policies <> 0 then
    raise exception 'llm_calls: expected no policies, found %', v_policies;
  end if;

  v_missing := array(
    select unnest(v_expected_checks)
    except
    select conname::text
      from pg_constraint
     where conrelid = v_table and contype = 'c'
  );
  if cardinality(v_missing) > 0 then
    raise exception
      'llm_calls: expected CHECK constraints are missing (the table may predate this file): %',
      array_to_string(v_missing, ', ');
  end if;

  if not has_table_privilege('service_role', v_table, 'INSERT')
     or not has_table_privilege('service_role', v_table, 'SELECT') then
    raise exception
      'llm_calls: service_role lacks INSERT or SELECT; this file grants nothing';
  end if;
end
$$;

commit;
