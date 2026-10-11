/**
 * llmTimeouts — how long an OpenRouter call may take, and when a memory cron
 * stops starting new calls.
 *
 * The values are unvalidated defaults: when they were set, llm_calls held too
 * few rows per route to measure real latency. Revisit them against
 * llm_calls.latency_ms once there is enough data.
 *
 * A timed-out call is recorded in llm_calls as error_class 'network_error'
 * with latency_ms close to the timeout, which is how it is told apart from
 * other network failures.
 */

/** Per attempt. The chat route does not move to its fallback model after a timeout. */
export const CHAT_LLM_TIMEOUT_MS = 25000;

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
 * True when a cron run that has been going for `elapsedMs` still has room for
 * one more LLM call that runs to its full timeout.
 */
export function cronRunHasBudgetForAnotherCall(elapsedMs: number): boolean {
  return (
    elapsedMs + CRON_LLM_TIMEOUT_MS + CRON_RUN_MARGIN_MS <= CRON_RUN_BUDGET_MS
  );
}
