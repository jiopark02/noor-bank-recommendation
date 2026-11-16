-- An insert into chat_messages for a session that has been closed
-- (chat_sessions.ended_at is set) is refused, with SQLSTATE NR001.
--
-- Why: the chat route reads the active session at the start of a request and
-- stores the turn at its end, which can be most of a minute later. The
-- summarize cron can close that session in between. The application checks
-- ended_at before it inserts (saveMessages in src/lib/aiMemory.ts), but that
-- is a read followed by a write: a session closed between the two still took
-- the turn, after its summary may already have been written without it.
--
-- How: nothing new is added. The trigger function that already runs after
-- every insert into chat_messages, bump_chat_session_on_message, updates the
-- session's message_count and last_message_at. That UPDATE now also requires
-- ended_at to be null, and the function raises when it updates no row. The
-- row lock the UPDATE takes on the session is the one it has always taken,
-- and it is the lock the cron's close (an UPDATE of the same row) takes too,
-- so the two are serialized on one row: if the close commits first, the
-- trigger's UPDATE re-reads the row, matches nothing, and raises; if the
-- insert commits first, the session is closed with the turn in it. There is
-- no second lock and so no lock order to get wrong.
--
-- What an insert sees: the statement fails as a whole, so neither row of a
-- two-row insert is stored. The error carries SQLSTATE NR001 and a message
-- with no session, user or row value in it. The application maps that code to
-- "the session is closed, nothing was stored" and inserts the same rows into
-- the user's open session.
--
-- What this file does not change:
--   - The trigger itself (trg_chat_messages_bump_session, AFTER INSERT FOR
--     EACH ROW). Only the function's body is replaced.
--   - The function's owner, its privileges, or its other properties: it stays
--     SECURITY INVOKER with no configuration, and runs as the role that made
--     the insert. No policy and no grant is added, changed or removed.
--   - Rows that already exist, in either table.
--
-- Order of deployment: either order is safe. With this file applied and the
-- older application code deployed, an insert into a closed session fails and
-- the route answers its existing SAVE_FAILED where it used to store the turn.
-- With the newer application code deployed and this file not applied, the
-- application's own ended_at check is the only one, as before this file.
-- Whether this file is applied in a given database is a live-state question:
-- read the function's definition there rather than inferring it from here.
--
-- Before applying, read and keep the definition the database holds:
--   select pg_get_functiondef('public.bump_chat_session_on_message()'::regprocedure);
-- It is what reversing this file must restore. The statement below is the
-- definition this repository's first migration for these tables created; if
-- the database holds something else, restore what the database held.
--
-- To reverse it:
--   begin;
--   create or replace function public.bump_chat_session_on_message()
--   returns trigger
--   language plpgsql
--   as $$
--   begin
--     update public.chat_sessions
--     set
--       message_count = message_count + 1,
--       last_message_at = new.created_at
--     where id = new.session_id;
--     return new;
--   end;
--   $$;
--   commit;
--
-- Running this file again reaches the same end state.
--
-- The end state is checked by property. The DO block raises, and the whole
-- file rolls back, unless the function is SECURITY INVOKER with no
-- configuration, its body carries the ended_at condition and the NR001
-- raise, and the one trigger that calls it on chat_messages is enabled and
-- fires after insert, for each row.

begin;

set local lock_timeout = '5s';

create or replace function public.bump_chat_session_on_message()
returns trigger
language plpgsql
as $$
begin
  update public.chat_sessions
  set
    message_count = message_count + 1,
    last_message_at = new.created_at
  where id = new.session_id
    and ended_at is null;
  if not found then
    raise exception 'chat_messages: the session is closed'
      using errcode = 'NR001';
  end if;
  return new;
end;
$$;

do $$
declare
  v_fn regprocedure := 'public.bump_chat_session_on_message()'::regprocedure;
  v_prosecdef boolean;
  v_proconfig text[];
  v_prosrc text;
  v_language name;
  v_triggers integer;
  v_tgtype smallint;
  v_tgenabled "char";
begin
  select p.prosecdef, p.proconfig, p.prosrc, l.lanname
    into v_prosecdef, v_proconfig, v_prosrc, v_language
    from pg_proc p
    join pg_language l on l.oid = p.prolang
   where p.oid = v_fn;

  -- 1. The function's properties are what they were: plpgsql, SECURITY
  --    INVOKER, no configuration.
  if v_language <> 'plpgsql' then
    raise exception '%: expected language plpgsql, found %', v_fn, v_language;
  end if;
  if v_prosecdef then
    raise exception '%: expected SECURITY INVOKER', v_fn;
  end if;
  if v_proconfig is not null then
    raise exception '%: expected no configuration, found %', v_fn, v_proconfig;
  end if;

  -- 2. The body carries the condition and the raise.
  if position('and ended_at is null' in v_prosrc) = 0 then
    raise exception '%: the body does not require ended_at to be null', v_fn;
  end if;
  if position('errcode = ''NR001''' in v_prosrc) = 0 then
    raise exception '%: the body does not raise NR001', v_fn;
  end if;

  -- 3. Exactly one trigger on chat_messages calls it: enabled, AFTER INSERT,
  --    FOR EACH ROW. tgtype bits: 1 row, 2 before, 4 insert, 8 delete,
  --    16 update, 32 truncate, 64 instead of.
  select count(*) into v_triggers
    from pg_trigger t
   where t.tgrelid = 'public.chat_messages'::regclass
     and t.tgfoid = v_fn
     and not t.tgisinternal;
  if v_triggers <> 1 then
    raise exception
      'chat_messages: expected one trigger calling %, found %', v_fn, v_triggers;
  end if;

  select t.tgtype, t.tgenabled into v_tgtype, v_tgenabled
    from pg_trigger t
   where t.tgrelid = 'public.chat_messages'::regclass
     and t.tgfoid = v_fn
     and not t.tgisinternal;
  if v_tgtype <> 5 then
    raise exception
      'chat_messages: the trigger calling % is not AFTER INSERT FOR EACH ROW (tgtype %)',
      v_fn, v_tgtype;
  end if;
  if v_tgenabled <> 'O' then
    raise exception
      'chat_messages: the trigger calling % is not enabled (tgenabled %)',
      v_fn, v_tgenabled;
  end if;
end
$$;

commit;
