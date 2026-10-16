/**
 * chatUsageLimits — the per-user usage limits on POST /api/chat, the mode
 * switch, and the pure arithmetic around them. No IO; the ledger calls live in
 * chatUsageLedger.ts and the decision itself is made by the database function
 * chat_usage_reserve.
 *
 * The values live in code, not env, so every change to one goes through
 * review, the tests and a deploy, and no mistyped variable can switch a limit
 * off. They are agreed values, revised from measured usage in
 * chat_usage_reservations. A null limit is off.
 *
 * Costs are in the unit OpenRouter reports as usage.cost (the same unit as
 * llm_calls.provider_cost).
 */

export interface ChatUsageLimitValues {
  /** Requests per rolling hour. */
  requestsPerHour: number | null;
  /** Requests per rolling 24 hours. */
  requestsPerDay: number | null;
  /** Provider cost per rolling 30 days. */
  costPer30Days: number | null;
  /**
   * The cost counted for a model attempt whose cost is not known: one still
   * running, or one that ended without a reported cost (a throw, a timeout, a
   * body that is not JSON, a body without usage.cost).
   */
  attemptHold: number;
}

export const CHAT_USAGE_LIMITS: ChatUsageLimitValues = {
  requestsPerHour: 40,
  requestsPerDay: 150,
  costPer30Days: 24,
  attemptHold: 0.05,
};

/**
 * How long the route waits for chat_usage_reserve. Under enforcement a slower
 * answer refuses the request (503), so this sits well above a normal round
 * trip, and above the function's own 2 s lock_timeout so a lock wait ends as a
 * database error (nothing committed) before it ends as an abort (commit
 * unknown).
 */
export const CHAT_USAGE_RESERVE_TIMEOUT_MS = 3000;

/**
 * How long the route waits for chat_usage_settle. A settle that does not
 * finish leaves the row at its estimate, which only ever over-counts, so this
 * matches the chat ceiling for llm_calls writes.
 */
export const CHAT_USAGE_SETTLE_TIMEOUT_MS = 500;

/** Model attempts a chat request can make: the primary and the fallback. */
export const CHAT_MAX_MODEL_ATTEMPTS = 2;

export type ChatUsageMode = "enforce" | "observe" | "off";

export type ChatUsageLimitScope = "hour" | "day" | "30d";

/**
 * Maps CHAT_USAGE_LIMIT_MODE to a mode. Only the exact strings "off" and
 * "observe" opt out of enforcement; there is no trimming and no case folding.
 * Unset and empty enforce silently. Any other value enforces and logs an error
 * on every call, without the value itself.
 */
export function resolveChatUsageMode(raw: string | undefined): ChatUsageMode {
  if (raw === undefined || raw === "" || raw === "enforce") return "enforce";
  if (raw === "observe") return "observe";
  if (raw === "off") return "off";
  console.error("[chat-usage] unrecognized CHAT_USAGE_LIMIT_MODE; enforcing");
  return "enforce";
}

/** Rounds to the ledger's scale, numeric(14, 8). */
function toLedgerScale(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/** The cost a request is counted at while it runs: every attempt at the hold. */
export function requestHold(
  limits: ChatUsageLimitValues = CHAT_USAGE_LIMITS
): number {
  return toLedgerScale(CHAT_MAX_MODEL_ATTEMPTS * limits.attemptHold);
}

/**
 * The cost a request is settled at: each attempt's reported cost, or the hold
 * for an attempt with none. A reported cost above the hold is kept as is.
 */
export function settledCost(
  tally: ReadonlyArray<number | null>,
  limits: ChatUsageLimitValues = CHAT_USAGE_LIMITS
): number {
  let total = 0;
  for (const cost of tally) {
    total +=
      typeof cost === "number" && Number.isFinite(cost) && cost >= 0
        ? cost
        : limits.attemptHold;
  }
  return toLedgerScale(total);
}

/** Whole seconds until retryAt, rounded up, never below 1. */
export function retryAfterSeconds(retryAt: string, nowMs: number): number {
  const seconds = Math.ceil((Date.parse(retryAt) - nowMs) / 1000);
  return Number.isFinite(seconds) && seconds >= 1 ? seconds : 1;
}

const LIMIT_MESSAGES: Record<ChatUsageLimitScope, string> = {
  hour: "You've reached the chat limit for the last hour. Please try again later.",
  day: "You've reached the chat limit for the last 24 hours. Please try again later.",
  "30d":
    "You've reached the chat limit for the last 30 days. Please try again later.",
};

export interface ChatUsageLimitBody {
  error: string;
  code: "USAGE_LIMIT_REACHED";
  limit: ChatUsageLimitScope;
  retryAt: string;
}

/** The 429 body for a refused request. */
export function buildUsageLimitBody(
  limit: ChatUsageLimitScope,
  retryAt: string
): ChatUsageLimitBody {
  return {
    error: LIMIT_MESSAGES[limit],
    code: "USAGE_LIMIT_REACHED",
    limit,
    retryAt,
  };
}

/** The 503 body for a request whose usage check could not be made. */
export function buildUsageCheckUnavailableBody(): {
  error: string;
  code: "USAGE_CHECK_UNAVAILABLE";
} {
  return {
    error: "Chat is temporarily unavailable. Please try again shortly.",
    code: "USAGE_CHECK_UNAVAILABLE",
  };
}
