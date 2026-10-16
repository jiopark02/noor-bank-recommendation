/**
 * chatUsageLedger — the only IO for the chat usage limit: one call to
 * chat_usage_reserve before a chat request does any work, and one call to
 * chat_usage_settle once it is done. Both go through the service-role client.
 *
 * reserveChatUsage THROWS on every failure — a database error, a timeout, a
 * thrown client, an answer of the wrong shape — so the caller cannot mistake
 * "could not check" for "allowed". Under enforcement the route answers that
 * throw with 503. A reserve that times out is aborted, but the database may
 * still have committed the row, so the caller settles that reservation at zero.
 *
 * settleChatUsage NEVER REJECTS AND NEVER WAITS LONGER THAN
 * CHAT_USAGE_SETTLE_TIMEOUT_MS. It runs on the way out of every admitted
 * request, so a rejection would replace the route's response and a hang would
 * hold it. A settle that fails leaves the row at its estimate, which only
 * over-counts.
 *
 * Log lines carry a failure reason and the error's code (a string capped at 16
 * characters, otherwise null) — never the error's message, which can quote
 * input values, and never the user id.
 */

import { createAdminClient } from "@/lib/supabase";
import {
  CHAT_USAGE_LIMITS,
  CHAT_USAGE_RESERVE_TIMEOUT_MS,
  CHAT_USAGE_SETTLE_TIMEOUT_MS,
  requestHold,
  type ChatUsageLimitScope,
} from "@/lib/chatUsageLimits";

export type ChatUsageRpcName = "chat_usage_reserve" | "chat_usage_settle";

export interface ChatUsageLedgerDeps {
  rpc: (
    fn: ChatUsageRpcName,
    args: Record<string, unknown>,
    signal: AbortSignal
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  timeoutMs?: number;
}

const defaultDeps: ChatUsageLedgerDeps = {
  rpc: (fn, args, signal) =>
    createAdminClient().rpc(fn, args).abortSignal(signal),
};

export interface ChatUsageReserveInput {
  reservationId: string;
  /** The verified token's user id, verbatim. */
  userId: string;
  mode: "enforce" | "observe";
}

/**
 * allowed is false when a limit is hit; under observe the row is recorded
 * anyway. retryAt is an ISO timestamp from the database clock.
 */
export type ChatUsageDecision =
  | { allowed: true; limit: null; retryAt: null }
  | { allowed: false; limit: ChatUsageLimitScope; retryAt: string };

export type ChatUsageCheckFailure = "rpc_error" | "timeout" | "threw" | "malformed";

export class ChatUsageCheckError extends Error {
  readonly reason: ChatUsageCheckFailure;
  readonly code: string | null;

  constructor(reason: ChatUsageCheckFailure, code: string | null) {
    super(`chat usage check failed: ${reason}`);
    this.name = "ChatUsageCheckError";
    this.reason = reason;
    this.code = code;
    // ES5 target: keep instanceof working on the subclass.
    Object.setPrototypeOf(this, ChatUsageCheckError.prototype);
  }
}

const TIMED_OUT = Symbol("timed out");

/** The error's code when it is a string, capped; never its message. */
function codeOf(error: unknown): string | null {
  try {
    const code = (error as { code?: unknown } | null | undefined)?.code;
    return typeof code === "string" ? code.slice(0, 16) : null;
  } catch {
    return null;
  }
}

/**
 * Calls fn with an AbortSignal and races it against timeoutMs. On timeout the
 * signal is aborted and TIMED_OUT is returned; a late settlement of the call is
 * swallowed so it cannot surface as an unhandled rejection.
 */
async function callWithTimeout(
  deps: ChatUsageLedgerDeps,
  fn: ChatUsageRpcName,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<{ data: unknown; error: unknown } | typeof TIMED_OUT> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Promise.resolve().then turns a synchronous throw into a rejection.
    const attempt = Promise.resolve().then(() =>
      deps.rpc(fn, args, controller.signal)
    );
    attempt.then(undefined, () => undefined);

    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });

    const outcome = await Promise.race([attempt, timeout]);
    if (outcome === TIMED_OUT) controller.abort();
    return outcome;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isScope(value: unknown): value is ChatUsageLimitScope {
  return value === "hour" || value === "day" || value === "30d";
}

/** One row of chat_usage_reserve's result, or null when the shape is wrong. */
function normalizeDecision(data: unknown): ChatUsageDecision | null {
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (!row || typeof row !== "object") return null;
  const { allowed, limit_hit, retry_at } = row as Record<string, unknown>;
  if (typeof allowed !== "boolean") return null;

  if (limit_hit === null || limit_hit === undefined) {
    // No limit hit: the request must be admitted.
    return allowed ? { allowed: true, limit: null, retryAt: null } : null;
  }

  if (!isScope(limit_hit)) return null;
  if (typeof retry_at !== "string" || Number.isNaN(Date.parse(retry_at))) {
    return null;
  }
  // A hit limit is never reported as allowed.
  if (allowed) return null;
  return { allowed: false, limit: limit_hit, retryAt: retry_at };
}

export async function reserveChatUsage(
  input: ChatUsageReserveInput,
  deps: ChatUsageLedgerDeps = defaultDeps
): Promise<ChatUsageDecision> {
  const args = {
    p_reservation_id: input.reservationId,
    p_user_id: input.userId,
    p_hold_cost: requestHold(),
    p_max_per_hour: CHAT_USAGE_LIMITS.requestsPerHour,
    p_max_per_day: CHAT_USAGE_LIMITS.requestsPerDay,
    p_max_cost_30d: CHAT_USAGE_LIMITS.costPer30Days,
    p_enforce: input.mode === "enforce",
  };

  let outcome: { data: unknown; error: unknown } | typeof TIMED_OUT;
  try {
    outcome = await callWithTimeout(
      deps,
      "chat_usage_reserve",
      args,
      deps.timeoutMs ?? CHAT_USAGE_RESERVE_TIMEOUT_MS
    );
  } catch (error) {
    throw new ChatUsageCheckError("threw", codeOf(error));
  }

  if (outcome === TIMED_OUT) throw new ChatUsageCheckError("timeout", null);
  if (outcome.error) {
    throw new ChatUsageCheckError("rpc_error", codeOf(outcome.error));
  }

  const decision = normalizeDecision(outcome.data);
  if (!decision) throw new ChatUsageCheckError("malformed", null);
  return decision;
}

export interface ChatUsageSettleInput {
  reservationId: string;
  /** The verified token's user id, verbatim. */
  userId: string;
  cost: number;
  attempts: number;
}

export async function settleChatUsage(
  input: ChatUsageSettleInput,
  deps: ChatUsageLedgerDeps = defaultDeps
): Promise<void> {
  const timeoutMs = deps.timeoutMs ?? CHAT_USAGE_SETTLE_TIMEOUT_MS;
  try {
    const outcome = await callWithTimeout(
      deps,
      "chat_usage_settle",
      {
        p_reservation_id: input.reservationId,
        p_user_id: input.userId,
        p_cost: input.cost,
        p_attempts: input.attempts,
      },
      timeoutMs
    );

    if (outcome === TIMED_OUT) {
      console.warn(
        `[chat-usage] settle did not finish within ${timeoutMs}ms; reservation left at its estimate`
      );
    } else if (outcome.error) {
      console.error("[chat-usage] settle failed:", {
        code: codeOf(outcome.error),
      });
    }
  } catch (error) {
    console.error("[chat-usage] settle failed:", { code: codeOf(error) });
  }
}
