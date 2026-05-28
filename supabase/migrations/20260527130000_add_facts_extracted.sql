-- PR5: Facts auto-extraction (Layer 2) tracking column.
--
-- Adds chat_sessions.facts_extracted to track which ended sessions have
-- already been processed by the /api/cron/extract-facts cron.
--
-- Mirrors the existing `summarized` column pattern (PR4). `summarized` and
-- `facts_extracted` are independent flags: a session can be summarized but
-- not yet fact-extracted, or vice versa.

-- Tracking column. DEFAULT false so existing rows are safe and existing
-- code (which never reads this column) is unaffected.
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS facts_extracted boolean NOT NULL DEFAULT false;

-- Partial index for the cron's "needs facts extraction" query.
-- Same shape as idx_chat_sessions_needs_summary (PR4): the cron scans
-- ended, not-yet-extracted sessions ordered by ended_at ASC.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_needs_facts_extraction
  ON public.chat_sessions (user_id, ended_at)
  WHERE facts_extracted = false AND ended_at IS NOT NULL;
