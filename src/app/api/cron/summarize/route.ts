import { NextRequest, NextResponse } from "next/server";
import {
  isAiMemoryEnabled,
  getSessionsToClose,
  getSessionsNeedingSummary,
  endSession,
  getSessionMessages,
  createSummary,
  markSessionSummarized,
  type ChatSession,
  type DbChatMessage,
} from "@/lib/aiMemory";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// OpenRouter 요약 모델. 요약 품질을 위해 Sonnet 사용 (CTO 결정 — 선택 B).
// 버전 고정 ID — OpenRouter의 "latest" 별칭은 chat completions API에서
// 유효하지 않음(400). 모델이 retire되면 이 한 줄만 교체하면 됨.
const SUMMARY_MODEL = "anthropic/claude-sonnet-4.5";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const MAX_MESSAGES_PER_SUMMARY = 200;
const SUMMARY_MAX_TOKENS = 1024;
const CLOSE_BATCH_LIMIT = 50;
const SUMMARIZE_BATCH_LIMIT = 8;

/**
 * OpenRouter API 키를 환경변수에서 읽어온다.
 * 없거나 빈 문자열이면 null.
 */
function resolveOpenRouterApiKey(): string | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return apiKey.trim();
}

/**
 * OpenRouter chat completions를 호출해 요약 텍스트를 반환한다.
 *
 * 이 cron의 기존 에러 처리(summarizeOneSession이 throw하고 바깥 for 루프
 * try/catch가 받음)와 일관되게, result 객체 대신 throw 기반으로 동작한다.
 * 실패 시 throw → 해당 세션만 건너뛰고 다음 run에서 재시도된다.
 *
 * route.ts의 callOpenRouter를 공용화하지 않고 자체 버전을 둠
 * (route.ts를 건드리지 않는 게 안전).
 */
async function callOpenRouterForSummary(
  apiKey: string,
  systemPrompt: string,
  conversationText: string
): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: SUMMARY_MAX_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: conversationText },
      ],
    }),
  });

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

  const content: unknown =
    (data as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenRouter response missing message content");
  }

  return content;
}

const SUMMARY_SYSTEM_PROMPT = `You are a summarization assistant for Noor, a financial guidance app for international students. Always respond in English.

You will receive a conversation between a user and Noor AI. Produce a concise summary that captures information useful for future conversations.

Your summary must:
- Be one dense paragraph (roughly 80-150 words).
- Capture concrete facts about the user (visa status, school, financial situation, goals, decisions made) — NOT generic advice Noor gave.
- Preserve specifics: numbers, bank names, visa types, deadlines.
- Be written in third person ("The user...").
- Omit pleasantries, greetings, and small talk.
- Never include full sensitive identifiers (e.g. a complete SSN or card number), even if they appear in the conversation.

After the summary paragraph, output exactly one final line in this format:
TOPICS: tag1, tag2, tag3

Where tags are 2-5 short lowercase topic tags (e.g. "TOPICS: f1_visa, chase_bank, credit_score").

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
    conversationText
  );

  if (!rawOutput.trim()) {
    throw new Error(
      `Summarization model returned empty output for session ${session.id}`
    );
  }

  const { summary, topics } = parseSummaryOutput(rawOutput);
  await createSummary(session.id, session.user_id, {
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

  const stats = {
    closed: 0,
    closeFailed: 0,
    summarized: 0,
    summarizeFailed: 0,
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
  }

  try {
    const toSummarize = await getSessionsNeedingSummary(SUMMARIZE_BATCH_LIMIT);
    for (const session of toSummarize) {
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
  }

  console.info("Summarize cron complete:", stats);
  return NextResponse.json({
    success: true,
    ...stats,
  });
}
