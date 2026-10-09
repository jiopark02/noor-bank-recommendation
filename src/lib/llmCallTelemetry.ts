/**
 * llmCallTelemetry — pure helpers that turn one LLM call attempt into one
 * public.llm_calls row. No IO; recordLlmCall in llmCallLog.ts does the write.
 *
 * WHAT A ROW MAY HOLD
 * Identifiers, counts, timings, and a classification the application chooses.
 * Never conversation text, prompt text, the provider's error message, or a
 * user's financial amount. LlmCallInput has no field that could carry any of
 * those, and llmCallTelemetry.test.ts pins the exact key set of the row.
 *
 * WHY EVERY FIELD IS VALIDATED
 * The response body is controlled by the provider. Each value is read only if
 * it has the expected type and shape; anything else becomes null, so output
 * drift (a renamed field, a string where a number was) loses one column rather
 * than failing the insert or storing something unexpected. The table's CHECK
 * constraints repeat the same limits as a second line of defense.
 */

import { asPlainObject, readFiniteNumber } from "@/lib/requestJson";

export type LlmRoute = "chat" | "cron_summarize" | "cron_extract_facts";

export type LlmErrorClass =
  | "empty_content"
  | "invalid_json"
  | "auth"
  | "insufficient_credits"
  | "rate_limited"
  | "client_error"
  | "provider_error"
  | "network_error"
  | "unknown";

export interface LlmResponseMeta {
  generationId: string | null;
  responseModel: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  providerCost: number | null;
}

/** Which optional system-prompt blocks a chat attempt carried. Chat only. */
export interface ChatPromptBlocks {
  memory: boolean;
  plaidScaffold: boolean;
  balance: boolean;
  financialSnapshot: boolean;
}

export interface LlmOutcome {
  succeeded: boolean;
  errorClass: LlmErrorClass | null;
}

export interface LlmCallInput {
  route: LlmRoute;
  attemptIndex: number;
  requestModel: string;
  startedAtMs: number;
  latencyMs: number;
  userId: string;
  sessionId: string | null;
  /** null when fetch threw before any response arrived. */
  httpStatus: number | null;
  outcome: LlmOutcome;
  /** null when no JSON body was read. */
  meta: LlmResponseMeta | null;
  /** Ignored for cron routes. */
  blocks: ChatPromptBlocks | null;
}

export interface LlmCallRow {
  started_at: string;
  route: LlmRoute;
  attempt_index: number;
  request_model: string;
  response_model: string | null;
  generation_id: string | null;
  succeeded: boolean;
  http_status: number | null;
  error_class: LlmErrorClass | null;
  finish_reason: string | null;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  provider_cost: number | null;
  has_memory_block: boolean | null;
  has_plaid_scaffold_block: boolean | null;
  has_balance_block: boolean | null;
  has_financial_snapshot_block: boolean | null;
  user_id: string;
  session_id: string | null;
}

const MAX_ID_LENGTH = 200;
const GENERATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/~-]+$/;
const FINISH_REASON_PATTERN = /^[a-z_]{1,32}$/;
/** numeric(14,8) holds values below 10^6. */
const MAX_PROVIDER_COST = 999999;

function readPatternString(
  obj: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  maxLength: number
): string | null {
  const value = obj[key];
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > maxLength) return null;
  return pattern.test(value) ? value : null;
}

function readTokenCount(
  obj: Record<string, unknown>,
  key: string
): number | null {
  const value = readFiniteNumber(obj, key);
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 2147483647) return null;
  return value;
}

function firstChoice(data: Record<string, unknown>): Record<string, unknown> {
  const choices = data.choices;
  return Array.isArray(choices) && choices.length > 0
    ? asPlainObject(choices[0])
    : {};
}

export function parseOpenRouterResponseMeta(
  data: Record<string, unknown>
): LlmResponseMeta {
  const usage = asPlainObject(data.usage);
  const promptDetails = asPlainObject(usage.prompt_tokens_details);
  const completionDetails = asPlainObject(usage.completion_tokens_details);

  const cost = readFiniteNumber(usage, "cost");

  return {
    generationId: readPatternString(
      data,
      "id",
      GENERATION_ID_PATTERN,
      MAX_ID_LENGTH
    ),
    responseModel: readPatternString(
      data,
      "model",
      MODEL_ID_PATTERN,
      MAX_ID_LENGTH
    ),
    finishReason: readPatternString(
      firstChoice(data),
      "finish_reason",
      FINISH_REASON_PATTERN,
      32
    ),
    promptTokens: readTokenCount(usage, "prompt_tokens"),
    completionTokens: readTokenCount(usage, "completion_tokens"),
    cachedTokens: readTokenCount(promptDetails, "cached_tokens"),
    reasoningTokens: readTokenCount(completionDetails, "reasoning_tokens"),
    providerCost:
      cost !== undefined && cost >= 0 && cost <= MAX_PROVIDER_COST
        ? cost
        : null,
  };
}

/**
 * True when choices[0].message.content is a string with non-whitespace text.
 * A whitespace-only answer counts as empty here: the crons reject it, and for
 * chat it is the same "the model said nothing" event.
 */
export function hasNonEmptyContent(data: Record<string, unknown>): boolean {
  const content = asPlainObject(firstChoice(data).message).content;
  return typeof content === "string" && content.trim() !== "";
}

/**
 * Maps one attempt to succeeded + error_class.
 *
 * `succeeded` means the route accepted the attempt as its answer, so it follows
 * each route's existing behavior rather than an ideal one: chat accepts a 2xx
 * with an unparseable body or empty content (it substitutes a fallback
 * message), the crons throw on both. The class is recorded either way.
 */
export function classifyLlmOutcome(input: {
  route: LlmRoute;
  httpStatus: number | null;
  threw: boolean;
  jsonParsed: boolean;
  contentPresent: boolean;
}): LlmOutcome {
  if (input.threw || input.httpStatus === null) {
    return { succeeded: false, errorClass: "network_error" };
  }

  const status = input.httpStatus;
  if (status >= 200 && status <= 299) {
    const acceptsDegraded = input.route === "chat";
    if (!input.jsonParsed) {
      return { succeeded: acceptsDegraded, errorClass: "invalid_json" };
    }
    if (!input.contentPresent) {
      return { succeeded: acceptsDegraded, errorClass: "empty_content" };
    }
    return { succeeded: true, errorClass: null };
  }

  if (status === 401 || status === 403) {
    return { succeeded: false, errorClass: "auth" };
  }
  if (status === 402) {
    return { succeeded: false, errorClass: "insufficient_credits" };
  }
  if (status === 429) {
    return { succeeded: false, errorClass: "rate_limited" };
  }
  if (status >= 400 && status <= 499) {
    return { succeeded: false, errorClass: "client_error" };
  }
  if (status >= 500 && status <= 599) {
    return { succeeded: false, errorClass: "provider_error" };
  }
  return { succeeded: false, errorClass: "unknown" };
}

/**
 * What a cron call has seen by the time it exits, set step by step inside the
 * call so a `finally` can build the row whichever way the call ended.
 * httpStatus stays null if fetch threw; data stays null unless the body parsed
 * as JSON.
 */
export interface ObservedLlmCall {
  httpStatus: number | null;
  jsonParsed: boolean;
  data: Record<string, unknown> | null;
}

export function buildCronLlmCallRow(input: {
  route: "cron_summarize" | "cron_extract_facts";
  requestModel: string;
  startedAtMs: number;
  latencyMs: number;
  userId: string;
  sessionId: string;
  observed: ObservedLlmCall;
}): LlmCallRow {
  const { observed } = input;
  const data = observed.jsonParsed ? observed.data : null;
  return buildLlmCallRow({
    route: input.route,
    attemptIndex: 1,
    requestModel: input.requestModel,
    startedAtMs: input.startedAtMs,
    latencyMs: input.latencyMs,
    userId: input.userId,
    sessionId: input.sessionId,
    httpStatus: observed.httpStatus,
    outcome: classifyLlmOutcome({
      route: input.route,
      httpStatus: observed.httpStatus,
      threw: observed.httpStatus === null,
      jsonParsed: observed.jsonParsed,
      contentPresent: data !== null && hasNonEmptyContent(data),
    }),
    meta: data !== null ? parseOpenRouterResponseMeta(data) : null,
    blocks: null,
  });
}

export function buildLlmCallRow(input: LlmCallInput): LlmCallRow {
  const meta = input.meta;
  const blocks = input.route === "chat" ? input.blocks : null;
  const status = input.httpStatus;

  return {
    // toISOString throws on an invalid date; this function must not throw.
    started_at: new Date(
      Number.isFinite(input.startedAtMs) ? input.startedAtMs : Date.now()
    ).toISOString(),
    route: input.route,
    attempt_index: input.attemptIndex,
    request_model: input.requestModel.slice(0, MAX_ID_LENGTH),
    response_model: meta ? meta.responseModel : null,
    generation_id: meta ? meta.generationId : null,
    succeeded: input.outcome.succeeded,
    http_status:
      status !== null && Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : null,
    error_class: input.outcome.errorClass,
    finish_reason: meta ? meta.finishReason : null,
    latency_ms: Number.isFinite(input.latencyMs)
      ? Math.max(0, Math.round(input.latencyMs))
      : 0,
    prompt_tokens: meta ? meta.promptTokens : null,
    completion_tokens: meta ? meta.completionTokens : null,
    cached_tokens: meta ? meta.cachedTokens : null,
    reasoning_tokens: meta ? meta.reasoningTokens : null,
    provider_cost: meta ? meta.providerCost : null,
    has_memory_block: blocks ? blocks.memory : null,
    has_plaid_scaffold_block: blocks ? blocks.plaidScaffold : null,
    has_balance_block: blocks ? blocks.balance : null,
    has_financial_snapshot_block: blocks ? blocks.financialSnapshot : null,
    user_id: input.userId,
    session_id: input.sessionId,
  };
}
