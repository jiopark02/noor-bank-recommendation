-- Retry and give-up state for the two memory crons, on public.chat_sessions.
--
-- What this file adds, for each cron (prefix summary_ for the summarize cron,
-- facts_ for the extract-facts cron), these columns:
--   - <p>_failures: smallint, not null, default 0, never negative.
--   - <p>_next_attempt_at: timestamptz, null allowed.
--   - <p>_outcome: text, null, 'done' or 'given_up'.
--   - <p>_given_up_reason: text, null, 'output_unusable' or 'input_rejected'.
--   - <p>_given_up_at: timestamptz, null allowed.
-- and, for each cron, these named checks:
--   - chat_sessions_<p>_failures_check: <p>_failures >= 0.
--   - chat_sessions_<p>_outcome_check: only the outcome values above.
--   - chat_sessions_<p>_given_up_reason_check: only the reason values above.
--   - chat_sessions_<p>_given_up_pair_check: <p>_outcome is 'given_up'
--     exactly when <p>_given_up_reason is set, and <p>_given_up_reason is set
--     exactly when <p>_given_up_at is set. A given-up session always carries
--     its reason and time; no other session carries either.
--
-- Why: both crons give up on a session after a fixed number of answered
-- attempts (src/lib/cronRetryBound.ts) by setting the same completion flag a
-- finished session gets, so a given-up session cannot be told apart from a
-- finished one and the only record of the give-up is a log line. These
-- columns give each cron a place to record its failures, when it may try
-- again, how it ended and why it gave up. No application code writes them
-- yet; src/lib/accountExport.ts exports them.
--
-- Existing rows are not filled in. Once this file is applied they read
-- <p>_failures = 0 and null in every other column it adds. A session given up
-- before this file was applied has its completion flag set and a null
-- <p>_outcome, exactly like a session that finished normally. The two cannot
-- be told apart from these columns, and nothing in this file tries to.
--
-- What this file does not change: it writes no row and adds or changes no
-- index, policy, grant, trigger or comment. The meaning of summarized and
-- facts_extracted is unchanged: true means the cron is finished with the
-- session (processed, empty, withheld by the crisis gate, or given up), not
-- that a summary or fact row exists. Where
-- 20261017120000_restrict_client_writes_on_chat_tables.sql is applied,
-- authenticated holds SELECT on the whole table, which covers the columns
-- this file adds, so a signed-in user reads them on their own rows through
-- the API as they read the others.
--
-- Locks: the alter takes ACCESS EXCLUSIVE on chat_sessions and holds it to
-- commit. Every column it adds has a constant default or none, so on
-- PostgreSQL 11 or later no row is rewritten; adding the checks reads the
-- table once to validate them. Inserts into chat_messages (whose trigger
-- updates the session row), session creation and the crons wait meanwhile.
-- lock_timeout bounds the wait for the lock, and a wait that runs out rolls
-- the whole file back.
--
-- Deploy order: apply this file to a database before deploying code that
-- selects these columns (src/lib/accountExport.ts) against it. Deployed
-- first, that code makes every account export from that database fail.
--
-- Whether this file has been applied to a given database is live state; read
-- that database's columns and constraints rather than inferring them from
-- this file.
--
-- Running this file again where it is applied fails at the alter: the
-- columns already exist (42701). The transaction rolls back with nothing
-- changed. After the reversal below, the file applies again.
--
-- The end state is checked by property. The DO block raises, and the whole
-- file rolls back, unless:
--   - each column this file adds exists with its type; only the <p>_failures
--     columns are not null, and only they have a default, 0;
--   - each check named above exists, is validated, and has the expected
--     definition;
--   - chat_sessions has no policy other than chat_sessions_select_own for
--     SELECT, anon holds no privilege on it, and authenticated holds no write
--     privilege on it, at table level or on any column.
-- If the check fails, look at what else changed the table; do not widen this
-- file to make it pass.
--
-- To reverse it. Drop the columns only after no deployed code selects them
-- (src/lib/accountExport.ts names them):
--   begin;
--   alter table public.chat_sessions
--     drop constraint chat_sessions_summary_failures_check,
--     drop constraint chat_sessions_summary_outcome_check,
--     drop constraint chat_sessions_summary_given_up_reason_check,
--     drop constraint chat_sessions_summary_given_up_pair_check,
--     drop constraint chat_sessions_facts_failures_check,
--     drop constraint chat_sessions_facts_outcome_check,
--     drop constraint chat_sessions_facts_given_up_reason_check,
--     drop constraint chat_sessions_facts_given_up_pair_check,
--     drop column summary_failures,
--     drop column summary_next_attempt_at,
--     drop column summary_outcome,
--     drop column summary_given_up_reason,
--     drop column summary_given_up_at,
--     drop column facts_failures,
--     drop column facts_next_attempt_at,
--     drop column facts_outcome,
--     drop column facts_given_up_reason,
--     drop column facts_given_up_at;
--   commit;

begin;

set local lock_timeout = '5s';

alter table public.chat_sessions
  add column summary_failures smallint not null default 0,
  add column summary_next_attempt_at timestamptz,
  add column summary_outcome text,
  add column summary_given_up_reason text,
  add column summary_given_up_at timestamptz,
  add column facts_failures smallint not null default 0,
  add column facts_next_attempt_at timestamptz,
  add column facts_outcome text,
  add column facts_given_up_reason text,
  add column facts_given_up_at timestamptz,
  add constraint chat_sessions_summary_failures_check
    check (summary_failures >= 0),
  add constraint chat_sessions_summary_outcome_check
    check (summary_outcome in ('done', 'given_up')),
  add constraint chat_sessions_summary_given_up_reason_check
    check (summary_given_up_reason in ('output_unusable', 'input_rejected')),
  add constraint chat_sessions_summary_given_up_pair_check
    check (
      (summary_outcome is not distinct from 'given_up') = (summary_given_up_reason is not null)
      and (summary_given_up_reason is null) = (summary_given_up_at is null)
    ),
  add constraint chat_sessions_facts_failures_check
    check (facts_failures >= 0),
  add constraint chat_sessions_facts_outcome_check
    check (facts_outcome in ('done', 'given_up')),
  add constraint chat_sessions_facts_given_up_reason_check
    check (facts_given_up_reason in ('output_unusable', 'input_rejected')),
  add constraint chat_sessions_facts_given_up_pair_check
    check (
      (facts_outcome is not distinct from 'given_up') = (facts_given_up_reason is not null)
      and (facts_given_up_reason is null) = (facts_given_up_at is null)
    );

do $$
declare
  v_table regclass := 'public.chat_sessions'::regclass;
  -- One entry per added column: its name, its type as format_type prints it,
  -- whether it is not null, and its default as pg_get_expr prints it (null
  -- for none).
  v_columns text[] := array[
    'summary_failures',
    'summary_next_attempt_at',
    'summary_outcome',
    'summary_given_up_reason',
    'summary_given_up_at',
    'facts_failures',
    'facts_next_attempt_at',
    'facts_outcome',
    'facts_given_up_reason',
    'facts_given_up_at'
  ];
  v_types text[] := array[
    'smallint',
    'timestamp with time zone',
    'text',
    'text',
    'timestamp with time zone',
    'smallint',
    'timestamp with time zone',
    'text',
    'text',
    'timestamp with time zone'
  ];
  v_not_null boolean[] := array[
    true, false, false, false, false,
    true, false, false, false, false
  ];
  v_defaults text[] := array[
    '0', null, null, null, null,
    '0', null, null, null, null
  ];
  -- One entry per added check: its name and its definition as
  -- pg_get_constraintdef prints it.
  v_checks text[] := array[
    'chat_sessions_summary_failures_check',
    'chat_sessions_summary_outcome_check',
    'chat_sessions_summary_given_up_reason_check',
    'chat_sessions_summary_given_up_pair_check',
    'chat_sessions_facts_failures_check',
    'chat_sessions_facts_outcome_check',
    'chat_sessions_facts_given_up_reason_check',
    'chat_sessions_facts_given_up_pair_check'
  ];
  v_definitions text[] := array[
    'CHECK ((summary_failures >= 0))',
    'CHECK ((summary_outcome = ANY (ARRAY[''done''::text, ''given_up''::text])))',
    'CHECK ((summary_given_up_reason = ANY (ARRAY[''output_unusable''::text, ''input_rejected''::text])))',
    'CHECK ((((NOT (summary_outcome IS DISTINCT FROM ''given_up''::text)) = (summary_given_up_reason IS NOT NULL)) AND ((summary_given_up_reason IS NULL) = (summary_given_up_at IS NULL))))',
    'CHECK ((facts_failures >= 0))',
    'CHECK ((facts_outcome = ANY (ARRAY[''done''::text, ''given_up''::text])))',
    'CHECK ((facts_given_up_reason = ANY (ARRAY[''output_unusable''::text, ''input_rejected''::text])))',
    'CHECK ((((NOT (facts_outcome IS DISTINCT FROM ''given_up''::text)) = (facts_given_up_reason IS NOT NULL)) AND ((facts_given_up_reason IS NULL) = (facts_given_up_at IS NULL))))'
  ];
  v_denied text[] := array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  v_all text[];
  v_i integer;
  v_type text;
  v_notnull boolean;
  v_default text;
  v_definition text;
  v_validated boolean;
  v_found text;
begin
  -- MAINTAIN exists from PostgreSQL 17; naming it on an earlier server is an
  -- error, so it is checked only where it exists.
  if current_setting('server_version_num')::integer >= 170000 then
    v_denied := array_append(v_denied, 'MAINTAIN');
  end if;
  v_all := array_prepend('SELECT', v_denied);

  -- 1. Each added column: present, its type, not null only where expected,
  --    and a default only where expected.
  for v_i in 1 .. cardinality(v_columns) loop
    select format_type(a.atttypid, a.atttypmod),
           a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid)
      into v_type, v_notnull, v_default
      from pg_attribute a
      left join pg_attrdef d
        on d.adrelid = a.attrelid
       and d.adnum = a.attnum
     where a.attrelid = v_table
       and a.attname = v_columns[v_i]
       and not a.attisdropped;
    if not found then
      raise exception 'chat_sessions: column % is missing', v_columns[v_i];
    end if;
    if v_type is distinct from v_types[v_i] then
      raise exception 'chat_sessions: column % is of type %, expected %',
        v_columns[v_i], v_type, v_types[v_i];
    end if;
    if v_notnull is distinct from v_not_null[v_i] then
      raise exception 'chat_sessions: column % not null is %, expected %',
        v_columns[v_i], v_notnull, v_not_null[v_i];
    end if;
    if v_default is distinct from v_defaults[v_i] then
      raise exception 'chat_sessions: column % defaults to %, expected %',
        v_columns[v_i], coalesce(v_default, 'no default'),
        coalesce(v_defaults[v_i], 'no default');
    end if;
  end loop;

  -- 2. Each added check: present under its name, validated, and with the
  --    expected definition.
  for v_i in 1 .. cardinality(v_checks) loop
    select pg_get_constraintdef(k.oid), k.convalidated
      into v_definition, v_validated
      from pg_constraint k
     where k.conrelid = v_table
       and k.contype = 'c'
       and k.conname = v_checks[v_i];
    if not found then
      raise exception 'chat_sessions: check % is missing', v_checks[v_i];
    end if;
    if not v_validated then
      raise exception 'chat_sessions: check % is not validated', v_checks[v_i];
    end if;
    if v_definition is distinct from v_definitions[v_i] then
      raise exception 'chat_sessions: check % is %, expected %',
        v_checks[v_i], v_definition, v_definitions[v_i];
    end if;
  end loop;

  -- 3. The policy set is unchanged: chat_sessions_select_own, for SELECT.
  select string_agg(format('%s/%s', p.polname, p.polcmd), ', ' order by p.polname)
    into v_found
    from pg_policy p
   where p.polrelid = v_table;
  if v_found is distinct from 'chat_sessions_select_own/r' then
    raise exception 'chat_sessions: expected only chat_sessions_select_own for SELECT, found %',
      coalesce(v_found, 'no policy');
  end if;

  -- 4. anon holds nothing on the table, at table level or on any column.
  select string_agg(p.privilege, ', ')
    into v_found
    from unnest(v_all) as p(privilege)
   where has_table_privilege('anon', v_table, p.privilege);
  if v_found is not null then
    raise exception 'chat_sessions: anon holds table privileges: %', v_found;
  end if;
  if has_any_column_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'chat_sessions: anon holds column privileges';
  end if;

  -- 5. authenticated holds no write, at table level or on any column, the
  --    added columns included.
  select string_agg(p.privilege, ', ')
    into v_found
    from unnest(v_denied) as p(privilege)
   where has_table_privilege('authenticated', v_table, p.privilege);
  if v_found is not null then
    raise exception 'chat_sessions: authenticated holds table privileges: %',
      v_found;
  end if;
  if has_any_column_privilege('authenticated', v_table, 'INSERT,UPDATE,REFERENCES') then
    raise exception 'chat_sessions: authenticated holds column write privileges';
  end if;
end
$$;

commit;
