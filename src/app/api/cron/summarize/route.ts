import { NextRequest, NextResponse } from "next/server";
import {
  isAiMemoryEnabled,
  getSessionsToClose,
  getSessionsNeedingSummary,
  getRespondedAttemptCounts,
  endSession,
  getSessionMessages,
  createSummary,
  markSessionSummarized,
  recordCronRun,        // ← 추가
  type ChatSession,
  type DbChatMessage,
} from "@/lib/aiMemory";
import { asPlainObject } from "@/lib/requestJson";
import {
  buildCronLlmCallRow,
  type ObservedLlmCall,
} from "@/lib/llmCallTelemetry";
import { recordLlmCall } from "@/lib/llmCallLog";
import { storeSummaryUnlessCrisis } from "@/lib/summaryCrisisGate";
import {
  CRON_MAX_RESPONDED_ATTEMPTS,
  SESSION_CANDIDATE_LIMIT,
  applyGiveUps,
  partitionByAttemptBound,
} from "@/lib/cronRetryBound";
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
 * OpenRouter chat completions를 호출해 요약 텍스트를 반환한다.
 *
 * 이 cron의 기존 에러 처리(summarizeOneSession이 throw하고 바깥 for 루프
 * try/catch가 받음)와 일관되게, result 객체 대신 throw 기반으로 동작한다.
 * 실패 시 throw → 해당 세션만 건너뛰고 다음 run에서 재시도된다.
 *
 * route.ts의 callOpenRouter를 공용화하지 않고 자체 버전을 둠
 * (route.ts를 건드리지 않는 게 안전).
 *
 * Every exit records one llm_calls row first. recordLlmCall never rejects
 * (llmCallLog.ts), so the `finally` cannot replace the error this throws or the
 * content it returns.
 *
 * The call is cut off after CRON_LLM_TIMEOUT_MS. If that happened before the
 * body was parsed, the row records it as a timeout (network_error) rather than
 * as the invalid-JSON error the cut-off body read produces.
 */
async function callOpenRouterForSummary(
  apiKey: string,
  systemPrompt: string,
  conversationText: string,
  ctx: { userId: string; sessionId: string }
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
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed: ${response.status} ${response.statusText}` +
        (errorBody ? ` — ${errorBody.slice(0, 300)}` : "")
    );
  }

  // HTTP 200이어도 본문이 JSON이 아닐 수 있음 (게이트웨이 오류 페이지 등).
  // 파싱 실패를 별도로 구분해 "응답 누락"과 다른 에러 메시지를 남긴다.
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
- Capture concrete facts about the user (financial situation, goals, decisions made, and relevant circumstances like visa status or school if mentioned) — NOT generic advice Noor gave.
- Preserve specifics the user states that a connected bank feed cannot know: money received from family or other people, rent or bills paid in cash, accounts or cards that are not connected, scholarship or aid amounts and dates, deadlines, and bank names.
- Do NOT preserve live account balances or individual transaction amounts, even if they appear in the conversation. They are read fresh from the bank feed when needed, and a stored copy goes stale.
- Be written in third person ("The user...").
- Omit pleasantries, greetings, and small talk.
- Never include full sensitive identifiers (e.g. a complete SSN or card number), even if they appear in the conversation.
- Do NOT include the user's emotions, mental health, or any mention of self-harm, suicide, harming others, or eating problems, and do not mention safety notices Noor showed.

After the summary paragraph, output exactly one final line in this format:
TOPICS: tag1, tag2, tag3

Where tags are 2-5 short lowercase topic tags (e.g. "TOPICS: budgeting, chase_bank, credit_score").

Output only the summary paragraph followed by the single TOPICS line. Nothing else.`;

function buildConversationText(messages: DbChatMessage[]): string {
  const trimmed =
    messages.length > MAX_MESSAGES_PER_SUMMARY
      ? messages.slice(messages.length - MAX_MESSAGES_PER_SUMMARY)
      : messages;
  return trimmed
    .map((m) => {
      const speaker = m.role === "user" ? "User" : "Noor";
      return `${speaker}: ${m.content}`;
    })
    .join("\n\n");
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

async function summarizeOneSession(
  apiKey: string,
  session: ChatSession
): Promise<void> {
  if (session.message_count === 0) {
    await markSessionSummarized(session.id, session.user_id);
    return;
  }

  const recent = await getSessionMessages(session.id, session.user_id, {
    limit: MAX_MESSAGES_PER_SUMMARY,
    order: "desc",
  });
  const messages = recent.reverse();

  if (messages.length === 0) {
    console.warn(
      `Summarize cron: session ${session.id} has message_count=` +
        `${session.message_count} but 0 messages found — marking summarized.`
    );
    await markSessionSummarized(session.id, session.user_id);
    return;
  }

  const conversationText = buildConversationText(messages);

  const rawOutput = await callOpenRouterForSummary(
    apiKey,
    SUMMARY_SYSTEM_PROMPT,
    conversationText,
    { userId: session.user_id, sessionId: session.id }
  );

  if (!rawOutput.trim()) {
    throw new Error(
      `Summarization model returned empty output for session ${session.id}`
    );
  }

  const { summary, topics } = parseSummaryOutput(rawOutput);
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
    // Sessions given up under the retry bound, and give-ups whose flag write
    // failed (those are selected and given up again on a later run).
    givenUp: 0,
    giveUpFailed: 0,
    // Sessions not started because the run deadline was reached; they stay
    // eligible and are picked up by the next run.
    deferred: 0,
  };

  try {
    const toClose = await getSessionsToClose(CLOSE_BATCH_LIMIT);
    for (const session of toClose) {
      try {
        await endSession(session.id, session.user_id);
        stats.closed++;
      } catch (error) {
        stats.closeFailed++;
        console.error(
          `Summarize cron: failed to close session ${session.id}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error("Summarize cron: getSessionsToClose failed:", error);
    infraError =
      `getSessionsToClose failed: ` +
      `${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    const candidates = await getSessionsNeedingSummary(SESSION_CANDIDATE_LIMIT);
    let toSummarize = candidates.slice(0, SUMMARIZE_BATCH_LIMIT);

    // Retry bound: give up on sessions whose summary has already had the
    // maximum number of answered attempts. If the counts cannot be read, the
    // run goes ahead without the bound rather than giving up on anything.
    let attemptCounts: Record<string, number> | null = null;
    try {
      attemptCounts = await getRespondedAttemptCounts(
        "cron_summarize",
        candidates.map((s) => s.id)
      );
    } catch (error) {
      console.error(
        "Summarize cron: could not read attempt counts; running without the retry bound:",
        error
      );
    }
    if (attemptCounts) {
      const { toProcess, toGiveUp } = partitionByAttemptBound(
        candidates,
        attemptCounts,
        { max: CRON_MAX_RESPONDED_ATTEMPTS, limit: SUMMARIZE_BATCH_LIMIT }
      );
      const giveUps = await applyGiveUps(toGiveUp, attemptCounts, {
        route: "cron_summarize",
        mark: (s) => markSessionSummarized(s.id, s.user_id),
      });
      stats.givenUp = giveUps.givenUp;
      stats.giveUpFailed = giveUps.giveUpFailed;
      toSummarize = toProcess;
    }

    for (const session of toSummarize) {
      if (!cronRunHasBudgetForAnotherCall(Date.now() - startedAt.getTime())) {
        stats.deferred =
          toSummarize.length - (stats.summarized + stats.summarizeFailed);
        console.warn(
          `Summarize cron: run deadline reached; ${stats.deferred} ` +
            `session(s) left for the next run.`
        );
        break;
      }
      try {
        await summarizeOneSession(apiKey, session);
        stats.summarized++;
      } catch (error) {
        stats.summarizeFailed++;
        console.error(
          `Summarize cron: failed to summarize session ${session.id}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error(
      "Summarize cron: getSessionsNeedingSummary failed:",
      error
    );
    infraError =
      (infraError ? infraError + "; " : "") +
      `getSessionsNeedingSummary failed: ` +
      `${error instanceof Error ? error.message : String(error)}`;
  }

  console.info("Summarize cron complete:", stats);

  // cron_runs에 실행 기록 (격리 — 기록 실패가 본업/응답을 망치지 않게).
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
    console.error("Summarize cron: failed to record cron_runs row:", recordError);
  }

  return NextResponse.json({
    success: true,
    ...stats,
  });
}
