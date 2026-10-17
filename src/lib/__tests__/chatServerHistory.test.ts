import { describe, it, expect } from "vitest";
import {
  buildModelConversation,
  normalizeStoredHistory,
} from "../chatServerHistory";
import {
  CHAT_MAX_HISTORY_CHARS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_LAST_USER_MESSAGE_CHARS,
} from "../chatInputLimits";

/**
 * The model's conversation is built from stored rows, which need not
 * alternate: a row limit can cut a pair, and pairs saved close together can
 * interleave. Whatever the rows, the model must receive a conversation that
 * starts with a user message, alternates, and ends with the current message.
 */

type Msg = { role: "user" | "assistant"; content: string };

const u = (content: string): Msg => ({ role: "user", content });
const a = (content: string): Msg => ({ role: "assistant", content });

/** Every role sequence of the given length, contents numbered by position. */
function allSequences(length: number): Msg[][] {
  const out: Msg[][] = [];
  for (let mask = 0; mask < 1 << length; mask += 1) {
    const seq: Msg[] = [];
    for (let i = 0; i < length; i += 1) {
      seq.push(mask & (1 << i) ? a(`m${i}`) : u(`m${i}`));
    }
    out.push(seq);
  }
  return out;
}

function pairs(count: number, chars: number): Msg[] {
  const out: Msg[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(u(`u${i}`.padEnd(chars, ".")), a(`a${i}`.padEnd(chars, ".")));
  }
  return out;
}

describe("normalizeStoredHistory", () => {
  it("drops leading assistant rows left by a row limit", () => {
    expect(normalizeStoredHistory([a("cut"), a("cut2"), u("q1"), a("r1")])).toEqual([
      u("q1"),
      a("r1"),
    ]);
  });

  it("keeps the first pair of interleaved turns", () => {
    expect(normalizeStoredHistory([u("qA"), u("qB"), a("rA"), a("rB")])).toEqual([
      u("qA"),
      a("rA"),
    ]);
  });

  it("drops a trailing user row", () => {
    expect(normalizeStoredHistory([u("q1"), a("r1"), u("q2")])).toEqual([u("q1"), a("r1")]);
  });

  it("gives the same result when applied twice", () => {
    for (let length = 0; length <= 8; length += 1) {
      for (const seq of allSequences(length)) {
        const once = normalizeStoredHistory(seq);
        expect(normalizeStoredHistory(once)).toEqual(once);
      }
    }
  });
});

describe("buildModelConversation", () => {
  it("with no stored rows the model receives the current message alone", () => {
    expect(buildModelConversation([], "now")).toEqual({
      messages: [u("now")],
      stored: 0,
      kept: 0,
      dropped: 0,
      windowRefused: false,
    });
  });

  it("appends the current message to the stored turns", () => {
    const rows = [u("q1"), a("r1"), u("q2"), a("r2")];
    const result = buildModelConversation(rows, "now");
    expect(result.messages).toEqual([...rows, u("now")]);
    expect(result).toMatchObject({ stored: 4, kept: 4, dropped: 0 });
  });

  it("for every role sequence up to eight rows: starts with user, alternates, ends with the current message", () => {
    for (let length = 0; length <= 8; length += 1) {
      for (const seq of allSequences(length)) {
        const { messages, kept, dropped } = buildModelConversation(seq, "now");
        expect(messages[0].role).toBe("user");
        for (let i = 1; i < messages.length; i += 1) {
          expect(messages[i].role).not.toBe(messages[i - 1].role);
        }
        expect(messages[messages.length - 1]).toEqual(u("now"));
        // Kept rows are input rows, in input order.
        const positions = messages
          .slice(0, -1)
          .map((m) => seq.findIndex((s) => s.content === m.content && s.role === m.role));
        expect(positions.every((p) => p >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((x, y) => x - y));
        expect(kept + dropped).toBe(seq.length);
      }
    }
  });

  it("over T: keeps the newest rows that fit, then starts at a user message", () => {
    // Ten pairs of 1000-character rows: fifteen rows fit beside "now", the
    // oldest of them an assistant row, which is then dropped.
    const rows = pairs(10, 1000);
    const result = buildModelConversation(rows, "now");
    expect(result.messages).toEqual([...rows.slice(6), u("now")]);
    expect(result.dropped).toBe(6);
    const chars = result.messages.reduce((n, m) => n + m.content.length, 0);
    expect(chars).toBeLessThanOrEqual(CHAT_MAX_HISTORY_CHARS);
  });

  it("over N: at most N messages including the current one", () => {
    const rows = pairs(30, 5);
    const result = buildModelConversation(rows, "now");
    expect(result.messages.length).toBeLessThanOrEqual(CHAT_MAX_HISTORY_MESSAGES);
    expect(result.messages[0]).toEqual(rows[22]);
    expect(result.messages[result.messages.length - 1]).toEqual(u("now"));
  });

  it("a stored user row longer than U is skipped, and the two replies it leaves adjacent are reduced to the first", () => {
    const longQuestion = u("x".repeat(CHAT_MAX_LAST_USER_MESSAGE_CHARS + 1));
    const rows = [u("q1"), a("r1"), longQuestion, a("reply to the long question")];
    expect(buildModelConversation(rows, "now").messages).toEqual([u("q1"), a("r1"), u("now")]);
  });

  it("interleaved pairs reach the model as the first pair only", () => {
    const rows = [u("qA"), u("qB"), a("rA"), a("rB")];
    expect(buildModelConversation(rows, "now").messages).toEqual([u("qA"), a("rA"), u("now")]);
  });

  it("passes only role and content to the model", () => {
    const row = {
      id: "m1",
      session_id: "s1",
      user_id: "u1",
      role: "user" as const,
      content: "q1",
      model: null,
      created_at: "2026-10-17T00:00:00.000Z",
    };
    const reply = { ...row, id: "m2", role: "assistant" as const, content: "r1", model: "x" };
    const { messages } = buildModelConversation([row, reply], "now");
    for (const message of messages) {
      expect(Object.keys(message).sort()).toEqual(["content", "role"]);
    }
  });
});
