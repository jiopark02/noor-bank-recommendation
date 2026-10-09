/**
 * llmCallLog — writes one public.llm_calls row. The only IO for LLM call
 * telemetry; the row itself is built by llmCallTelemetry.ts.
 *
 * THE CONTRACT: recordLlmCall NEVER REJECTS AND NEVER WAITS LONGER THAN THE
 * CEILING FOR ITS ROUTE (LLM_CALL_LOG_TIMEOUT_MS_CHAT for chat rows,
 * LLM_CALL_LOG_TIMEOUT_MS_CRON for the crons).
 * Callers await it on the request path — inside the chat route's OpenRouter
 * call, including the catch that rethrows a fetch error — so a rejection here
 * would replace the caller's own error or response, and a hang would hold the
 * user's reply. A failed, thrown, or timed-out insert is logged and dropped.
 * Chat gets the shorter ceiling because the user is waiting on it, once per
 * model attempt, so a fallback pays it twice.
 *
 * Log lines carry only the row's route (the first 32 characters when it is a
 * string, otherwise "non-string") and, on a failure, the error's code (when it
 * is a string, capped at 16 characters, otherwise null). The error's message is
 * never logged: a PostgreSQL message can quote the rejected input value. No
 * other row value and no other error field is logged.
 *
 * Why it is awaited at all: Vercel freezes the function once the response is
 * returned, so an un-awaited insert may never be sent. `after()` would avoid
 * the wait but does not exist in the installed Next.js version (14.2).
 *
 * A timed-out insert is not cancelled. It may still land, or be frozen with the
 * function; either way nothing waits for it and its outcome is never observed.
 */

import { createAdminClient } from "@/lib/supabase";
import type { LlmCallRow, LlmRoute } from "@/lib/llmCallTelemetry";

export const LLM_CALL_LOG_TIMEOUT_MS_CHAT = 500;
export const LLM_CALL_LOG_TIMEOUT_MS_CRON = 1500;

export interface LlmCallLogDeps {
  insert: (row: LlmCallRow) => PromiseLike<{ error: unknown }>;
  timeoutMs?: number;
}

const defaultDeps: LlmCallLogDeps = {
  insert: (row) => createAdminClient().from("llm_calls").insert(row),
};

const TIMED_OUT = Symbol("timed out");

function ceilingFor(route: LlmRoute): number {
  switch (route) {
    case "chat":
      return LLM_CALL_LOG_TIMEOUT_MS_CHAT;
    case "cron_summarize":
      return LLM_CALL_LOG_TIMEOUT_MS_CRON;
    case "cron_extract_facts":
      return LLM_CALL_LOG_TIMEOUT_MS_CRON;
    default: {
      // Compile-time exhaustiveness: a new LlmRoute member fails tsc here until
      // it is given a ceiling. A row that reaches this at runtime anyway (a
      // value TypeScript did not check) gets the shorter ceiling.
      const _exhaustive: never = route;
      return LLM_CALL_LOG_TIMEOUT_MS_CHAT;
    }
  }
}

/** The error's code when it is a string, capped; never its message. */
function codeOf(error: unknown): string | null {
  try {
    const code = (error as { code?: unknown } | null | undefined)?.code;
    return typeof code === "string" ? code.slice(0, 16) : null;
  } catch {
    return null;
  }
}

export async function recordLlmCall(
  row: LlmCallRow,
  deps: LlmCallLogDeps = defaultDeps
): Promise<void> {
  // Narrowed inside the try, so the catch only ever logs a short string.
  let routeForLog = "non-string";
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const route = row.route;
    routeForLog =
      typeof route === "string" ? route.slice(0, 32) : "non-string";
    const timeoutMs = deps.timeoutMs ?? ceilingFor(route);

    // Promise.resolve().then turns a synchronous throw from insert into a
    // rejection, so it reaches the catch below like any other failure.
    const attempt = Promise.resolve().then(() => deps.insert(row));
    // If the timeout wins, nothing awaits `attempt` any more; this keeps a late
    // rejection from surfacing as an unhandled rejection.
    attempt.then(undefined, () => undefined);

    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });

    const outcome = await Promise.race([attempt, timeout]);

    if (outcome === TIMED_OUT) {
      console.warn(
        `[llm-calls] insert did not finish within ${timeoutMs}ms; row not confirmed`,
        { route: routeForLog }
      );
    } else if (outcome?.error) {
      console.error("[llm-calls] insert failed:", {
        route: routeForLog,
        code: codeOf(outcome.error),
      });
    }
  } catch (error) {
    console.error("[llm-calls] insert failed:", {
      route: routeForLog,
      code: codeOf(error),
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
