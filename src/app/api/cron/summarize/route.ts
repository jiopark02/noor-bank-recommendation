import { NextRequest, NextResponse } from "next/server";
import {
  isAiMemoryEnabled,
  getSessionsToClose,
  getSessionsNeedingSummary,
  endSession,
  getEarliestSharedSourceTime,
  getSessionMessages,
  getSummaryBySessionId,
  createSummary,
  markSessionSummarized,
  writeCronBackoff,
  writeCronCountedFailure,
  writeCronGiveUp,
  recordCronRun,
  type ChatSession,
  type DbChatMessage,
} from "@/lib/aiMemory";
import { asPlainObject } from "@/lib/requestJson";
import { errorCodeForLog } from "@/lib/errorCodeForLog";
import {
  buildCronLlmCallRow,
  type ObservedLlmCall,
} from "@/lib/llmCallTelemetry";
import { recordLlmCall } from "@/lib/llmCallLog";
import { storeSummaryUnlessCrisis } from "@/lib/summaryCrisisGate";
import {
  buildCronConversationText,
  logCronInputBudget,
  type CronConversation,
} from "@/lib/cronInputBudget";
import { SESSION_CANDIDATE_LIMIT } from "@/lib/cronRetryBound";
import {
  cronRunItems,
  runMemoryCronBatch,
  type StageTracker,
} from "@/lib/memoryCronBatch";
import {
  OPENROUTER_URL,
  buildOpenRouterRequestBody,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterRequest";
import {
  CRON_LLM_TIMEOUT_MS,
  cronRunHasBudgetForAnotherCall,
  logLlmTimeout,
} from "@/lib/llmTimeouts";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Summarization model: the SUMMARY_MODEL env var when set, otherwise the
// "latest" alias below. The tilde (~) prefix is required for latest aliases on
// OpenRouter — without it the API returns "not a valid model ID".
// Every request is routed under the provider preferences in openRouterRequest.ts,
// so the model this resolves to must have an endpoint those preferences accept,
// or each call fails. If the alias moves to a model without one, pin a specific
// model id through SUMMARY_MODEL and redeploy. Resilience to output-format drift
// is handled in the parser, not by pinning the model.
const SUMMARY_MODEL =
  process.env.SUMMARY_MODEL?.trim() || "~anthropic/claude-sonnet-latest";

const MAX_MESSAGES_PER_SUMMARY = 200;
const SUMMARY_MAX_TOKENS = 1024;
const CLOSE_BATCH_LIMIT = 50;
const SUMMARIZE_BATCH_LIMIT = 8;

/**
 * Calls OpenRouter chat completions and returns the summary text.
 *
 * It throws rather than returning a result object, consistent with this
 * cron's error handling (summarizeOneSession throws and the caller's
 * per-session handling catches it). On failure only that session is skipped,
 * and it is retried on a later run.
 *
 * This cron keeps its own model call rather than sharing the chat route's.
 *
 * Every exit records one llm_calls row first. recordLlmCall never rejects
 * (llmCallLog.ts), so the `finally` cannot replace the error this throws or the
 * content it returns.
 *
 * The call is cut off after CRON_LLM_TIMEOUT_MS. If that happened before the
 * body was parsed, the row records it as a timeout (network_error) rather than
 * as the invalid-JSON error the cut-off body read produces.
 *
 * What the call observed (the status, whether it timed out) is also copied to
 * `tracker.call`, from which the batch loop decides how a failure counts.
 */
async function callOpenRouterForSummary(
  apiKey: string,
  systemPrompt: string,
  conversationText: string,
  ctx: { userId: string; sessionId: string },
  tracker: StageTracker
): Promise<string> {
  const startedAtMs = Date.now();
  const signal = AbortSignal.timeout(CRON_LLM_TIMEOUT_MS);
  const observed: ObservedLlmCall = {
    httpStatus: null,
    jsonParsed: false,
    data: null,
  };
  try {
    return await requestSummary(
      apiKey,
      systemPrompt,
      conversationText,
      observed,
      signal
    );
  } finally {
    observed.timedOut = signal.aborted && !observed.jsonParsed;
    if (observed.timedOut) {
      logLlmTimeout("cron_summarize", SUMMARY_MODEL, CRON_LLM_TIMEOUT_MS);
    }
    tracker.call = {
      httpStatus: observed.httpStatus,
      timedOut: observed.timedOut,
    };
    await recordLlmCall(
      buildCronLlmCallRow({
        route: "cron_summarize",
        requestModel: SUMMARY_MODEL,
        startedAtMs,
        latencyMs: Date.now() - startedAtMs,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        observed,
      })
    );
  }
}

async function requestSummary(
  apiKey: string,
  systemPrompt: string,
  conversationText: string,
  observed: ObservedLlmCall,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(
      buildOpenRouterRequestBody({
        model: SUMMARY_MODEL,
        maxTokens: SUMMARY_MAX_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: conversationText },
        ],
      })
    ),
  });
  observed.httpStatus = response.status;

  if (!response.ok) {
    // The error body is never read: it can echo the request, which carries the
    // conversation. It is cancelled, so the connection is released now rather
    // than whenever the runtime collects the response. The thrown error
    // carries the status only, as its message and as a log-safe code.
    try {
      await response.body?.cancel();
    } catch {
      // Nothing more to release.
    }
    throw Object.assign(
      new Error(`OpenRouter request failed: ${response.status} ${response.statusText}`),
      { code: `http_${response.status}` }
    );
  }

  // A 200 response can still carry a body that is not JSON (a gateway error
  // page, for example). A parse failure gets its own error message, distinct
  // from a missing-content one.
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("OpenRouter response was not valid JSON");
  }
  observed.jsonParsed = true;
  observed.data = asPlainObject(data);

  const content: unknown =
    (data as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenRouter response missing message content");
  }

  return content;
}

const SUMMARY_SYSTEM_PROMPT = `You are a summarization assistant for Noor, a personal finance guidance app for people who are just getting started with managing their money. Always respond in English.

You will receive a conversation between a user and Noor AI. Produce a concise summary that captures information useful for future conversations.

Your summary must:
- Be one dense paragraph (roughly 80-150 words).
- Capture concrete facts about the user (financial situation, goals, decisions made, and relevant circumstances like school if mentioned) — NOT generic advice Noor gave.
- Preserve specifics the user states that a connected bank feed cannot know: money received from family or other people, rent or bills paid in cash, accounts or cards that are not connected, scholarship or aid amounts and dates, deadlines, and bank names.
- Do NOT preserve live account balances or individual transaction amounts, even if they appear in the conversation. They are read fresh from the bank feed when needed, and a stored copy goes stale.
- Be written in third person ("The user...").
- Omit pleasantries, greetings, and small talk.
- Never include full sensitive identifiers (e.g. a complete SSN or card number), even if they appear in the conversation.
- Do NOT include the user's emotions, mental health, or any mention of self-harm, suicide, harming others, or eating problems, and do not mention safety notices Noor showed.
- Do NOT include the user's immigration or visa status (visa type, F-1, OPT, CPT, I-20, work authorization, or residency status).

After the summary paragraph, output exactly one final line in this format:
TOPICS: tag1, tag2, tag3

Where tags are 2-5 short lowercase topic tags (e.g. "TOPICS: budgeting, chase_bank, credit_score").

Output only the summary paragraph followed by the single TOPICS line. Nothing else.`;

// Serialized under the length budget in cronInputBudget.ts: a long message
// loses its middle, and the oldest messages are left out first.
function buildConversationText(messages: DbChatMessage[]): CronConversation {
  const trimmed =
    messages.length > MAX_MESSAGES_PER_SUMMARY
      ? messages.slice(messages.length - MAX_MESSAGES_PER_SUMMARY)
      : messages;
  return buildCronConversationText(trimmed);
}

function parseSummaryOutput(raw: string): {
  summary: string;
  topics: string[];
} {
  const text = raw.trim();
  const pattern = /^TOPICS:\s*(.+)$/gim;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch) {
    return { summary: text, topics: [] };
  }
  const matchIndex = lastMatch.index ?? text.length;
  const summary = text.slice(0, matchIndex).trim();
  const topics = lastMatch[1]
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
    .slice(0, 5);
  return { summary: summary || text, topics };
}

/**
 * Summarizes one session and marks it done. Records on `tracker` each stage it
 * reaches (see memoryCronBatch.ts), because a failure is counted or not by the
 * stage it happened in.
 */
async function summarizeOneSession(
  apiKey: string,
  session: ChatSession,
  tracker: StageTracker
): Promise<void> {
  if (session.message_count === 0) {
    await markSessionSummarized(session.id, session.user_id);
    return;
  }

  // A summary is already stored when an earlier run's completion write
  // failed after storing it: mark the session done without the model.
  const stored = await getSummaryBySessionId(session.id, session.user_id);
  if (stored) {
    await markSessionSummarized(session.id, session.user_id);
    return;
  }

  // Where another household member's shared bank data entered the session,
  // if it did. Only what was said before that moment is summarized. It is
  // read before the messages, never after (see getEarliestSharedSourceTime),
  // and a failed read throws here, before the model is called.
  const sharedFrom = await getEarliestSharedSourceTime(session.id, session.user_id);

  const recent = await getSessionMessages(session.id, session.user_id, {
    limit: MAX_MESSAGES_PER_SUMMARY,
    order: "desc",
    before: sharedFrom ?? undefined,
  });
  const messages = recent.reverse();

  if (messages.length === 0) {
    if (sharedFrom !== null) {
      // Nothing was said before the shared data entered: the session ends
      // without a summary.
      console.log(
        `Summarize cron: session ${session.id} has no message from before ` +
          "shared bank data entered it — marking summarized."
      );
    } else {
      console.warn(
        `Summarize cron: session ${session.id} has message_count=` +
          `${session.message_count} but 0 messages found — marking summarized.`
      );
    }
    await markSessionSummarized(session.id, session.user_id);
    return;
  }

  const conversation = buildConversationText(messages);
  logCronInputBudget("cron_summarize", conversation);
  const conversationText = conversation.text;

  tracker.stage = "call";
  const rawOutput = await callOpenRouterForSummary(
    apiKey,
    SUMMARY_SYSTEM_PROMPT,
    conversationText,
    { userId: session.user_id, sessionId: session.id },
    tracker
  );

  tracker.stage = "interpret";
  if (!rawOutput.trim()) {
    throw new Error(
      `Summarization model returned empty output for session ${session.id}`
    );
  }

  const { summary, topics } = parseSummaryOutput(rawOutput);
  tracker.stage = "store";
  await storeSummaryUnlessCrisis({ createSummary, markSessionSummarized }, session, {
    summary,
    topics,
    messageCount: session.message_count,
    generatedByModel: SUMMARY_MODEL,
  });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim() === "") {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiMemoryEnabled()) {
    return NextResponse.json({
      success: true,
      skipped: "AI memory disabled",
    });
  }

  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) {
    console.error("Summarize cron: OPENROUTER_API_KEY not configured");
    return NextResponse.json(
      { error: "Summarization model not configured" },
      { status: 503 }
    );
  }

  const startedAt = new Date();
  let infraError: string | null = null;
  const stats = {
    closed: 0,
    closeFailed: 0,
    summarized: 0,
    summarizeFailed: 0,
    // How the failed sessions were recorded (see memoryCronBatch.ts):
    // counted or not, given up, and state writes that failed (those
    // sessions are selected again on a later run).
    counted: 0,
    notCounted: 0,
    givenUp: 0,
    stateWriteFailed: 0,
    // Sessions not started because the run deadline was reached, or because
    // an earlier failure stopped the run; they stay eligible.
    deferred: 0,
    stoppedSkipped: 0,
    stopped: false,
  };

  // Every error line and cron_runs.error carry identifiers and an error code
  // only (errorCodeForLog): an error's message, details or cause can carry a
  // row or the provider's answer.
  try {
    const toClose = await getSessionsToClose(CLOSE_BATCH_LIMIT);
    for (const session of toClose) {
      try {
        await endSession(session.id, session.user_id);
        stats.closed++;
      } catch (error) {
        stats.closeFailed++;
        console.error(
          "[memory-cron] route=cron_summarize step=close session=%s code=%s",
          session.id,
          errorCodeForLog(error)
        );
      }
    }
  } catch (error) {
    const code = errorCodeForLog(error);
    console.error("[memory-cron] route=cron_summarize step=close_read code=%s", code);
    infraError = `close_read code=${code}`;
  }

  // Set once the candidate read has returned, so a rejection of the batch is
  // labelled by where it happened.
  let candidatesRead = false;
  try {
    const batch = await runMemoryCronBatch<ChatSession>({
      route: "cron_summarize",
      now: Date.now,
      runStartedAtMs: startedAt.getTime(),
      candidateLimit: SESSION_CANDIDATE_LIMIT,
      batchLimit: SUMMARIZE_BATCH_LIMIT,
      hasBudget: cronRunHasBudgetForAnotherCall,
      fetchCandidates: async (limit, nowIso) => {
        const candidates = await getSessionsNeedingSummary(limit, nowIso);
        candidatesRead = true;
        return candidates;
      },
      failuresOf: (s) => s.summary_failures,
      processSession: (s, tracker) => summarizeOneSession(apiKey, s, tracker),
      onSessionError: (s, error) => {
        console.error(
          "[memory-cron] route=cron_summarize step=session session=%s code=%s",
          s.id,
          errorCodeForLog(error)
        );
      },
      writeBackoff: (s, next) =>
        writeCronBackoff("summary", s.id, s.user_id, next),
      writeCountedFailure: (s, before, next) =>
        writeCronCountedFailure("summary", s.id, s.user_id, before, next),
      writeGiveUp: (s, before, reason, at) =>
        writeCronGiveUp("summary", s.id, s.user_id, before, reason, at),
    });
    const items = cronRunItems(batch);
    stats.summarized = items.itemsProcessed;
    stats.summarizeFailed = items.itemsFailed;
    stats.counted = batch.counted;
    stats.notCounted = batch.notCounted;
    stats.givenUp = batch.givenUp;
    stats.stateWriteFailed = batch.stateWriteFailed;
    stats.deferred = batch.deferred;
    stats.stoppedSkipped = batch.stoppedSkipped;
    stats.stopped = batch.stopped;
  } catch (error) {
    const step = candidatesRead ? "batch" : "candidates";
    const code = errorCodeForLog(error);
    console.error("[memory-cron] route=cron_summarize step=%s code=%s", step, code);
    infraError = (infraError ? infraError + "; " : "") + `${step} code=${code}`;
  }

  console.info("Summarize cron complete:", stats);

  // Record the run in cron_runs (isolated, so a failed record cannot break the
  // run's work or its response).
  // A session given up this run failed this run, so it is among the failed
  // items and the run's status reflects it.
  try {
    await recordCronRun({
      jobName: "summarize",
      startedAt,
      itemsProcessed: stats.closed + stats.summarized,
      itemsFailed: stats.closeFailed + stats.summarizeFailed,
      stats,
      error: infraError,
      forceFailed: infraError !== null,
    });
  } catch (recordError) {
    console.error(
      "[memory-cron] route=cron_summarize step=record code=%s",
      errorCodeForLog(recordError)
    );
  }

  return NextResponse.json({
    success: true,
    ...stats,
  });
}
