/**
 * cronRetryBound — the limits on how the memory crons retry a session.
 *
 * Both crons pick sessions oldest-first in small batches. A session whose
 * summary or fact extraction keeps failing used to be picked again every hour,
 * spending an LLM call each time, and enough of them could fill every batch so
 * newer sessions were never reached. Each failure now records state on the
 * session (src/lib/memoryCronBatch.ts, columns <p>_failures and
 * <p>_next_attempt_at on chat_sessions): the session is not picked again until
 * CRON_RETRY_BACKOFF_MS has passed, and a session whose counted failures reach
 * CRON_MAX_COUNTED_FAILURES is given up, with its outcome, reason and time
 * recorded.
 */

/** Counted failures after which a session is given up. */
export const CRON_MAX_COUNTED_FAILURES = 3;

/** How many candidate sessions each run reads. */
export const SESSION_CANDIDATE_LIMIT = 24;

/**
 * How long a failed session waits before it may be picked again. An
 * unvalidated default: revisit it against how often failed sessions succeed
 * on a later attempt.
 */
export const CRON_RETRY_BACKOFF_MS = 2 * 60 * 60 * 1000;
