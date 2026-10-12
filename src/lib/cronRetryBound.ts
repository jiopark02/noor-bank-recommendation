/**
 * cronRetryBound — stops the memory crons from retrying a session forever.
 *
 * Both crons pick sessions oldest-first in small batches. A session whose
 * summary or fact extraction keeps failing used to be picked again every hour,
 * spending an LLM call each time, and enough of them would fill every batch so
 * newer sessions were never reached. Now:
 *   - a session is given up after CRON_MAX_RESPONDED_ATTEMPTS attempts in which
 *     the model actually responded (counted from llm_calls; see
 *     getRespondedAttemptCounts in aiMemory.ts). A routing error, any other
 *     non-2xx response, a network error or a timeout is not counted. A failure
 *     after the model answered — a database write, parsing or validation in
 *     our code, marking the session — is counted;
 *   - giving up sets the cron's own completion flag (summarized or
 *     facts_extracted), so the session leaves the queue; the session id and
 *     the count are logged. The count covers every llm_calls row for the
 *     session, with no time window, so resetting the flag alone makes the next
 *     run give the session up again. There is no supported re-queue path yet;
 *   - each run reads more candidates (SESSION_CANDIDATE_LIMIT) than it
 *     processes, but only sessions at or over the bound leave the queue. A
 *     session that keeps timing out is never counted, so it stays at the head
 *     of the queue; with the run deadline, a run can end after that one
 *     session.
 *
 * A completion flag that is true therefore means "processed, given up, or
 * empty" — not "a summary or fact row exists".
 */

export const CRON_MAX_RESPONDED_ATTEMPTS = 3;
export const SESSION_CANDIDATE_LIMIT = 24;

export interface BoundedSession {
  id: string;
  user_id: string;
}

/**
 * Splits candidates (already in queue order) into those to give up — at or
 * over the bound — and at most `limit` to process, keeping the queue order.
 * A session with no count has made no counted attempt.
 */
export function partitionByAttemptBound<T extends BoundedSession>(
  candidates: T[],
  counts: Record<string, number>,
  options: { max: number; limit: number }
): { toProcess: T[]; toGiveUp: T[] } {
  const toProcess: T[] = [];
  const toGiveUp: T[] = [];
  for (const session of candidates) {
    if ((counts[session.id] ?? 0) >= options.max) {
      toGiveUp.push(session);
    } else if (toProcess.length < options.limit) {
      toProcess.push(session);
    }
  }
  return { toProcess, toGiveUp };
}

type Log = (message: string, ...args: unknown[]) => void;

/**
 * Marks each session given up through `mark`. A failed mark is logged and
 * counted, and the run continues with the next session; that session is simply
 * selected and given up again on a later run. Logs carry ids and counts only.
 */
export async function applyGiveUps<T extends BoundedSession>(
  sessions: T[],
  counts: Record<string, number>,
  deps: {
    route: string;
    mark: (session: T) => Promise<void>;
    log?: Log;
  }
): Promise<{ givenUp: number; giveUpFailed: number }> {
  const log: Log = deps.log ?? ((message, ...args) => console.error(message, ...args));
  let givenUp = 0;
  let giveUpFailed = 0;
  for (const session of sessions) {
    try {
      await deps.mark(session);
      givenUp++;
      log(
        "[cron-poison] route=%s session=%s responded_attempts=%d",
        deps.route,
        session.id,
        counts[session.id] ?? 0
      );
    } catch {
      giveUpFailed++;
      log(
        "[cron-poison] give_up_failed route=%s session=%s",
        deps.route,
        session.id
      );
    }
  }
  return { givenUp, giveUpFailed };
}
