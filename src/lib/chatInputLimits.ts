/**
 * chatInputLimits — per-request bounds on what POST /api/chat accepts and on
 * how much conversation reaches the model.
 *
 * The client sends its conversation on every request (our client windows it
 * first; older cached bundles send all of it). The route checks that array
 * against these limits before anything that costs, but only its last user
 * message reaches the model: the history after the system prompt is read from
 * the active session's stored turns and fitted to N and T by
 * chatServerHistory.ts. Without these bounds one request could grow model
 * input cost without limit; max_tokens caps output only.
 *
 * Both sides apply the same rule to the request. The chat route enforces it on
 * every request, including requests from cached older client bundles that
 * send everything. useChat applies it before sending, so our own client never
 * meets a rejection for history size. The module has no imports so the
 * browser bundle can carry it.
 *
 * The values are provisional bounds, chosen to be well clear of normal use.
 * They are constants rather than env vars: the client must use the same
 * numbers and cannot read server env, and a defensive bound must have no
 * "misconfigured, therefore disabled" path.
 *
 * What these limits do not cover: the system prompt, including the memory
 * block, is built server-side and is not counted against T.
 */

/**
 * U. Far above a typed chat question, still room for a pasted paragraph or
 * short statement; leaves at least three quarters of T for history. A request
 * whose last user message is longer is refused; an earlier user message longer
 * than this, in the request or in stored history, is skipped.
 */
export const CHAT_MAX_LAST_USER_MESSAGE_CHARS = 4000;

/**
 * N. At most twenty user/assistant exchanges, below the 50 rows a history
 * reload can return. When replies are long the character bound T usually
 * binds before N, so the window then holds fewer exchanges than this. Bounds
 * the stored history plus the current user message that reach the model, and
 * the number of stored rows the route reads for it.
 */
export const CHAT_MAX_HISTORY_MESSAGES = 40;

/**
 * T. Bounds the conversation part of model input per request (roughly 4k
 * tokens of English, more for scripts that tokenize densely), independent of
 * any model's context window: the stored history plus the current user
 * message.
 */
export const CHAT_MAX_HISTORY_CHARS = 16000;

/**
 * B. Fixed ceiling on upload and parse work only, deliberately generous; model
 * cost is bounded by N and T, not by this. Beyond its last user message the
 * request body only costs parsing.
 */
export const CHAT_MAX_BODY_BYTES = 1048576;

export interface WindowableMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatWindowResult<M extends WindowableMessage> =
  | { ok: true; messages: M[]; dropped: number }
  | {
      ok: false;
      reason: "last_user_message_too_long" | "tail_too_long" | "empty_window";
    };

function lastUserIndex(messages: readonly WindowableMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function totalChars(messages: readonly WindowableMessage[]): number {
  let total = 0;
  for (let i = 0; i < messages.length; i += 1) {
    total += messages[i].content.length;
  }
  return total;
}

/**
 * True when the last user-role message is longer than U. Lengths are UTF-16
 * code units (String.prototype.length), the same measure on client and server.
 */
export function isLastUserMessageTooLong(
  messages: readonly WindowableMessage[]
): boolean {
  const index = lastUserIndex(messages);
  return (
    index >= 0 &&
    messages[index].content.length > CHAT_MAX_LAST_USER_MESSAGE_CHARS
  );
}

/**
 * Fits a conversation inside N messages and T characters.
 *
 * 1. Within limits (at most N messages, at most T characters in total, every
 *    user message at most U) the input array itself is returned, so a request
 *    inside the limits reaches the model exactly as sent.
 * 2. A last user message longer than U is refused: it is the user's actual
 *    question and must not be cut silently.
 * 3. The suffix starting at the last user message is always kept. If that
 *    suffix alone exceeds N or T the request is refused; our client never
 *    sends anything after its last user message, so only a non-standard client
 *    reaches this.
 * 4. Earlier messages are added newest first. A user message longer than U is
 *    skipped (a message the client refused to send stays in its state and must
 *    not re-enter here); filling stops at N messages or when the next message
 *    would push the total over T.
 * 5. After trimming, leading assistant messages are dropped so the window
 *    starts with a user message: a reply whose question was cut is context
 *    without its premise. This step only runs when the conversation has a user
 *    message, and never on a request that step 1 returned.
 * 6. A window with no messages left is refused: the model would receive the
 *    system prompt alone. Only input without a user message gets here (an
 *    empty array, or assistant messages whose newest alone exceeds T); with a
 *    user message the kept suffix is never empty.
 */
export function windowChatMessages<M extends WindowableMessage>(
  messages: M[]
): ChatWindowResult<M> {
  let withinLimits =
    messages.length > 0 &&
    messages.length <= CHAT_MAX_HISTORY_MESSAGES &&
    totalChars(messages) <= CHAT_MAX_HISTORY_CHARS;
  for (let i = 0; withinLimits && i < messages.length; i += 1) {
    if (
      messages[i].role === "user" &&
      messages[i].content.length > CHAT_MAX_LAST_USER_MESSAGE_CHARS
    ) {
      withinLimits = false;
    }
  }
  if (withinLimits) {
    return { ok: true, messages, dropped: 0 };
  }

  if (isLastUserMessageTooLong(messages)) {
    return { ok: false, reason: "last_user_message_too_long" };
  }

  const tailStart = lastUserIndex(messages);
  const hasUserMessage = tailStart >= 0;
  const tail = hasUserMessage ? messages.slice(tailStart) : [];
  let count = tail.length;
  let total = totalChars(tail);
  if (count > CHAT_MAX_HISTORY_MESSAGES || total > CHAT_MAX_HISTORY_CHARS) {
    return { ok: false, reason: "tail_too_long" };
  }

  const earlierNewestFirst: M[] = [];
  const scanFrom = hasUserMessage ? tailStart - 1 : messages.length - 1;
  for (let i = scanFrom; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message.role === "user" &&
      message.content.length > CHAT_MAX_LAST_USER_MESSAGE_CHARS
    ) {
      continue;
    }
    if (count + 1 > CHAT_MAX_HISTORY_MESSAGES) break;
    if (total + message.content.length > CHAT_MAX_HISTORY_CHARS) break;
    earlierNewestFirst.push(message);
    count += 1;
    total += message.content.length;
  }

  const kept = earlierNewestFirst.reverse().concat(tail);
  let start = 0;
  if (hasUserMessage) {
    while (start < kept.length && kept[start].role === "assistant") {
      start += 1;
    }
  }
  const windowed = kept.slice(start);
  if (windowed.length === 0) {
    return { ok: false, reason: "empty_window" };
  }

  return {
    ok: true,
    messages: windowed,
    dropped: messages.length - windowed.length,
  };
}

/**
 * The messages useChat sends for one turn: its history plus the new user
 * message, reduced to role and content, inside the same window the route
 * applies. Null when the window refuses the turn, which for our client means
 * the new message is longer than U.
 */
export function buildChatRequestMessages(
  history: readonly WindowableMessage[],
  newUserMessage: WindowableMessage
): WindowableMessage[] | null {
  const conversation = history
    .concat([newUserMessage])
    .map((message) => ({ role: message.role, content: message.content }));
  const result = windowChatMessages(conversation);
  return result.ok ? result.messages : null;
}
