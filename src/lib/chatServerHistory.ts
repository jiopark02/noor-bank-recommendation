/**
 * chatServerHistory — the conversation POST /api/chat sends to the model: the
 * active session's stored turns, oldest first, followed by the current user
 * message.
 *
 * The request body is not a source of history. Whatever else the client sends
 * is validated against the input limits and then ignored, so a turn the client
 * invents never reaches the model.
 *
 * Stored rows are not guaranteed to alternate. saveMessages writes each
 * user/assistant pair in one insert with app-chosen timestamps, so two turns
 * saved close together can interleave (user A, user B, assistant A, assistant
 * B), and a row limit can cut the oldest pair in half. normalizeStoredHistory
 * makes the model's copy alternate; the rows themselves are not changed.
 */

import { windowChatMessages, type WindowableMessage } from "./chatInputLimits";

/**
 * Makes a stored history alternate, starting with a user message and ending
 * with an assistant message:
 *
 * 1. Leading assistant messages are dropped: a reply whose question was cut is
 *    context without its premise.
 * 2. In a run of messages with the same role only the first is kept. For
 *    interleaved pairs (uA, uB, aA, aB) that keeps uA and aA, which belong
 *    together; for two replies left adjacent by a skipped question it keeps
 *    the one whose question is still there.
 * 3. A trailing user message is dropped, so the current user message can
 *    follow without two user messages in a row.
 *
 * Applying it twice gives the same result as applying it once.
 */
export function normalizeStoredHistory<M extends WindowableMessage>(
  messages: readonly M[]
): M[] {
  const out: M[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (out.length === 0 && message.role === "assistant") continue;
    if (out.length > 0 && out[out.length - 1].role === message.role) continue;
    out.push(message);
  }
  if (out.length > 0 && out[out.length - 1].role === "user") {
    out.pop();
  }
  return out;
}

export interface ModelConversation {
  /** The conversation after the system prompt, ending with the current user message. */
  messages: WindowableMessage[];
  /** Stored rows passed in. */
  stored: number;
  /** Stored rows that reach the model. */
  kept: number;
  /** Stored rows left out by normalizing or by the N and T limits. */
  dropped: number;
  /**
   * True when the window refused the conversation and only the current user
   * message was sent. The body checks already bound that message by U, so this
   * is not expected to happen.
   */
  windowRefused: boolean;
}

/**
 * Builds the model's conversation from stored rows (oldest first) and the
 * current user message.
 *
 * The rows are normalized, the result plus the current message is fitted to
 * the N and T limits by windowChatMessages (newest first, stored user messages
 * longer than U skipped), and the kept history is normalized again because
 * skipping can leave two replies adjacent. Only role and content are kept.
 */
export function buildModelConversation(
  storedRows: readonly WindowableMessage[],
  currentUserContent: string
): ModelConversation {
  const current: WindowableMessage = { role: "user", content: currentUserContent };
  const history = normalizeStoredHistory(
    storedRows.map((row) => ({ role: row.role, content: row.content }))
  );

  const windowed = windowChatMessages(history.concat([current]));
  if (!windowed.ok) {
    return {
      messages: [current],
      stored: storedRows.length,
      kept: 0,
      dropped: storedRows.length,
      windowRefused: true,
    };
  }

  const kept = normalizeStoredHistory(
    windowed.messages.slice(0, windowed.messages.length - 1)
  );
  return {
    messages: kept.concat([current]),
    stored: storedRows.length,
    kept: kept.length,
    dropped: storedRows.length - kept.length,
    windowRefused: false,
  };
}
