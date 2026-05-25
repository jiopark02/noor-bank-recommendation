import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
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

const SUMMARY_MODEL = "claude-sonnet-4-5-20250929";
const MAX_MESSAGES_PER_SUMMARY = 200;
const SUMMARY_MAX_TOKENS = 1024;
const CLOSE_BATCH_LIMIT = 50;
const SUMMARIZE_BATCH_LIMIT = 8;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return new Anthropic({ apiKey });
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

  const matches = [...text.matchAll(/^TOPICS:\s*(.+)$/gim)];

  if (matches.length === 0) {
    return { summary: text, topics: [] };
  }

  const lastMatch = matches[matches.length - 1];
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
  anthropic: Anthropic,
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

  const response = await anthropic.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: SUMMARY_MAX_TOKENS,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: conversationText }],
  });

  const rawOutput =
    response.content[0]?.type === "text" ? response.content[0].text : "";

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

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    console.error("Summarize cron: ANTHROPIC_API_KEY not configured");
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
        await summarizeOneSession(anthropic, session);
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
