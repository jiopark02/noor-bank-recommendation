-- =============================================================================
-- Add unique constraint to prevent duplicate active chat sessions per user
--
-- Why: Without this constraint, race conditions during concurrent requests
-- can cause a user to have multiple sessions with ended_at IS NULL at the
-- same time. This breaks conversation continuity and summarization.
--
-- How: A partial unique index ensures that for any given user_id, there can
-- be at most one row where ended_at IS NULL. Closed sessions (ended_at NOT NULL)
-- are unaffected — a user can have unlimited closed sessions in their history.
--
-- Safe to apply on existing data:
--   - If a user currently has duplicate active sessions, this migration will
--     FAIL with a unique violation. Run the cleanup query below first if needed.
--   - Cleanup: keep only the most recent active session per user, close others.
--
-- Author: NOOR Tech Team
-- Date:   2026-05-19
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- (Optional) Pre-flight cleanup: close older active sessions if duplicates exist
-- ---------------------------------------------------------------------------
-- Uncomment the block below ONLY if you discover duplicate active sessions
-- (run the SELECT first to check):
--
--   SELECT user_id, COUNT(*) 
--   FROM public.chat_sessions 
--   WHERE ended_at IS NULL 
--   GROUP BY user_id 
--   HAVING COUNT(*) > 1;
--
-- If the above returns any rows, uncomment and run this cleanup:
--
-- WITH ranked AS (
--   SELECT id,
--          ROW_NUMBER() OVER (
--            PARTITION BY user_id
--            ORDER BY last_message_at DESC, started_at DESC
--          ) AS rn
--   FROM public.chat_sessions
--   WHERE ended_at IS NULL
-- )
-- UPDATE public.chat_sessions
-- SET ended_at = now()
-- WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ---------------------------------------------------------------------------
-- Add the partial unique index
-- ---------------------------------------------------------------------------
create unique index if not exists ux_chat_sessions_one_active_per_user
  on public.chat_sessions(user_id)
  where ended_at is null;

COMMIT;
