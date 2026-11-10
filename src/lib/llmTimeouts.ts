/**
 * llmTimeouts — how long an OpenRouter call may take, when the chat route and
 * the memory crons stop starting new calls, and how long the chat route's
 * waits before its model loop may last.
 *
 * The values are unvalidated defaults: when they were set, llm_calls held too
 * few rows per route to measure real latency. Revisit them against
 * llm_calls.latency_ms once there is enough data.
 *
 * A timed-out call is recorded in llm_calls as error_class 'network_error'
 * with latency_ms close to the timeout, which is how it is told apart from
 * other network failures.
 */

/** Per attempt, in the chat route. */
export const CHAT_LLM_TIMEOUT_MS = 25000;

/**
 * The chat route runs with maxDuration = 60 s. Before each model attempt, the
 * first included, it starts the attempt only when the attempt could still run
 * to its full timeout inside this budget, measured from the start of the
 * request. The waits before the model loop end at the pre-loop deadline
 * below, which is the last moment a first attempt may start. The turn save
 * after the loop has no timeout of its own, so this budget does not bound it.
 */
export const CHAT_REQUEST_BUDGET_MS = 55000;

/**
 * How long after the start of a chat request the waits before the model loop
 * (authentication, the body read, the profile, session, memory and Plaid
 * reads) may last. Derived, not a value of its own: past this point not even
 * one model attempt fits in the request budget, so a wait that is still
 * running has nothing left to wait for.
 */
export function chatPreLoopDeadlineMs(): number {
  return CHAT_REQUEST_BUDGET_MS - CHAT_LLM_TIMEOUT_MS;
}

/** Per call, in both memory crons. */
export const CRON_LLM_TIMEOUT_MS = 25000;

/**
 * The crons run with maxDuration = 60 s. A run stops starting new sessions
 * once a further call could no longer finish, with a margin, inside this
 * budget, so the platform never kills the function mid-call (which would also
 * lose that call's llm_calls row and the run's cron_runs row).
 */
export const CRON_RUN_BUDGET_MS = 55000;
export const CRON_RUN_MARGIN_MS = 5000;

/** One line per timed-out call: route, model id and timeout only, no content. */
export function logLlmTimeout(
  route: string,
  model: string,
  timeoutMs: number
): void {
  console.warn(
    "[llm-timeout] route=%s model=%s ms=%d",
    route,
    model,
    timeoutMs
  );
}

/**
 * True when a chat request that has been going for `elapsedMs` still has room
 * for one more model attempt that runs to its full timeout.
 */
export function chatHasBudgetForAnotherAttempt(elapsedMs: number): boolean {
  return elapsedMs + CHAT_LLM_TIMEOUT_MS <= CHAT_REQUEST_BUDGET_MS;
}

/**
 * Thrown by runUntilDeadline when the deadline is reached. `stage` names the
 * wait that was cut. The message deliberately avoids the words a retry helper
 * looks for in a transient failure: a wait cut at its deadline must not be
 * started again.
 */
export class ChatDeadlineError extends Error {
  readonly stage: string;

  constructor(stage: string) {
    super(`chat deadline reached during stage ${stage}`);
    this.name = "ChatDeadlineError";
    this.stage = stage;
    // ES5 target: keep instanceof working on the subclass.
    Object.setPrototypeOf(this, ChatDeadlineError.prototype);
  }
}

/**
 * Runs `fn` and waits for it no later than `deadlineAtMs` (a Date.now()
 * value).
 *
 * - If the deadline has already passed, `fn` is not called and
 *   ChatDeadlineError is thrown.
 * - If `fn` settles first, its value is returned or its rejection rethrown
 *   unchanged.
 * - If the deadline comes first, ChatDeadlineError is thrown and the signal
 *   handed to `fn` is aborted. A call that takes the signal is cancelled; one
 *   that does not keeps running with nothing waiting for it. Either way its
 *   late result is dropped and a late rejection is swallowed.
 *
 * Where the request goes after the throw is the caller's decision.
 */
export async function runUntilDeadline<T>(
  deadlineAtMs: number,
  stage: string,
  fn: (signal: AbortSignal) => PromiseLike<T> | T
): Promise<T> {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) throw new ChatDeadlineError(stage);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Promise.resolve().then turns a synchronous throw into a rejection.
    const attempt = Promise.resolve().then(() => fn(controller.signal));
    attempt.then(undefined, () => undefined);

    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Reject first, so nothing the abort triggers can settle the race.
        reject(new ChatDeadlineError(stage));
        controller.abort();
      }, remainingMs);
    });

    return await Promise.race([attempt, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * True when a cron run that has been going for `elapsedMs` still has room for
 * one more LLM call that runs to its full timeout.
 */
export function cronRunHasBudgetForAnotherCall(elapsedMs: number): boolean {
  return (
    elapsedMs + CRON_LLM_TIMEOUT_MS + CRON_RUN_MARGIN_MS <= CRON_RUN_BUDGET_MS
  );
}
