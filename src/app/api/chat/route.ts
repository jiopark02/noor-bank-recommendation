import { NextRequest, NextResponse } from "next/server";
import { generateSystemPrompt, UserContext } from "@/lib/noorAIPrompt";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { asPlainObject } from "@/lib/requestJson";
import { readRequestJsonWithByteLimit } from "@/lib/boundedRequestJson";
import {
  CHAT_MAX_BODY_BYTES,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_LAST_USER_MESSAGE_CHARS,
  windowChatMessages,
} from "@/lib/chatInputLimits";
import { buildModelConversation } from "@/lib/chatServerHistory";
import {
  isAiMemoryEnabled,
  getOrCreateActiveSession,
  getActiveSession,
  buildMemoryContext,
  formatMemoryForPrompt,
  saveMessages,
  saveSharedTurn,
  findSavedTurn,
  isSessionClosedError,
  getSessionMessages,
  getEarliestSharedSourceTime,
  SharedSourceEndedError,
  SharedTurnBusyError,
  type DbChatMessage,
  type ChatSession,
  type SharedTurnSource,
} from "@/lib/aiMemory";
import {
  resolvePlaidStateMode,
  resolvePlaidChatDepth,
  resolveSharedStateEnabled,
  isHouseholdTurn,
  buildPlaidCapabilityBlock,
  buildSharedBankBlock,
  SHARED_NOT_IN_TURN_BLOCK,
  maskPlaidBlockForLog,
  plaidBlockCarriesBalances,
} from "@/lib/plaidChatContext";
import {
  getPlaidChatState,
  listSharedForChat,
  readSharedForChat,
  SharedChatReadError,
  type SharedChatList,
  type SharedChatRead,
} from "@/lib/plaidChatState";
import { isPlaidTokenCryptoError } from "@/lib/plaidTokenCrypto";
import { logSafeCode } from "@/lib/householdInvite";
import {
  evaluatePlaidEgressDecision,
  logPlaidEgressDecision,
} from "@/lib/plaidEgressPolicy";
import {
  EMPTY_ASSISTANT_REPLY,
  readJsonBodyLeniently,
  toOpenRouterResult,
  type OpenRouterResult,
} from "@/lib/openRouterChatResult";
import {
  detectCrisisSignal,
  hasPriorCrisisSignal,
  type CrisisCategory,
} from "@/lib/crisisSignals";
import {
  CRISIS_NOTICES,
  composeCrisisReply,
  type CrisisVariant,
} from "@/lib/crisisNotice";
import { recordCrisisNotice } from "@/lib/crisisNoticeTally";
import {
  buildLlmCallRow,
  classifyLlmOutcome,
  hasNonEmptyContent,
  parseOpenRouterResponseMeta,
  type ChatPromptBlocks,
} from "@/lib/llmCallTelemetry";
import { recordLlmCall } from "@/lib/llmCallLog";
import { randomUUID } from "crypto";
import {
  buildUsageCheckUnavailableBody,
  buildUsageLimitBody,
  resolveChatUsageMode,
  retryAfterSeconds,
  settledCost,
} from "@/lib/chatUsageLimits";
import {
  ChatUsageCheckError,
  reserveChatUsage,
  settleChatUsage,
  type ChatUsageDecision,
} from "@/lib/chatUsageLedger";
import {
  OPENROUTER_URL,
  buildOpenRouterRequestBody,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterRequest";
import {
  CHAT_LLM_TIMEOUT_MS,
  CHAT_SAVE_DEADLINE_MS,
  CHAT_SAVE_READBACK_RESERVE_MS,
  ChatDeadlineError,
  chatHasBudgetForAnotherAttempt,
  chatPreLoopDeadlineMs,
  logLlmTimeout,
  runUntilDeadline,
} from "@/lib/llmTimeouts";

// Force dynamic rendering
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// The bank read goes through the shared bank adapter, whose cash-flow engine
// package uses node:crypto: this handler runs on the Node.js runtime, never
// the edge runtime.
export const runtime = "nodejs";

const DEFAULT_SIMPLE_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_COMPLEX_MODEL = "anthropic/claude-sonnet-4.6";

function isAiSupabaseReadEnabled(): boolean {
  return process.env.AI_SUPABASE_READ_ENABLED === "true";
}

function mapSupabaseContextToUserContext(data: {
  first_name?: string | null;
  last_name?: string | null;
  university?: string | null;
  institution_type?: string | null;
  has_us_credit_history?: boolean | null;
  monthly_income?: number | null;
  campus_side?: string | null;
  expected_monthly_spending?: number | null;
}): Partial<UserContext> {
  return {
    firstName: data.first_name ?? undefined,
    lastName: data.last_name ?? undefined,
    university: data.university ?? undefined,
    institutionType: data.institution_type ?? undefined,
    hasCreditHistory: data.has_us_credit_history ?? undefined,
    monthlyIncome: data.monthly_income ?? undefined,
    campusSide: data.campus_side ?? undefined,
    monthlySpending: data.expected_monthly_spending ?? undefined,
  };
}

/** True when the profile read below would query the database. */
function isProfileReadEnabled(): boolean {
  return isAiSupabaseReadEnabled() && isSupabaseAdminConfigured();
}

/**
 * The signal cancels both queries. A cancelled query answers like a failed
 * one, with no data, and this function then returns a profile with nothing
 * in it; a caller that cancels must not use the result.
 */
async function loadReadOnlyUserContextFromSupabase(
  userId: string,
  signal: AbortSignal
): Promise<Partial<UserContext>> {
  if (!isProfileReadEnabled()) {
    return {};
  }

  const supabaseAdmin = createAdminClient();

  const [{ data: userRow }, { data: surveyRow }] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("first_name,last_name")
      .eq("id", userId)
      .abortSignal(signal)
      .maybeSingle(),
    supabaseAdmin
      .from("survey_responses")
      .select(
        "university,institution_type,has_us_credit_history,monthly_income,campus_side,expected_monthly_spending"
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .abortSignal(signal)
      .maybeSingle(),
  ]);

  return mapSupabaseContextToUserContext({
    first_name: userRow?.first_name,
    last_name: userRow?.last_name,
    university: surveyRow?.university,
    institution_type: surveyRow?.institution_type,
    has_us_credit_history: surveyRow?.has_us_credit_history,
    monthly_income: surveyRow?.monthly_income,
    campus_side: surveyRow?.campus_side,
    expected_monthly_spending: surveyRow?.expected_monthly_spending,
  });
}

function normalizeOpenRouterModelId(model: string): string {
  const trimmed = model.trim();

  // Normalize shorthand aliases to current OpenRouter model IDs.
  const ALIASES: Record<string, string> = {
    "gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
    "gemini-2.5-flash": "google/gemini-2.5-flash",
    "claude-sonnet-4.6": "anthropic/claude-sonnet-4.6",
    "claude-haiku-4.5": "anthropic/claude-haiku-4.5",
    // Legacy aliases kept for backward compat — redirect to current equivalents.
    "gemini-2.0-flash": "google/gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite": "google/gemini-2.5-flash-lite",
  };

  return ALIASES[trimmed] ?? trimmed;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function parseChatMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const o = asPlainObject(item);
    if (o.role !== "user" && o.role !== "assistant") {
      return null;
    }
    if (typeof o.content !== "string") {
      return null;
    }
    out.push({ role: o.role, content: o.content });
  }
  return out.length > 0 ? out : null;
}

function getLastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i].content || "";
    }
  }
  return "";
}

function isSimpleGreetingOrSmallTalk(message: string): boolean {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[!.,?]+/g, "")
    .replace(/\s+/g, " ");

  if (!normalized) return false;

  const exactGreetings = new Set([
    "hi",
    "hello",
    "hey",
    "hiya",
    "howdy",
    "yo",
    "sup",
    "good morning",
    "good afternoon",
    "good evening",
    "how are you",
    "how are you doing",
    "whats up",
    "what's up",
    "thanks",
    "thank you",
    "ok",
    "okay",
  ]);

  if (exactGreetings.has(normalized)) return true;

  if (normalized.length <= 20) {
    return /^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(normalized);
  }

  return false;
}

function isBalanceQuestion(message: string): boolean {
  const normalized = message.toLowerCase();

  const signals = [
    "balance",
    "my balance",
    "how much do i have",
    "how much money",
    "available balance",
    "current balance",
    "account balance",
    "checking balance",
  ];

  return signals.some((signal) => normalized.includes(signal));
}

function isFinancialPlanningQuestion(message: string): boolean {
  const normalized = message.toLowerCase();

  const signals = [
    "can i afford",
    "should i buy",
    "on track",
    "broke",
    "save more",
    "what do i do",
    "spending cap",
    "budget",
    "subscription",
    "recurring",
    "cash flow",
    "payday",
    "rent due",
    "tax refund",
    "unexpected expense",
  ];

  return signals.some((signal) => normalized.includes(signal));
}

/**
 * What kind of failure ended the bank-state read, for its log line: a cause
 * and a code, never the error's message. The connection read's failure is
 * recognized by its name (PlaidConnectionReadError, plaidChatState.ts) rather
 * than by instanceof, so this never throws inside the fail-open catch that
 * calls it, whatever the error is.
 */
function plaidReadFailure(error: unknown): { cause: string; reason: string } {
  if (isPlaidTokenCryptoError(error)) {
    return { cause: "decrypt", reason: error.reason };
  }
  if (error instanceof Error && error.name === "PlaidConnectionReadError") {
    const code = (error as { code?: unknown }).code;
    return {
      cause: "db_read",
      reason: typeof code === "string" && code !== "" ? code : "none",
    };
  }
  return { cause: "unknown", reason: "none" };
}

/**
 * The code for a failed read of what another member shares, for its log
 * line: the stage and the database's code when the shared-connections
 * function failed, otherwise "unknown". Never the error's message.
 */
function sharedReadFailureCode(error: unknown): string {
  if (error instanceof SharedChatReadError) {
    return `${error.stage}:${logSafeCode(error.code)}`;
  }
  return "unknown";
}

/** The sharing members' first names, as read, for the household-turn check. */
function ownerFirstNames(list: SharedChatList | null): Array<string | null> {
  if (list === null) return [];
  return Object.keys(list.firstNames).map((owner) => list.firstNames[owner]);
}

function isComplexPrompt(message: string): boolean {
  const normalized = message.toLowerCase();

  if (message.length > 350) {
    return true;
  }

  const complexitySignals = [
    "compare",
    "tradeoff",
    "step by step",
    "tax",
    "budget plan",
    "scenario",
    "strategy",
    "explain in detail",
    "edge case",
    "regulation",
  ];

  return complexitySignals.some((signal) => normalized.includes(signal));
}

function dedupeModels(models: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const model of models) {
    const trimmed = normalizeOpenRouterModelId(model);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }

  return unique;
}

function selectOpenRouterModels(messages: ChatMessage[]): string[] {
  const configuredPrimary = process.env.OPENROUTER_MODEL?.trim();
  const configuredFallback = process.env.OPENROUTER_FALLBACK_MODEL?.trim();

  if (configuredPrimary) {
    return dedupeModels([
      configuredPrimary,
      configuredFallback || DEFAULT_COMPLEX_MODEL,
    ]);
  }

  const lastUserMessage = getLastUserMessage(messages);
  const complex = isComplexPrompt(lastUserMessage);

  const simpleModel =
    process.env.OPENROUTER_SIMPLE_MODEL?.trim() || DEFAULT_SIMPLE_MODEL;
  const complexModel =
    process.env.OPENROUTER_COMPLEX_MODEL?.trim() || DEFAULT_COMPLEX_MODEL;

  const primaryModel = complex ? complexModel : simpleModel;
  const fallbackModel =
    configuredFallback || (complex ? simpleModel : complexModel);

  return dedupeModels([primaryModel, fallbackModel]);
}

interface ChatLlmCallContext {
  attemptIndex: number;
  userId: string;
  sessionId: string | null;
  blocks: ChatPromptBlocks;
  /**
   * The chat usage tally: each attempt appends its reported cost, or null when
   * it has none, and the request is settled from it (chatUsageLimits.ts).
   */
  tally: Array<number | null>;
}

/**
 * Thrown by callOpenRouter when the request body could not be built. The
 * original error is its cause; its own message says nothing about it. The
 * model loop logs its name, and the cause code it finds on the original error
 * when that code is in the expected form (networkCauseCode), never a message.
 */
class ChatRequestBuildError extends Error {
  constructor(cause: unknown) {
    super("chat request body could not be built", { cause });
    this.name = "ChatRequestBuildError";
    // ES5 target: keep instanceof working on the subclass.
    Object.setPrototypeOf(this, ChatRequestBuildError.prototype);
  }
}

/**
 * One OpenRouter attempt. Every exit records one llm_calls row first.
 *
 * recordLlmCall never rejects (llmCallLog.ts), so the row write cannot replace
 * a thrown fetch error or alter the returned result. A fetch that throws is
 * rethrown unchanged; POST's model loop catches it and moves on to the next
 * model, which starts only within the request budget (llmTimeouts.ts).
 *
 * The attempt is cut off after CHAT_LLM_TIMEOUT_MS. A timeout before the
 * response arrives makes fetch throw, which takes the path above. A timeout
 * while the body is still being read is not left to readJsonBodyLeniently,
 * which would turn the cut-off body into an empty success and a stored
 * "could not generate a response" turn; it is recorded as a failed attempt and
 * thrown the same way.
 *
 * The request body is built before fetch is called. When building it throws
 * — an error in our own code, before anything is sent — the attempt is
 * recorded and counted exactly as a fetch that throws, and what is thrown is
 * a ChatRequestBuildError carrying the original error as its cause, so the
 * model loop's log line can tell it from a network failure.
 */
async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  telemetry: ChatLlmCallContext
): Promise<OpenRouterResult> {
  const startedAtMs = Date.now();
  const signal = AbortSignal.timeout(CHAT_LLM_TIMEOUT_MS);
  let res: Response;
  try {
    let requestBody: string;
    try {
      requestBody = JSON.stringify(
        buildOpenRouterRequestBody({ model, messages, maxTokens: 1024 })
      );
    } catch (error) {
      // Rethrown to the catch below, which records the attempt.
      throw new ChatRequestBuildError(error);
    }
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
    });
  } catch (error) {
    await recordLlmCall(
      buildLlmCallRow({
        route: "chat",
        attemptIndex: telemetry.attemptIndex,
        requestModel: model,
        startedAtMs,
        latencyMs: Date.now() - startedAtMs,
        userId: telemetry.userId,
        sessionId: telemetry.sessionId,
        httpStatus: null,
        outcome: classifyLlmOutcome({
          route: "chat",
          httpStatus: null,
          threw: true,
          jsonParsed: false,
          contentPresent: false,
        }),
        meta: null,
        blocks: telemetry.blocks,
      })
    );
    telemetry.tally.push(null);
    if (signal.aborted) logLlmTimeout("chat", model, CHAT_LLM_TIMEOUT_MS);
    throw error;
  }

  const { data, jsonParsed } = await readJsonBodyLeniently(res);
  if (!jsonParsed && signal.aborted) {
    await recordLlmCall(
      buildLlmCallRow({
        route: "chat",
        attemptIndex: telemetry.attemptIndex,
        requestModel: model,
        startedAtMs,
        latencyMs: Date.now() - startedAtMs,
        userId: telemetry.userId,
        sessionId: telemetry.sessionId,
        httpStatus: res.status,
        outcome: classifyLlmOutcome({
          route: "chat",
          httpStatus: res.status,
          threw: true,
          jsonParsed: false,
          contentPresent: false,
        }),
        meta: null,
        blocks: telemetry.blocks,
      })
    );
    telemetry.tally.push(null);
    logLlmTimeout("chat", model, CHAT_LLM_TIMEOUT_MS);
    throw new Error("OpenRouter response timed out while being read");
  }

  const result = toOpenRouterResult({
    ok: res.ok,
    status: res.status,
    data,
    model,
  });

  telemetry.tally.push(
    jsonParsed ? parseOpenRouterResponseMeta(data).providerCost : null
  );
  await recordLlmCall(
    buildLlmCallRow({
      route: "chat",
      attemptIndex: telemetry.attemptIndex,
      requestModel: model,
      startedAtMs,
      latencyMs: Date.now() - startedAtMs,
      userId: telemetry.userId,
      sessionId: telemetry.sessionId,
      httpStatus: res.status,
      outcome: classifyLlmOutcome({
        route: "chat",
        httpStatus: res.status,
        threw: false,
        jsonParsed,
        contentPresent: hasNonEmptyContent(data),
      }),
      meta: jsonParsed ? parseOpenRouterResponseMeta(data) : null,
      blocks: telemetry.blocks,
    })
  );

  return result;
}

/**
 * Identifies errors that are temporary and likely to succeed on retry.
 *
 * Retryable (returns true):
 *   - Postgres SQLSTATE class 08 (Connection Exception)
 *   - Postgres SQLSTATE class 53 (Insufficient Resources)
 *   - Postgres SQLSTATE class 57 (Operator Intervention)
 *   - Network errors: ETIMEDOUT, ECONNRESET
 *   - HTTP gateway errors: 502, 503, 504
 *
 * NOT retryable: 23xxx constraint violations, auth errors, 4xx HTTP.
 *
 * Checks both error itself and Error.cause (one level) to support
 * wrapDbError-style wrapped errors.
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidates: Array<{ code?: string; message?: string; status?: number }> =
    [error as { code?: string; message?: string; status?: number }];
  if (error instanceof Error && error.cause && typeof error.cause === "object") {
    candidates.push(
      error.cause as { code?: string; message?: string; status?: number }
    );
  }

  for (const c of candidates) {
    if (c.code && /^(08|53|57)/.test(c.code)) return true;
    if (c.code === "ETIMEDOUT" || c.code === "ECONNRESET") return true;
    if (typeof c.status === "number" && c.status >= 502 && c.status <= 504) {
      return true;
    }
    if (typeof c.message === "string") {
      if (
        c.message.includes("fetch failed") ||
        c.message.includes("network") ||
        c.message.includes("timeout")
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Throws ChatDeadlineError when the wait this operation belongs to has
 * already been cut at its deadline. isRetryableError does not treat that
 * error as transient, so withRetry does not start the operation again.
 */
function notCut(signal: AbortSignal, stage: string): void {
  if (signal.aborted) throw new ChatDeadlineError(stage);
}

/**
 * Runs an async operation with one retry on transient failures.
 * Adds ~250ms delay before retry.
 *
 * ⚠️ DO NOT use this around writes that are not safe to send twice, such as
 * saveMessages. The first call may have committed before it failed, and a
 * second insert of the same pair then fails on its ids instead of telling the
 * caller the turn is stored; persistTurnIfEnabled asks by id instead.
 * Use only for reads and idempotent writes (e.g., getOrCreateActiveSession).
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableError(error)) throw error;

    console.warn(
      `[retry] ${context}: transient error, retrying once:`,
      error instanceof Error ? error.message : error
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    try {
      const result = await operation();
      console.info(`[retry] ${context}: recovered after retry`);
      return result;
    } catch (retryError) {
      console.error(
        `[retry] ${context}: failed after retry:`,
        retryError instanceof Error ? retryError.message : retryError
      );
      throw retryError;
    }
  }
}

interface ClientChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  model?: string;
}

function toClientChatMessage(row: DbChatMessage): ClientChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.created_at,
    model: row.model ?? undefined,
  };
}

/**
 * Persists a user+assistant turn to chat history if AI memory is enabled
 * and an active session exists.
 *
 * Skip vs throw policy:
 *   - Memory disabled OR no active session → silent skip (no-op)
 *   - Memory enabled AND session exists AND content empty → throw
 *   - Memory enabled AND session exists AND content non-empty → saveMessages
 *
 * The "empty content throws" rule prevents silent "200 OK but DB has 0 turns"
 * which would break the data-consistency guarantee.
 *
 * HOW THE TURN IS STORED
 * The ids of the two rows are chosen here, before anything is sent, so the
 * route can always find out afterwards whether the pair is stored.
 *
 * 1. Insert, no later than the save deadline less the read-back reserve
 *    (llmTimeouts.ts). An insert still running then is cancelled.
 * 2. If the session turns out to be closed (the summarize cron closed it
 *    while this request was running), nothing was stored: the user's active
 *    session is fetched again, or created, and the same pair is inserted
 *    there with the same ids. This happens at most once per save, inside the
 *    same deadline as step 1.
 * 3. If the insert ended in any error or at its deadline, the route does not
 *    know whether the statement was stored. It asks once, by the two ids, no
 *    later than the save deadline: both rows there is a saved turn, anything
 *    else — a row missing, a failed or unanswered lookup — is a failed save.
 *    A cancelled insert can still be stored after that lookup has answered
 *    "missing"; the route then reports a failed save for a turn that exists.
 *
 * Apart from step 2, an insert is never sent twice. Callers should catch and
 * translate a throw to an HTTP error response.
 *
 * A TURN THAT CARRIED SHARED BANK DATA
 * When `sharedSources` is not empty, another household member's bank data was
 * in this turn's prompt, and every insert above is a call of saveSharedTurn
 * instead of saveMessages: it records those connections and stores the pair
 * together, under the locks the purge takes, and only while each connection
 * is still shared. Step 2 is the same, with the same sources for the new
 * session. Two of its errors say for certain that nothing was stored, so
 * they are thrown at once, without the lookup of step 3:
 * SharedSourceEndedError (a connection is no longer shared) and
 * SharedTurnBusyError (a lock the save needs was held elsewhere twice).
 *
 * @returns The id of the session the turn was stored in, or null when
 *   nothing was to be stored.
 * @throws Error when persistence is expected but content is empty, or when
 *   the turn could not be stored or confirmed stored.
 */
async function persistTurnIfEnabled(params: {
  activeSession: ChatSession | null;
  authUserId: string;
  userContent: string;
  assistantContent: string;
  assistantModel: string;
  inputTokens?: number;
  outputTokens?: number;
  requestStartedAtMs: number;
  /** Connections whose shared data was in this turn's prompt; may be empty. */
  sharedSources: SharedTurnSource[];
}): Promise<string | null> {
  if (!isAiMemoryEnabled()) return null;
  if (!params.activeSession) return null;

  if (!params.userContent.trim() || !params.assistantContent.trim()) {
    throw new Error(
      "persistTurnIfEnabled: cannot persist empty user or assistant content " +
        "(memory is enabled but content is missing)"
    );
  }

  const firstSessionId = params.activeSession.id;
  const userId = params.authUserId;
  const pair = {
    userContent: params.userContent,
    assistantContent: params.assistantContent,
    assistantModel: params.assistantModel,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
  };
  const ids = { user: randomUUID(), assistant: randomUUID() };
  const readBackDeadlineAtMs =
    params.requestStartedAtMs + CHAT_SAVE_DEADLINE_MS;
  const insertDeadlineAtMs =
    readBackDeadlineAtMs - CHAT_SAVE_READBACK_RESERVE_MS;
  // For the [chat-save] line. sessionClosed: the first insert found the
  // session closed. switched: the open session was read and the second
  // insert is about to be sent to it. A session found closed whose re-read
  // then failed or ran out of time has the first without the second.
  let sessionClosed = false;
  let switched = false;
  const logSave = (outcome: string, level: "info" | "warn"): void => {
    console[level](
      "[chat-save] outcome=%s session_closed=%s switched=%s",
      outcome,
      sessionClosed,
      switched
    );
  };

  const sources = params.sharedSources;
  const insert = (sessionId: string, signal: AbortSignal): Promise<unknown> =>
    sources.length > 0
      ? saveSharedTurn(sessionId, userId, pair, sources, { ids, signal })
      : saveMessages(sessionId, userId, pair, { ids, signal });

  try {
    const savedSessionId = await runUntilDeadline(
      insertDeadlineAtMs,
      "save",
      async (signal) => {
        try {
          await insert(firstSessionId, signal);
          return firstSessionId;
        } catch (error) {
          if (!isSessionClosedError(error)) throw error;
          sessionClosed = true;
        }
        // The session is closed and nothing was stored. The session read
        // takes no signal, so check before and after it that this save has
        // not been cut meanwhile.
        notCut(signal, "save");
        const session = await getOrCreateActiveSession(userId);
        notCut(signal, "save");
        switched = true;
        await insert(session.id, signal);
        return session.id;
      }
    );
    logSave("inserted", "info");
    return savedSessionId;
  } catch (error) {
    // Nothing was stored, for certain: no lookup by id.
    if (error instanceof SharedSourceEndedError) {
      logSave("shared_ended", "warn");
      throw error;
    }
    if (error instanceof SharedTurnBusyError) {
      logSave("shared_busy", "warn");
      throw error;
    }
    let confirmedSessionId: string | null = null;
    try {
      confirmedSessionId = await runUntilDeadline(
        readBackDeadlineAtMs,
        "save_readback",
        (signal) => findSavedTurn(userId, ids, { signal })
      );
    } catch {
      // A lookup that fails or is still running at the deadline confirms
      // nothing.
    }
    if (confirmedSessionId !== null) {
      logSave("confirmed_by_readback", "info");
      return confirmedSessionId;
    }
    logSave("failed", "warn");
    throw error;
  }
}

/**
 * The response to a request whose model attempts all failed, whichever way
 * each one failed: a provider status, a rejected key, a rate limit, a timeout
 * or a network error. It says nothing about the provider: no upstream status
 * and no upstream error text reach the client. What failed is recorded per
 * attempt, in llm_calls and in the [chat-model] log line.
 */
const CHAT_MODEL_FAILED_BODY = {
  error: "Chat is temporarily unavailable. Please try again.",
  code: "CHAT_MODEL_FAILED",
} as const;
const CHAT_MODEL_FAILED_STATUS = 502;

const NETWORK_CAUSE_CODE_PATTERN = /^[A-Z0-9_]{1,32}$/;

/**
 * The code on a thrown error's cause, or "none". For a fetch that failed, that
 * is the network error's code (ECONNRESET, ENOTFOUND and the like); for a
 * ChatRequestBuildError, it is the code of the error the request builder
 * threw, if that error has one. Only a string made of capitals, digits and
 * underscores, at most 32 characters long, is returned: anything else, a
 * message included, is "none". The error's own message and its cause's
 * message are never read.
 */
function networkCauseCode(error: unknown): string {
  try {
    const cause = (error as { cause?: unknown } | null | undefined)?.cause;
    const code = (cause as { code?: unknown } | null | undefined)?.code;
    return typeof code === "string" && NETWORK_CAUSE_CODE_PATTERN.test(code)
      ? code
      : "none";
  } catch {
    return "none";
  }
}

const ERROR_NAME_PATTERN = /^[A-Za-z0-9_]{1,40}$/;

/**
 * The name of a thrown error (TypeError, TimeoutError, ChatRequestBuildError
 * and the like), or "none". Only a string made of letters, digits and
 * underscores, at most 40 characters long, is returned: anything else is
 * "none". The error's message is never read.
 *
 * Together with the cause code it tells apart failures the kind alone does
 * not: a timeout before a response (TimeoutError), a timeout while the body
 * was being read (Error), a request body our code could not build
 * (ChatRequestBuildError) and a network failure (TypeError, with a cause code
 * only when the runtime puts one on it).
 */
function errorName(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null | undefined)?.name;
    return typeof name === "string" && ERROR_NAME_PATTERN.test(name)
      ? name
      : "none";
  } catch {
    return "none";
  }
}

/**
 * The code of a thrown error, or of the database error it wraps as its cause,
 * for a log line: through logSafeCode, so only a short word of letters,
 * digits and underscores, else "none" or "invalid". The error itself is never
 * logged: a database error's message and details can carry the row it
 * refused, and a chat row's content can carry bank figures.
 */
function errorCodeForLog(error: unknown): string {
  try {
    const own = (error as { code?: unknown } | null | undefined)?.code;
    if (typeof own === "string" && own !== "") return logSafeCode(own);
    const cause = (error as { cause?: unknown } | null | undefined)?.cause;
    return logSafeCode((cause as { code?: unknown } | null | undefined)?.code);
  } catch {
    return "none";
  }
}

/**
 * One line per failed model attempt: the attempt's number, its kind (the
 * error class llm_calls records for it), the upstream HTTP status, and, for
 * an attempt that threw, the cause code (see networkCauseCode) and the
 * error's name. The
 * status is "none" for an attempt that threw, whether before a response
 * arrived or while its body was being read; the cause and the name are "none"
 * for an attempt that did not throw, and whenever networkCauseCode or
 * errorName found nothing in the expected form. Never the provider's error
 * text and never the thrown error's message.
 */
function logFailedModelAttempt(
  attemptIndex: number,
  upstreamStatus: number | null,
  causeCode: string = "none",
  thrownName: string = "none"
): void {
  const kind = classifyLlmOutcome({
    route: "chat",
    httpStatus: upstreamStatus,
    threw: upstreamStatus === null,
    jsonParsed: false,
    contentPresent: false,
  }).errorClass;
  console.warn(
    "[chat-model] attempt failed attempt=%d kind=%s upstream_status=%s cause=%s name=%s",
    attemptIndex,
    kind ?? "unknown",
    upstreamStatus === null ? "none" : String(upstreamStatus),
    causeCode,
    thrownName
  );
}

/**
 * The response body as given, plus a crisisNotice field when there is a
 * notice. Without one the body is unchanged: no crisisNotice key at all.
 */
function jsonWithCrisisNotice(
  body: object,
  notice: string | null,
  init?: ResponseInit
): NextResponse {
  return NextResponse.json(
    notice === null ? body : { ...body, crisisNotice: notice },
    init
  );
}

/**
 * The response to a request that ran out of time before a model attempt could
 * start: either no attempt fitted in the request budget, or a wait before the
 * model loop was still running at the pre-loop deadline.
 */
const CHAT_TIME_BUDGET_EXHAUSTED_BODY = {
  error: "Chat is taking longer than usual. Please try again.",
  code: "CHAT_TIME_BUDGET_EXHAUSTED",
} as const;

/** The waits a request can make around the model loop, as named in the log. */
type ChatStage =
  | "auth"
  | "body"
  | "profile"
  | "session"
  | "memory"
  | "plaid_state"
  | "shared_list"
  | "shared_state"
  | "save";

export async function POST(request: NextRequest) {
  const requestStartedAtMs = Date.now();
  // Every wait before the model loop ends at this moment at the latest
  // (llmTimeouts.ts). A wait that is still running then is cut, and the
  // request answers 503 CHAT_TIME_BUDGET_EXHAUSTED from the outer catch,
  // whatever that wait does with an ordinary failure: a request cut at the
  // deadline never reaches the model, so it never reaches it with a block
  // missing from the prompt.
  const preLoopDeadlineAtMs = requestStartedAtMs + chatPreLoopDeadlineMs();
  // How long each wait took, for the one [chat-stages] line in the finally.
  // -1 means the request did not make that wait.
  // Durations only. No user, session, or content fields.
  const stageMs: Record<ChatStage, number> = {
    auth: -1,
    body: -1,
    profile: -1,
    session: -1,
    memory: -1,
    plaid_state: -1,
    shared_list: -1,
    shared_state: -1,
    save: -1,
  };
  const timed = async <T>(
    stage: ChatStage,
    run: () => Promise<T>
  ): Promise<T> => {
    const startedAtMs = Date.now();
    try {
      return await run();
    } finally {
      stageMs[stage] = Date.now() - startedAtMs;
    }
  };
  const beforeLoop = <T>(
    stage: Exclude<ChatStage, "save">,
    fn: (signal: AbortSignal) => PromiseLike<T> | T
  ): Promise<T> =>
    timed(stage, () => runUntilDeadline(preLoopDeadlineAtMs, stage, fn));
  // The chat usage reservation this request holds, if any, and the per-attempt
  // costs it is settled from in the finally below, on every exit.
  let usageReservation: { reservationId: string; userId: string } | null =
    null;
  const usageTally: Array<number | null> = [];
  // Crisis notice (crisisSignals.ts, crisisNotice.ts): detected once the body
  // has parsed. Every response after that goes through respond(), which
  // attaches the fixed notice only when a signal was detected, so the notice
  // reaches the user on refusals and errors as well as on a model reply.
  // Declared outside the try so the outer catch answers through respond().
  let crisis: CrisisCategory | null = null;
  let crisisVariant: CrisisVariant = "standard";
  let crisisDelivered = false;
  const crisisNotice = (): string | null =>
    crisis ? CRISIS_NOTICES[crisis][crisisVariant] : null;
  const respond = (
    body: object,
    init?: ResponseInit
  ): NextResponse => {
    const notice = crisisNotice();
    if (notice !== null) crisisDelivered = true;
    return jsonWithCrisisNotice(body, notice, init);
  };
  try {
    const authUserId = await beforeLoop("auth", () =>
      getAuthenticatedUserIdFromRequest(request)
    );
    if (!authUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Input bounds (chatInputLimits.ts): refuse or trim the request BEFORE the
    // usage reservation, any DB read, Plaid fetch, or LLM call, so a refused
    // request costs nothing beyond authentication. The body is read with a
    // byte ceiling and its conversation is checked against the message and
    // character limits. Only its last user message is used below: the model's
    // history is read from the stored session, never taken from the body.
    const bodyRead = await beforeLoop("body", () =>
      readRequestJsonWithByteLimit(request, CHAT_MAX_BODY_BYTES)
    );
    if (bodyRead.kind === "too_large") {
      console.warn("[chat-input] refused reason=%s", "payload_too_large");
      return NextResponse.json(
        {
          error:
            "This conversation is too large to send. Please clear the chat and try again.",
          code: "PAYLOAD_TOO_LARGE",
        },
        { status: 413 }
      );
    }
    const bodyObj = asPlainObject(bodyRead.value);
    const parsedMessages = parseChatMessages(bodyObj.messages);
    if (!parsedMessages) {
      console.warn("[chat-input] refused reason=%s", "malformed_body");
      return NextResponse.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }
    // Before the window: a refusal for length still carries the notice. The
    // window keeps the last user message as it is, so this is the same text
    // as lastUserMessageText below.
    crisis = detectCrisisSignal(getLastUserMessage(parsedMessages));
    const chatWindow = windowChatMessages(parsedMessages);
    if (!chatWindow.ok) {
      console.warn("[chat-input] refused reason=%s", chatWindow.reason);
      // One code for all three reasons; the message says which one it was.
      const windowRefusalMessages: Record<typeof chatWindow.reason, string> = {
        last_user_message_too_long: `Your message is too long. Please keep it to at most ${CHAT_MAX_LAST_USER_MESSAGE_CHARS} characters.`,
        tail_too_long:
          "This conversation has too much text after your latest message. Please clear the chat and try again.",
        empty_window:
          "There is no message to send. Please type a question and try again.",
      };
      return respond(
        {
          error: windowRefusalMessages[chatWindow.reason],
          code: "MESSAGE_TOO_LONG",
        },
        { status: 400 }
      );
    }
    if (chatWindow.dropped > 0) {
      console.info(
        "[chat-input] trimmed kept=%d dropped=%d",
        chatWindow.messages.length,
        chatWindow.dropped
      );
    }
    // A body without a user message has nothing to send to the model.
    if (!chatWindow.messages.some((msg) => msg.role === "user")) {
      console.warn("[chat-input] refused reason=%s", "no_user_message");
      return respond(
        { error: "Messages are required" },
        { status: 400 }
      );
    }
    const lastUserMessageText = getLastUserMessage(chatWindow.messages);
    // A blank message would reserve usage and call the model for nothing.
    if (lastUserMessageText.trim() === "") {
      console.warn("[chat-input] refused reason=%s", "empty_message");
      return respond(
        {
          error: "Please type a message before sending.",
          code: "EMPTY_MESSAGE",
        },
        { status: 400 }
      );
    }

    // Chat usage limit (chatUsageLimits.ts, chatUsageLedger.ts): after the
    // input limits and BEFORE any profile read, memory, Plaid fetch or model
    // call, so a refused request costs nothing. chat_usage_reserve decides
    // and records the request in one transaction. Under enforce a hit limit is
    // 429 and a check that cannot be made is 503 (fail-closed); under observe
    // the request proceeds whatever the decision; off makes no call.
    const usageMode = resolveChatUsageMode(process.env.CHAT_USAGE_LIMIT_MODE);
    if (usageMode !== "off") {
      const reservationId = randomUUID();
      let usageDecision: ChatUsageDecision | null = null;
      try {
        usageDecision = await reserveChatUsage({
          reservationId,
          userId: authUserId,
          mode: usageMode,
        });
      } catch (error) {
        // A reserve that timed out may still have committed its row, so it
        // is settled in the finally like any other.
        usageReservation = { reservationId, userId: authUserId };
        console.error(
          "[chat-usage] check failed mode=%s reason=%s code=%s",
          usageMode,
          error instanceof ChatUsageCheckError ? error.reason : "unknown",
          error instanceof ChatUsageCheckError ? error.code : null
        );
        if (usageMode === "enforce") {
          return respond(buildUsageCheckUnavailableBody(), {
            status: 503,
          });
        }
      }
      if (usageDecision) {
        console.info(
          "[chat-usage] mode=%s allowed=%s limit=%s reservation=%s",
          usageMode,
          usageDecision.allowed,
          usageDecision.limit,
          reservationId
        );
        if (!usageDecision.allowed && usageMode === "enforce") {
          // Refused under enforce: chat_usage_reserve recorded no row.
          return respond(
            buildUsageLimitBody(usageDecision.limit, usageDecision.retryAt),
            {
              status: 429,
              headers: {
                "Retry-After": String(
                  retryAfterSeconds(usageDecision.retryAt, Date.now())
                ),
              },
            }
          );
        }
        usageReservation = { reservationId, userId: authUserId };
      }
    }

    let activeSession: ChatSession | null = null;
    let memoryBlock = "";
    let storedHistory: DbChatMessage[] = [];
    let historySource: "server" | "none" = "none";

    // With the profile read off there is nothing to wait for, so the request
    // makes no profile wait at all.
    const dbContext: Partial<UserContext> = isProfileReadEnabled()
      ? await beforeLoop("profile", (signal) =>
          loadReadOnlyUserContextFromSupabase(authUserId, signal)
        )
      : {};

    if (isAiMemoryEnabled()) {
      try {
        // The session read and the memory reads take no signal, so the
        // deadline only stops the request waiting for them. notCut keeps
        // withRetry from starting a read again once the wait has been cut.
        const session = await beforeLoop("session", (signal) =>
          withRetry(() => {
            notCut(signal, "session");
            return getOrCreateActiveSession(authUserId);
          }, "getOrCreateActiveSession")
        );
        activeSession = session;

        // The model's history is this session's stored turns: the session
        // this turn is saved into, not a second lookup of the active session.
        // Read newest first so the limit keeps the latest rows.
        const [memoryContext, recentRows] = await beforeLoop(
          "memory",
          (signal) =>
            Promise.all([
              withRetry(() => {
                notCut(signal, "memory");
                return buildMemoryContext(authUserId, {
                  activeSession: session,
                });
              }, "buildMemoryContext"),
              withRetry(() => {
                notCut(signal, "memory");
                return getSessionMessages(session.id, authUserId, {
                  limit: CHAT_MAX_HISTORY_MESSAGES,
                  order: "desc",
                });
              }, "getSessionMessages (history)"),
            ])
        );

        memoryBlock = formatMemoryForPrompt(memoryContext);
        storedHistory = recentRows.reverse();
        historySource = "server";
        // Escalate on a signal of the same category in this session's stored
        // user turns only, never in the history the request body carries.
        if (crisis && hasPriorCrisisSignal(storedHistory, crisis)) {
          crisisVariant = "escalated";
        }
      } catch (error) {
        // A wait cut at the deadline is not a memory failure: it goes to the
        // outer catch, which answers it as the time budget.
        if (error instanceof ChatDeadlineError) throw error;
        console.error(
          "[chat-memory] load failed name=%s code=%s",
          errorName(error),
          errorCodeForLog(error)
        );
        return respond(
          {
            error: "Memory system temporarily unavailable. Please try again.",
            code: "MEMORY_LOAD_FAILED",
          },
          { status: 503 }
        );
      }
    }

    // SECURITY (prompt injection): The client-supplied `userContext` in the
    // request body was previously spread over `dbContext`, letting the client
    // override server-side profile values. Those values are interpolated raw
    // (no escaping) into the system prompt under "## Current User Context" via
    // generateSystemPrompt, so a crafted field (e.g. firstName containing
    // newlines + markdown headers) could inject attacker-controlled text into
    // the model's instruction context. The client only ever re-sends the same
    // 9 profile fields the server already reads from the DB (users +
    // survey_responses), so the body value is redundant. We ignore it entirely
    // and trust only the server-side DB read. Do NOT reintroduce a client
    // patch here without per-field whitelisting + sanitization and a real need.
    const mergedUserContext: UserContext = dbContext;

    // The conversation after the system prompt: stored turns, then the
    // current user message. With memory off there are no stored turns, so the
    // model receives the system prompt and this one message.
    const modelConversation = buildModelConversation(
      storedHistory,
      lastUserMessageText
    );
    console.info(
      "[chat-history] source=%s stored=%d kept=%d dropped=%d",
      historySource,
      modelConversation.stored,
      modelConversation.kept,
      modelConversation.dropped
    );
    if (modelConversation.windowRefused) {
      console.warn("[chat-history] window refused; sending the current message only");
    }
    // A short message with a crisis signal ("hi i want to die") is not a
    // greeting: the greeting block would ask for 1-2 sentences.
    const isGreeting =
      crisis === null && isSimpleGreetingOrSmallTalk(lastUserMessageText);
    const wantsBalance =
      !isGreeting && isBalanceQuestion(lastUserMessageText);
    const wantsFinancialAnalysis =
      !isGreeting && isFinancialPlanningQuestion(lastUserMessageText);

    // Bank data for the model. AI_PLAID_STATE = off | connection | balances.
    // The user's own banks are read in one place, getPlaidChatState, inside
    // the capability scaffold's branch; "off" denies that channel, so nothing
    // is read. The banks another household member shares are read in one
    // place too, readSharedForChat, inside the same branch and only when the
    // household-shared channel allows the turn (which "off" also denies); that
    // channel raises the user's own read to depth "balances". The
    // balance-keyword channel reads nothing itself: when it allows a turn
    // (mode "connection" and a balance question) that read goes to depth
    // "balances". The financial-analysis channel only has its egress decision
    // evaluated and logged; there is no read behind it. The base prompt's
    // guideline 2 also tells the model it has no bank data under "off". Bank
    // figures the model was given on earlier turns can still reach it through
    // the stored conversation history and the memory block; "off" does not
    // remove those.
    const plaidStateMode = resolvePlaidStateMode();
    const plaidStateEnabled = plaidStateMode !== "off";

    let systemPrompt = generateSystemPrompt(mergedUserContext, {
      plaidStateEnabled,
    });
    systemPrompt += memoryBlock;

    // Bank data another household member shares with the user. Read at all
    // only while AI_HOUSEHOLD_SHARED_STATE is exactly "on" and the mode is not
    // "off"; otherwise nothing below runs and the prompt is as it was. What is
    // shared comes from the shared-connections function, for the verified id
    // only. It enters the prompt on a household turn (household_shared
    // channel): a non-greeting message about the household or naming a
    // sharing member, or any non-greeting turn of a session already marked
    // with shared data, whose history carries it. A turn where something is
    // shared and none of it is in the prompt gets one line saying so. A failed
    // read of what is shared adds nothing, not even that line.
    const sharedStateEnabled = resolveSharedStateEnabled() && plaidStateEnabled;
    let sharedList: SharedChatList | null = null;
    let sessionMarked = false;
    if (sharedStateEnabled) {
      const sessionForMark = activeSession;
      try {
        const listed = await beforeLoop("shared_list", async () => {
          const list = await listSharedForChat(authUserId);
          let marked: boolean | "unknown" = false;
          if (list.connections.length > 0 && sessionForMark) {
            try {
              marked =
                (await getEarliestSharedSourceTime(sessionForMark.id, authUserId)) !== null;
            } catch {
              marked = "unknown";
            }
          }
          return { list, marked };
        });
        sharedList = listed.list;
        if (listed.marked === "unknown") {
          // Not known to be marked: the turn decides by its words alone.
          console.warn("[chat-shared] outcome=mark_read_failed");
        } else {
          sessionMarked = listed.marked;
        }
      } catch (error) {
        if (error instanceof ChatDeadlineError) throw error;
        console.warn(
          "[chat-shared] outcome=list_failed code=%s",
          sharedReadFailureCode(error)
        );
      }
    }
    const hasSharedConnections =
      sharedList !== null && sharedList.connections.length > 0;
    const householdTurn =
      hasSharedConnections &&
      !isGreeting &&
      (sessionMarked ||
        isHouseholdTurn(lastUserMessageText, ownerFirstNames(sharedList)));
    const householdSharedDecision = evaluatePlaidEgressDecision({
      channel: "household_shared",
      plaidStateMode,
      sharedStateEnabled,
      hasSharedConnections,
      householdTurn,
    });
    if (sharedStateEnabled) {
      logPlaidEgressDecision(householdSharedDecision, { mode: plaidStateMode });
    }
    // The connections whose data this turn's prompt carries: what the save
    // records. Empty unless the shared block below is added.
    let sharedSources: SharedTurnSource[] = [];
    let sharedNotice = false;

    const capabilityScaffoldDecision = evaluatePlaidEgressDecision({
      channel: "capability_scaffold",
      plaidStateMode,
    });
    logPlaidEgressDecision(capabilityScaffoldDecision, { mode: plaidStateMode });
    const balanceKeywordDecision = evaluatePlaidEgressDecision({
      channel: "balance_keyword",
      plaidStateMode,
      wantsBalance,
    });
    logPlaidEgressDecision(balanceKeywordDecision, { mode: plaidStateMode });
    // Whether this turn's block carries per-account balance lines, for
    // llm_calls: the same predicate the block builder renders them by.
    let plaidBalancesInjected = false;
    if (capabilityScaffoldDecision.allowed) {
      // Balances are read only on substantive turns: under "balances" on any
      // turn but a greeting, under "connection" on a balance question. A
      // greeting never triggers a live balance read.
      const effectiveDepth = resolvePlaidChatDepth({
        mode: plaidStateMode,
        isGreeting,
        balanceKeywordAllowed: balanceKeywordDecision.allowed,
        householdSharedAllowed: householdSharedDecision.allowed,
      });
      // The shared read runs beside the user's own; its outcome is taken
      // after the own block, and its failure never changes that block.
      const sharedListForRead = sharedList;
      const sharedReadOutcome =
        householdSharedDecision.allowed && sharedListForRead !== null
          ? beforeLoop("shared_state", (signal) =>
              readSharedForChat(authUserId, sharedListForRead, { signal })
            ).then(
              (read): { read: SharedChatRead | null; error: unknown } => ({
                read,
                error: null,
              }),
              (error: unknown): { read: SharedChatRead | null; error: unknown } => ({
                read: null,
                error,
              })
            )
          : null;
      try {
        const plaidState = await beforeLoop(
          "plaid_state",
          async (signal) =>
            await getPlaidChatState(authUserId, {
              depth: effectiveDepth,
              signal,
            })
        );
        const plaidBlock = buildPlaidCapabilityBlock(plaidState);
        systemPrompt += plaidBlock;
        plaidBalancesInjected = plaidBlockCarriesBalances(plaidState);
        const reads = plaidState.connections.map((c) => c.read);
        console.debug(
          "[plaid-state] mode=%s depth=%s connected=%s accounts=%d read=%d reconnect=%d unread=%d block=%s",
          plaidStateMode,
          effectiveDepth,
          plaidState.connected,
          plaidState.accounts?.length ?? 0,
          reads.filter((r) => r === "read").length,
          reads.filter((r) => r === "needs_reconnect").length,
          reads.filter((r) => r === "not_read").length,
          maskPlaidBlockForLog(plaidBlock)
        );
      } catch (error) {
        // A read still running at the deadline is not a read error: it goes
        // to the outer catch and the request ends without a model call.
        if (error instanceof ChatDeadlineError) throw error;
        // Fail-open on a read error: it never blocks the chat. Emit an
        // explicit "state unknown" block so the base prompt's pointer to
        // "What you can see this turn" stays consistent and the model does not
        // fabricate a connection verdict. The log names the kind of failure
        // and a code only: never the error's message or the error itself,
        // which can carry database or crypto detail.
        const failure = plaidReadFailure(error);
        console.error(
          "[plaid-state] read failed cause=%s reason=%s; using unknown-state fallback",
          failure.cause,
          failure.reason
        );
        systemPrompt += buildPlaidCapabilityBlock({
          depth: effectiveDepth,
          connected: false,
          connections: [],
          readError: true,
        });
      }

      let sharedRead: SharedChatRead | null = null;
      if (sharedReadOutcome !== null) {
        const outcome = await sharedReadOutcome;
        if (outcome.error instanceof ChatDeadlineError) throw outcome.error;
        if (outcome.read !== null) {
          sharedRead = outcome.read;
        } else {
          console.warn(
            "[chat-shared] outcome=read_failed code=%s",
            sharedReadFailureCode(outcome.error)
          );
        }
      }
      const sharedBlock = sharedRead !== null ? buildSharedBankBlock(sharedRead.state) : "";
      if (sharedRead !== null && sharedBlock !== "") {
        systemPrompt += sharedBlock;
        sharedSources = sharedRead.sources;
      } else if (hasSharedConnections) {
        systemPrompt += SHARED_NOT_IN_TURN_BLOCK;
        sharedNotice = true;
      }
    }
    if (sharedStateEnabled) {
      // Counts and flags only: no name, bank, account, amount or id.
      console.info(
        "[chat-shared] listed=%d household=%s marked=%s allowed=%s sources=%d notice=%d",
        sharedList === null ? -1 : sharedList.connections.length,
        householdTurn,
        sessionMarked,
        householdSharedDecision.allowed,
        sharedSources.length,
        sharedNotice ? 1 : 0
      );
    }

    if (isGreeting) {
      systemPrompt +=
        "\n\n## Current Turn: Simple Greeting or Small Talk\nThe user's latest message is only a greeting or brief small talk. Reply in 1-2 short, polite sentences. Do NOT mention their income, spending, budget, bank balance, or profile details unless they explicitly asked.";
    }

    // Evaluated and logged only: no bank read follows this decision.
    const financialAnalysisDecision = evaluatePlaidEgressDecision({
      channel: "financial_analysis_keyword",
      plaidStateMode,
      wantsFinancialAnalysis,
    });
    logPlaidEgressDecision(financialAnalysisDecision, { mode: plaidStateMode });

    // Last, after every other per-turn block. It carries no user text.
    if (crisis) {
      systemPrompt +=
        "\n\n## Current Turn: Safety\nThe user's latest message may indicate risk. Follow 'Safety comes first'. A fixed safety notice with crisis contacts is shown to the user above your reply.";
    }

    // OpenRouter is the only provider path: every request carries the routing
    // preferences in openRouterRequest.ts. Without a key there is no other
    // provider to fall back to, and the route answers 503 below.
    const openRouterApiKey = resolveOpenRouterApiKey();
    if (openRouterApiKey) {
      const openRouterMessages = [
        { role: "system" as const, content: systemPrompt },
        ...modelConversation.messages,
      ];

      const modelsToTry = selectOpenRouterModels(modelConversation.messages);
      // Which optional blocks the system prompt carries, for llm_calls only.
      const promptBlocks: ChatPromptBlocks = {
        memory: memoryBlock !== "",
        plaidScaffold: capabilityScaffoldDecision.allowed,
        balance: plaidBalancesInjected,
        financialSnapshot: false,
      };
      let attemptIndex = 0;

      for (const model of modelsToTry) {
        // Every attempt, the first included, starts only if it could run to
        // its full timeout inside the request budget.
        const elapsedMs = Date.now() - requestStartedAtMs;
        if (!chatHasBudgetForAnotherAttempt(elapsedMs)) {
          console.warn(
            "[chat-deadline] attempt skipped attempt=%d elapsed_ms=%d",
            attemptIndex + 1,
            elapsedMs
          );
          break;
        }
        attemptIndex++;
        let result: OpenRouterResult;
        try {
          result = await callOpenRouter(
            openRouterApiKey,
            model,
            openRouterMessages,
            {
              attemptIndex,
              userId: authUserId,
              sessionId: activeSession?.id ?? null,
              blocks: promptBlocks,
              tally: usageTally,
            }
          );
        } catch (error) {
          // callOpenRouter has already recorded the attempt. A thrown attempt
          // has no upstream status to report; its cause code and its name are
          // all that is read from the error, never its message.
          logFailedModelAttempt(
            attemptIndex,
            null,
            networkCauseCode(error),
            errorName(error)
          );
          continue;
        }

        if (result.ok) {
          // With a crisis signal the notice leads the reply, and the reply
          // stored is the one shown.
          const notice = crisisNotice();
          const replyMessage =
            notice === null
              ? result.message
              : composeCrisisReply(notice, result.message, EMPTY_ASSISTANT_REPLY);
          const saveStartedAtMs = Date.now();
          let savedSessionId: string | null = null;
          try {
            savedSessionId = await persistTurnIfEnabled({
              activeSession,
              authUserId,
              userContent: lastUserMessageText,
              assistantContent: replyMessage ?? "",
              assistantModel: result.model,
              inputTokens: result.usage?.input_tokens,
              outputTokens: result.usage?.output_tokens,
              requestStartedAtMs,
              sharedSources,
            });
          } catch (error) {
            console.error(
              "[chat-save] failed name=%s code=%s",
              errorName(error),
              errorCodeForLog(error)
            );
            if (error instanceof SharedSourceEndedError) {
              return respond(
                {
                  error:
                    "Could not save your conversation. Please try sending your message again.",
                  code: "SHARED_DATA_ENDED",
                },
                { status: 409 }
              );
            }
            return respond(
              {
                error:
                  "Could not save your conversation. Please try sending your message again.",
                code: "SAVE_FAILED",
              },
              { status: 500 }
            );
          } finally {
            // Without a session there is no save to time.
            if (activeSession) stageMs.save = Date.now() - saveStartedAtMs;
          }

          return respond({
            success: true,
            message: replyMessage,
            model: result.model,
            // The session the turn was stored in, which is not the one the
            // request started with when that one was closed meanwhile.
            sessionId: savedSessionId ?? activeSession?.id ?? null,
            usage: result.usage,
          });
        }

        logFailedModelAttempt(attemptIndex, result.status);

        // Auth errors should fail fast rather than retrying other models.
        if (result.status === 401) {
          return respond(CHAT_MODEL_FAILED_BODY, {
            status: CHAT_MODEL_FAILED_STATUS,
          });
        }
      }

      // No attempt fitted in the request budget.
      if (attemptIndex === 0) {
        return respond(CHAT_TIME_BUDGET_EXHAUSTED_BODY, { status: 503 });
      }

      // Every attempt that started has failed.
      return respond(CHAT_MODEL_FAILED_BODY, {
        status: CHAT_MODEL_FAILED_STATUS,
      });
    }

    return respond(
      {
        error: "AI provider is not configured. Set OPENROUTER_API_KEY.",
      },
      { status: 503 }
    );
  } catch (error) {
    // A wait before the model loop was still running at the pre-loop
    // deadline. No model attempt was made.
    if (error instanceof ChatDeadlineError) {
      console.warn(
        "[chat-deadline] stage cut stage=%s elapsed_ms=%d",
        error.stage,
        Date.now() - requestStartedAtMs
      );
      return respond(CHAT_TIME_BUDGET_EXHAUSTED_BODY, { status: 503 });
    }

    console.error(
      "[chat-error] name=%s code=%s",
      errorName(error),
      errorCodeForLog(error)
    );

    return respond(
      { error: "Failed to get response from AI" },
      { status: 500 }
    );
  } finally {
    // One line per request. Durations only. No user, session, or content
    // fields.
    console.info(
      "[chat-stages] auth_ms=%d body_ms=%d profile_ms=%d session_ms=%d memory_ms=%d plaid_state_ms=%d shared_list_ms=%d shared_state_ms=%d save_ms=%d",
      stageMs.auth,
      stageMs.body,
      stageMs.profile,
      stageMs.session,
      stageMs.memory,
      stageMs.plaid_state,
      stageMs.shared_list,
      stageMs.shared_state,
      stageMs.save
    );
    // Awaited: Vercel freezes the function once the response is returned.
    // settleChatUsage and recordCrisisNotice never reject and are bounded by
    // their own timeouts; they run side by side. The notice is counted once
    // per request that showed it, however many model attempts it took.
    await Promise.all([
      usageReservation
        ? settleChatUsage({
            reservationId: usageReservation.reservationId,
            userId: usageReservation.userId,
            cost: settledCost(usageTally),
            attempts: usageTally.length,
          })
        : undefined,
      crisis && crisisDelivered
        ? recordCrisisNotice({ category: crisis, variant: crisisVariant })
        : undefined,
    ]);
  }
}

// GET endpoint to fetch chat history
export async function GET(request: NextRequest) {
  try {
    const authUserId = await getAuthenticatedUserIdFromRequest(request);
    if (!authUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isAiMemoryEnabled()) {
      return NextResponse.json({ success: true, messages: [] });
    }

    try {
      const activeSession = await withRetry(
        () => getActiveSession(authUserId),
        "GET getActiveSession"
      );

      if (!activeSession) {
        return NextResponse.json({
          success: true,
          messages: [],
          sessionId: null,
        });
      }

      const dbMessages = await withRetry(
        () =>
          getSessionMessages(activeSession.id, authUserId, {
            limit: 50,
            order: "desc",
          }),
        "GET getSessionMessages"
      );

      const messages = dbMessages.reverse().map(toClientChatMessage);

      return NextResponse.json({
        success: true,
        messages,
        sessionId: activeSession.id,
      });
    } catch (memoryError) {
      console.error(
        "[chat-history-get] memory load failed name=%s code=%s",
        errorName(memoryError),
        errorCodeForLog(memoryError)
      );
      return NextResponse.json(
        {
          error: "Memory system temporarily unavailable. Please try again.",
          code: "MEMORY_LOAD_FAILED",
        },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error(
      "[chat-history-get] failed name=%s code=%s",
      errorName(error),
      errorCodeForLog(error)
    );
    return NextResponse.json(
      { error: "Failed to fetch chat history" },
      { status: 500 }
    );
  }
}
