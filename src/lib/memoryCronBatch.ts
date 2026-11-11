/**
 * memoryCronBatch — the batch loop shared by the two memory crons (summarize
 * and extract-facts): pick candidates, process each session, and record how
 * each failure leaves the session.
 *
 * The route passes in its dependencies (clock, candidate read, per-session
 * work, state writes), so the loop and the failure rules are held by tests
 * that execute them rather than by reading the routes.
 *
 * How a failure is treated depends only on the stage the session had reached
 * when it failed, which the route records on a StageTracker as it goes:
 *   - before_call: anything before the model call (reads, an empty session's
 *     completion write). Not counted.
 *   - call: the model call. A 2xx whose answer could not be used, and a
 *     request the provider rejected as input (400, 403, 413, 422), are
 *     counted. Everything else is not: a timeout, a network failure, any other
 *     status. 401 and 402 also stop the run, since every later call would fail
 *     the same way.
 *   - interpret: reading the model's answer (empty, not parseable). Counted.
 *   - store: writing the result and marking the session done. Not counted, and
 *     the run stops starting new sessions.
 * A counted failure adds one to the session's failure count and moves its next
 * attempt; the failure that reaches CRON_MAX_COUNTED_FAILURES gives the session
 * up instead. A failure that is not counted only moves the next attempt, so it
 * is retried indefinitely, at most once per backoff interval.
 *
 * Logs carry the route, the session id, the stage and counts only: no content
 * and no error text.
 */

import type { CronGiveUpReason } from "@/lib/aiMemory";
import {
  CRON_MAX_COUNTED_FAILURES,
  CRON_RETRY_BACKOFF_MS,
} from "@/lib/cronRetryBound";

export type CronStage = "before_call" | "call" | "interpret" | "store";

/** What the model call observed, copied by the call itself as it ends. */
export interface ObservedCronCall {
  /** Null when no response arrived. */
  httpStatus: number | null;
  /** True when the call's timeout cut it off before the body parsed. */
  timedOut: boolean;
}

/**
 * Set by the route while it processes one session: `stage` when it moves on to
 * the next stage, `call` when the model call ends, whichever way it ends.
 */
export interface StageTracker {
  stage: CronStage;
  call?: ObservedCronCall;
}

export type CronFailureClass =
  | { counted: true; reason: CronGiveUpReason }
  | { counted: false; stopsRun: boolean };

/** Statuses a provider uses for a request it will not take as given. */
const INPUT_REJECTED_STATUSES = [400, 403, 413, 422];

/** Statuses that fail every call alike: a rejected key, no credits. */
const RUN_STOPPING_STATUSES = [401, 402];

export function classifyCronFailure(tracker: StageTracker): CronFailureClass {
  switch (tracker.stage) {
    case "before_call":
      return { counted: false, stopsRun: false };
    case "interpret":
      return { counted: true, reason: "output_unusable" };
    case "store":
      return { counted: false, stopsRun: true };
    case "call": {
      const call = tracker.call;
      if (!call || call.timedOut || call.httpStatus === null) {
        return { counted: false, stopsRun: false };
      }
      const status = call.httpStatus;
      if (status >= 200 && status <= 299) {
        return { counted: true, reason: "output_unusable" };
      }
      if (INPUT_REJECTED_STATUSES.indexOf(status) !== -1) {
        return { counted: true, reason: "input_rejected" };
      }
      return {
        counted: false,
        stopsRun: RUN_STOPPING_STATUSES.indexOf(status) !== -1,
      };
    }
    default:
      return { counted: false, stopsRun: false };
  }
}

export interface CronBatchSession {
  id: string;
  user_id: string;
}

export interface CronStateWrite {
  updated: number;
}

type Log = (message: string, ...args: unknown[]) => void;

export interface MemoryCronBatchDeps<S extends CronBatchSession> {
  route: "cron_summarize" | "cron_extract_facts";
  /** The clock, in milliseconds. */
  now: () => number;
  /** When the run started, on the same clock. */
  runStartedAtMs: number;
  candidateLimit: number;
  batchLimit: number;
  /** True while one more full-length model call fits in the run. */
  hasBudget: (elapsedMs: number) => boolean;
  fetchCandidates: (limit: number, nowIso: string) => Promise<S[]>;
  /** The session's failure count for this cron, as read with it. */
  failuresOf: (session: S) => number;
  processSession: (session: S, tracker: StageTracker) => Promise<void>;
  /** Called once for each failed session, with the error, before its state write. */
  onSessionError?: (session: S, error: unknown) => void;
  writeBackoff: (session: S, nextAttemptAtIso: string) => Promise<CronStateWrite>;
  writeCountedFailure: (
    session: S,
    failuresBefore: number,
    nextAttemptAtIso: string
  ) => Promise<CronStateWrite>;
  writeGiveUp: (
    session: S,
    failuresBefore: number,
    reason: CronGiveUpReason,
    givenUpAtIso: string
  ) => Promise<CronStateWrite>;
  log?: Log;
}

export interface MemoryCronBatchStats {
  /** Sessions finished this run (done). */
  processed: number;
  /** Sessions that failed this run, given-up ones included. */
  failed: number;
  counted: number;
  notCounted: number;
  /** Sessions this run gave up on (a subset of failed). */
  givenUp: number;
  /** State writes that threw; the session is selected again on a later run. */
  stateWriteFailed: number;
  /** Sessions not started because the run deadline was reached. */
  deferred: number;
  /** Sessions not started because an earlier failure stopped the run. */
  stoppedSkipped: number;
  stopped: boolean;
}

function isFailureCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Runs one batch. A failing candidate read rejects, and the caller records it
 * as the run's infrastructure error; nothing else here rejects.
 */
export async function runMemoryCronBatch<S extends CronBatchSession>(
  deps: MemoryCronBatchDeps<S>
): Promise<MemoryCronBatchStats> {
  const log: Log =
    deps.log ?? ((message, ...args) => console.error(message, ...args));
  const stats: MemoryCronBatchStats = {
    processed: 0,
    failed: 0,
    counted: 0,
    notCounted: 0,
    givenUp: 0,
    stateWriteFailed: 0,
    deferred: 0,
    stoppedSkipped: 0,
    stopped: false,
  };

  const candidates = await deps.fetchCandidates(
    deps.candidateLimit,
    new Date(deps.now()).toISOString()
  );
  const batch = candidates.slice(0, deps.batchLimit);

  for (let i = 0; i < batch.length; i += 1) {
    if (stats.stopped) {
      stats.stoppedSkipped = batch.length - i;
      break;
    }
    if (!deps.hasBudget(deps.now() - deps.runStartedAtMs)) {
      stats.deferred = batch.length - i;
      log(
        "[cron-retry] deadline route=%s deferred=%d",
        deps.route,
        stats.deferred
      );
      break;
    }

    const session = batch[i];
    const tracker: StageTracker = { stage: "before_call" };
    try {
      await deps.processSession(session, tracker);
      stats.processed++;
      continue;
    } catch (error) {
      stats.failed++;
      if (deps.onSessionError) deps.onSessionError(session, error);
    }

    const failure = classifyCronFailure(tracker);
    const written = await recordFailure(deps, log, stats, session, tracker, failure);
    if (!failure.counted && failure.stopsRun) stats.stopped = true;
    // A state write that fails after the model was called is a database
    // failure after the call; it stops the run like a store failure does.
    if (!written && tracker.stage !== "before_call") stats.stopped = true;
  }

  return stats;
}

/** Writes the session's state for one failure. False when the write threw. */
async function recordFailure<S extends CronBatchSession>(
  deps: MemoryCronBatchDeps<S>,
  log: Log,
  stats: MemoryCronBatchStats,
  session: S,
  tracker: StageTracker,
  failure: CronFailureClass
): Promise<boolean> {
  const nowMs = deps.now();
  const nowIso = new Date(nowMs).toISOString();
  const nextIso = new Date(nowMs + CRON_RETRY_BACKOFF_MS).toISOString();
  const before = deps.failuresOf(session);

  try {
    if (failure.counted && isFailureCount(before)) {
      stats.counted++;
      if (before + 1 >= CRON_MAX_COUNTED_FAILURES) {
        const result = await deps.writeGiveUp(session, before, failure.reason, nowIso);
        if (result.updated > 0) {
          stats.givenUp++;
          log(
            "[cron-poison] route=%s session=%s reason=%s failures=%d",
            deps.route,
            session.id,
            failure.reason,
            before + 1
          );
        } else {
          logSkipped(deps, log, session);
        }
        return true;
      }
      const result = await deps.writeCountedFailure(session, before, nextIso);
      logRetry(deps, log, session, tracker, true, before + 1, result);
      return true;
    }

    // Not counted — or counted, but the count read with the session is not
    // usable, so it cannot be advanced safely; the session is only delayed.
    stats.notCounted++;
    const result = await deps.writeBackoff(session, nextIso);
    logRetry(
      deps,
      log,
      session,
      tracker,
      false,
      isFailureCount(before) ? before : -1,
      result
    );
    return true;
  } catch {
    stats.stateWriteFailed++;
    log(
      "[cron-retry] write_failed route=%s session=%s stage=%s",
      deps.route,
      session.id,
      tracker.stage
    );
    return false;
  }
}

function logRetry<S extends CronBatchSession>(
  deps: MemoryCronBatchDeps<S>,
  log: Log,
  session: S,
  tracker: StageTracker,
  counted: boolean,
  failures: number,
  result: CronStateWrite
): void {
  if (result.updated === 0) {
    logSkipped(deps, log, session);
    return;
  }
  log(
    "[cron-retry] route=%s session=%s stage=%s counted=%s failures=%d",
    deps.route,
    session.id,
    tracker.stage,
    counted ? "yes" : "no",
    failures
  );
}

/** The state write matched no row: another run changed the session first. */
function logSkipped<S extends CronBatchSession>(
  deps: MemoryCronBatchDeps<S>,
  log: Log,
  session: S
): void {
  log("[cron-retry] skipped route=%s session=%s", deps.route, session.id);
}

/**
 * The cron_runs item counts for a batch. A session given up this run failed
 * this run, so it is already among the failed items.
 */
export function cronRunItems(stats: MemoryCronBatchStats): {
  itemsProcessed: number;
  itemsFailed: number;
} {
  return { itemsProcessed: stats.processed, itemsFailed: stats.failed };
}
