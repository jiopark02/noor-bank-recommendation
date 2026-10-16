import { describe, it, expect } from "vitest";
import {
  CHAT_MAX_BODY_BYTES,
  CHAT_MAX_HISTORY_CHARS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_LAST_USER_MESSAGE_CHARS,
  buildChatRequestMessages,
  isLastUserMessageTooLong,
  windowChatMessages,
  type WindowableMessage,
} from "../chatInputLimits";

/**
 * windowChatMessages decides what part of a client-sent conversation reaches
 * the model, on the server and, through buildChatRequestMessages, in useChat.
 * The first group pins that a request inside the limits is returned as the
 * same array, so the limits change nothing for it.
 */

const U = CHAT_MAX_LAST_USER_MESSAGE_CHARS;
const N = CHAT_MAX_HISTORY_MESSAGES;
const T = CHAT_MAX_HISTORY_CHARS;

function user(content: string): WindowableMessage {
  return { role: "user", content };
}

function assistant(content: string): WindowableMessage {
  return { role: "assistant", content };
}

/** n messages alternating user/assistant, starting with user, ending with user when n is odd. */
function conversation(n: number, size = 10): WindowableMessage[] {
  const out: WindowableMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    const text = `m${i}`.padEnd(size, ".");
    out.push(i % 2 === 0 ? user(text) : assistant(text));
  }
  return out;
}

function windowed(messages: WindowableMessage[]): WindowableMessage[] {
  const result = windowChatMessages(messages);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.messages;
}

describe("within the limits the input is returned unchanged", () => {
  it("returns the same array reference, dropped 0", () => {
    const input = conversation(N - 1);
    const result = windowChatMessages(input);
    expect(result).toEqual({ ok: true, messages: input, dropped: 0 });
    expect(result.ok && result.messages).toBe(input);
  });

  it("at exactly N messages and exactly T characters", () => {
    const input = conversation(N, T / N);
    expect(input.length).toBe(N);
    expect(input.reduce((s, m) => s + m.content.length, 0)).toBe(T);
    const result = windowChatMessages(input);
    expect(result.ok && result.messages).toBe(input);
  });

  it("a within-limit conversation that starts with an assistant message is not altered", () => {
    const input = [assistant("hello, how can I help?"), user("hi")];
    const result = windowChatMessages(input);
    expect(result.ok && result.messages).toBe(input);
  });

  it("a last user message of exactly U is within the limits", () => {
    const input = [user("x".repeat(U))];
    const result = windowChatMessages(input);
    expect(result.ok && result.messages).toBe(input);
  });
});

describe("over the limits", () => {
  it("N + 1 messages: the oldest go, the last user message stays", () => {
    const input = conversation(N + 1); // indices 0..N, user at even indices
    const out = windowed(input);
    // The newest N are indices 1..N; index 1 is an assistant left at the
    // front, so it goes too and the window starts at index 2.
    expect(out).toHaveLength(N - 1);
    expect(out[0]).toBe(input[2]);
    expect(out[out.length - 1]).toBe(input[input.length - 1]);
    expect(windowChatMessages(input)).toMatchObject({ ok: true, dropped: 2 });
  });

  it("total exactly T is kept whole; T + 1 drops what no longer fits", () => {
    const exact = [user("a".repeat(U)), assistant("b".repeat(T - 2 * U)), user("c".repeat(U))];
    const exactResult = windowChatMessages(exact);
    expect(exactResult.ok && exactResult.messages).toBe(exact);

    const over = [user("a".repeat(U)), assistant("b".repeat(T - 2 * U + 1)), user("c".repeat(U))];
    // The oldest user message no longer fits; the assistant it leaves at the
    // front is dropped too.
    expect(windowed(over)).toEqual([over[2]]);
  });

  it("filling stops at the first message that does not fit, it does not look further back", () => {
    const input = [
      user("small"),
      assistant("small"),
      user("x".repeat(U)),
      assistant("y".repeat(T - U - 10)),
      user("z".repeat(U)),
    ];
    // Tail (last user) U + assistant (T - U - 10) = T - 10; the U-length user
    // before it does not fit, so the two small ones before that are not taken.
    expect(windowed(input)).toEqual([input[4]]);
  });

  it("a history user message longer than U is skipped, older messages are still kept", () => {
    const input = [
      user("old question"),
      assistant("old answer"),
      user("x".repeat(U + 1)),
      user("new question"),
    ];
    expect(windowed(input)).toEqual([input[0], input[1], input[3]]);
  });

  it("a long assistant message is not skipped for exceeding U", () => {
    const input = [
      user("x".repeat(U + 1)),
      user("question"),
      assistant("y".repeat(U + 500)),
      user("follow-up"),
    ];
    expect(windowed(input)).toEqual([input[1], input[2], input[3]]);
  });

  it("a trimmed window never starts with an assistant message", () => {
    const input = conversation(N + 3); // starts and ends with a user message
    const out = windowed(input);
    expect(out[0].role).toBe("user");
    expect(out).toHaveLength(N - 1);
    expect(out[out.length - 1]).toBe(input[input.length - 1]);
  });

  it("without any user message, trimming keeps the newest messages and adds no refusal", () => {
    const input: WindowableMessage[] = [];
    for (let i = 0; i < N + 3; i += 1) input.push(assistant(`a${i}`));
    const out = windowed(input);
    expect(out).toHaveLength(N);
    expect(out[out.length - 1]).toBe(input[input.length - 1]);
  });
});

describe("refusals", () => {
  it("a last user message of U + 1 is refused", () => {
    const input = [user("x".repeat(U + 1))];
    expect(windowChatMessages(input)).toEqual({
      ok: false,
      reason: "last_user_message_too_long",
    });
    expect(isLastUserMessageTooLong(input)).toBe(true);
    expect(isLastUserMessageTooLong([user("x".repeat(U))])).toBe(false);
  });

  it("messages after the last user message that exceed T are refused, not kept", () => {
    const input = [user("question"), assistant("y".repeat(T))];
    expect(windowChatMessages(input)).toEqual({ ok: false, reason: "tail_too_long" });
  });

  it("an empty window is refused: no user message and the newest assistant message exceeds T", () => {
    const input = [assistant("short"), assistant("y".repeat(T + 1))];
    expect(windowChatMessages(input)).toEqual({ ok: false, reason: "empty_window" });
  });

  it("an empty conversation is refused as an empty window", () => {
    expect(windowChatMessages([])).toEqual({ ok: false, reason: "empty_window" });
  });

  it("isLastUserMessageTooLong looks at the last user message, not the last message", () => {
    expect(isLastUserMessageTooLong([user("x".repeat(U + 1)), assistant("ok")])).toBe(true);
    expect(isLastUserMessageTooLong([assistant("x".repeat(U + 1))])).toBe(false);
  });
});

describe("buildChatRequestMessages (useChat)", () => {
  it("equals the window of history plus the new message, reduced to role and content", () => {
    const history = conversation(N + 5).map((m, i) => ({ ...m, id: `id${i}`, timestamp: new Date(0) }));
    const next = { role: "user" as const, content: "next", id: "x", timestamp: new Date(0) };
    const built = buildChatRequestMessages(history, next);
    const expected = windowed(
      history.concat([next]).map((m) => ({ role: m.role, content: m.content }))
    );
    expect(built).toEqual(expected);
    expect(built && built.every((m) => Object.keys(m).sort().join() === "content,role")).toBe(true);
  });

  it("within the limits, it sends the whole conversation", () => {
    const history = conversation(4);
    const built = buildChatRequestMessages(history, user("next"));
    expect(built).toEqual(history.concat([user("next")]));
  });

  it("returns null when the new message is longer than U", () => {
    expect(buildChatRequestMessages([], user("x".repeat(U + 1)))).toBeNull();
  });
});

describe("B stays above anything our own client can send", () => {
  it("N messages totalling T characters of worst-case encoding fit under B", () => {
    // The client sends JSON.stringify({ messages }). Per UTF-16 unit the most
    // bytes come from a control character escaped as \u00XX (6 bytes); a
    // 3-byte UTF-8 character is checked as well.
    for (const ch of ["\u0001", "가"]) {
      const perMessage = T / N;
      const messages = [];
      for (let i = 0; i < N; i += 1) {
        messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: ch.repeat(perMessage) });
      }
      const bytes = new TextEncoder().encode(JSON.stringify({ messages })).byteLength;
      expect(bytes).toBeLessThanOrEqual(CHAT_MAX_BODY_BYTES);
    }
  });
});
