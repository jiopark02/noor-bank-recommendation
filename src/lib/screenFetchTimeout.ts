// =============================================================================
// How long the bank screens wait for the server. Client-safe: no server
// module is imported here.
//
// The dashboard and the money screen wait on two routes: the finance summary
// and the bank connection list. A request that never answers used to leave
// the screen on its loading state for good. Each of those requests now runs
// under one limit, after which it is aborted and the screen shows the error
// state it already has for a failed load.
// =============================================================================

/**
 * The limit for the bank screens' requests to the finance summary and the
 * connection list, in milliseconds.
 *
 * It must be longer than the summary route's longest wait the code allows, so
 * a slow answer the server would still deliver is never cut off here. That
 * wait is the Plaid calls one connection makes one after another (the
 * accounts, every transactions page up to the adapter's page limit, and the
 * recurring streams), each under the adapter's per-call limit; connections
 * are read side by side, so their number does not add to it. The value here
 * adds a margin for the route's own reads on top of that bound. A test holds
 * the relation, so raising the page limit or the per-call limit without
 * raising this turns it red.
 *
 * The connection list makes no Plaid call and has no wait bounded in code, so
 * it uses the same limit rather than a figure of its own.
 */
export const BANK_SCREEN_FETCH_TIMEOUT_MS = 150_000;

/**
 * Runs `run` with a signal that aborts after `timeoutMs`, and clears the timer
 * however `run` ends.
 *
 * Pass the signal to fetch and read the response body inside `run`: an abort
 * then cuts a body that stops arriving as well as a response that never
 * starts. The rejection is whatever fetch or the body read rejects with; the
 * caller's existing error handling decides what the screen shows.
 */
export async function withFetchTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
