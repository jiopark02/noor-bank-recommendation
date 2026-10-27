/**
 * summaryCrisisGate — the last step of the summarize cron: store the parsed
 * summary, unless the summary or any of its topics carries a crisis signal.
 *
 * A summary with a signal is not stored at all, and the session is marked
 * summarized so the cron does not ask the model again. Its financial context
 * is lost with it; that is the decided trade-off. Nothing is logged and
 * nothing is counted separately: the cron's logs and llm_calls rows name the
 * session, so any line here could tie crisis content to a user.
 *
 * The dependencies are passed in, so the order is held by tests that execute
 * it rather than by reading the route.
 */

import { detectCrisisSignal } from "@/lib/crisisSignals";
import type {
  ChatSession,
  ChatSummary,
  NewChatSummary,
} from "@/lib/aiMemory";

export interface SummaryStoreDeps {
  createSummary: (
    sessionId: string,
    userId: string,
    input: NewChatSummary
  ) => Promise<ChatSummary>;
  markSessionSummarized: (sessionId: string, userId: string) => Promise<void>;
}

function hasCrisisSignal(summary: string, topics: string[]): boolean {
  if (detectCrisisSignal(summary) !== null) return true;
  for (let i = 0; i < topics.length; i += 1) {
    if (detectCrisisSignal(topics[i]) !== null) return true;
  }
  return false;
}

export async function storeSummaryUnlessCrisis(
  deps: SummaryStoreDeps,
  session: Pick<ChatSession, "id" | "user_id">,
  input: NewChatSummary
): Promise<void> {
  if (hasCrisisSignal(input.summary, input.topics ?? [])) {
    await deps.markSessionSummarized(session.id, session.user_id);
    return;
  }
  await deps.createSummary(session.id, session.user_id, input);
}
