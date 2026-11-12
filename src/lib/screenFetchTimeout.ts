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
 * It must be longer than the sum of the summary route's per-call waits for
 * Plaid's response headers. One connection makes its Plaid calls one after
 * another (the accounts, every transactions page up to the adapter's page
 * limit, and the recurring streams), and the adapter's per-call limit bounds
 * each call's wait for the response headers; connections are read side by
 * side, so their number does not add to it. That sum does not bound the route:
 * after the headers a call is limited only per idle gap while its body
 * arrives, and the route's own authentication and database reads have no limit
 * in code, so the margin this value adds over the sum leaves room for them
 * without bounding them. A test holds the relation, so raising the page limit
 * or the per-call limit without raising this turns it red.
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
