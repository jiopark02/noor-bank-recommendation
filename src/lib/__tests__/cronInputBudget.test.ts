import { describe, it, expect, vi } from "vitest";
import {
  CRON_MAX_CONVERSATION_CHARS,
  CRON_MAX_EXISTING_FACTS_CHARS,
  CRON_MAX_MESSAGE_CHARS,
  CRON_MAX_NEW_FACTS_PER_SESSION,
  CRON_MESSAGE_HEAD_CHARS,
  CRON_MESSAGE_TAIL_CHARS,
  budgetExistingFacts,
  buildCronConversationText,
  capNewFacts,
  logCronInputBudget,
  omissionMarker,
  truncateCronMessage,
} from "@/lib/cronInputBudget";

/** True when some UTF-16 surrogate has lost the other half of its pair. */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Splits a truncated message back into head, omitted count and tail. */
function splitTruncated(result: string): { head: string; omitted: number; tail: string } {
  const match = /\n\[… (\d+) characters omitted …\]\n/.exec(result);
  expect(match, "omission marker").not.toBeNull();
  const m = match as RegExpExecArray;
  return {
    head: result.slice(0, m.index),
    omitted: Number(m[1]),
    tail: result.slice(m.index + m[0].length),
  };
}

/** The serialization the crons used before the budget, for unchanged input. */
function unbudgeted(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Noor"}: ${m.content}`)
    .join("\n\n");
}

describe("truncateCronMessage", () => {
  it("leaves a message at the limit unchanged", () => {
    const content = "a".repeat(CRON_MAX_MESSAGE_CHARS);
    expect(truncateCronMessage(content)).toBe(content);
  });

  it("keeps the head and the tail of a longer message around the marker", () => {
    const content = "a".repeat(3000) + "b".repeat(1000) + "c".repeat(1000);
    expect(truncateCronMessage(content)).toBe(
      "a".repeat(3000) + "\n[… 1000 characters omitted …]\n" + "c".repeat(1000)
    );
  });

  it("truncates a message one character over the limit", () => {
    const content = "a".repeat(CRON_MAX_MESSAGE_CHARS + 1);
    const { head, omitted, tail } = splitTruncated(truncateCronMessage(content));
    expect(head.length).toBe(CRON_MESSAGE_HEAD_CHARS);
    expect(tail.length).toBe(CRON_MESSAGE_TAIL_CHARS);
    expect(omitted).toBe(1);
  });

  it("accounts for every character: head + omitted + tail is the input length", () => {
    let content = "";
    for (let i = 0; content.length < 9000; i += 1) content += `${i},`;
    const { head, omitted, tail } = splitTruncated(truncateCronMessage(content));
    expect(head).toBe(content.slice(0, head.length));
    expect(tail).toBe(content.slice(content.length - tail.length));
    expect(head.length + omitted + tail.length).toBe(content.length);
  });

  it("does not split a surrogate pair at the head cut", () => {
    // The emoji takes code units 2999 and 3000, across the head limit.
    const content = "x".repeat(2999) + "😀" + "y".repeat(2000);
    const result = truncateCronMessage(content);
    expect(hasLoneSurrogate(result)).toBe(false);
    const { head, omitted, tail } = splitTruncated(result);
    expect(head).toBe("x".repeat(2999));
    expect(head.length + omitted + tail.length).toBe(content.length);
  });

  it("does not split a surrogate pair at the tail cut", () => {
    // The emoji takes the two code units on either side of the tail start.
    const content = "x".repeat(4000) + "😀" + "z".repeat(999);
    const result = truncateCronMessage(content);
    expect(hasLoneSurrogate(result)).toBe(false);
    const { head, omitted, tail } = splitTruncated(result);
    expect(tail).toBe("z".repeat(999));
    expect(head.length + omitted + tail.length).toBe(content.length);
  });

  it("writes the marker in English with the omitted count", () => {
    expect(omissionMarker(42)).toBe("[… 42 characters omitted …]");
  });
});

describe("buildCronConversationText", () => {
  it("serializes a conversation under the budget exactly as before", () => {
    const messages = [
      { role: "user", content: "My rent is $1,200." },
      { role: "assistant", content: "Got it." },
      { role: "user", content: "😀 thanks" },
    ];
    expect(buildCronConversationText(messages)).toEqual({
      text: unbudgeted(messages),
      truncated: 0,
      dropped: 0,
    });
  });

  it("keeps a conversation that fills the budget exactly", () => {
    // 11 lines of 3998, one of 4000, and 11 separators of 2: 48000 in total.
    const messages = [];
    for (let i = 0; i < 11; i += 1) {
      messages.push({ role: "user", content: "m".repeat(3992) });
    }
    messages.push({ role: "user", content: "n".repeat(3994) });
    const result = buildCronConversationText(messages);
    expect(result.text.length).toBe(CRON_MAX_CONVERSATION_CHARS);
    expect(result.dropped).toBe(0);

    const withOneMore = buildCronConversationText([
      { role: "user", content: "x" },
      ...messages,
    ]);
    expect(withOneMore.dropped).toBe(1);
    expect(withOneMore.text).toBe(result.text);
  });

  it("keeps the newest messages and leaves the oldest out first", () => {
    const messages = [{ role: "user", content: "OLDEST-TINY" }];
    for (let i = 0; i < 15; i += 1) {
      const letter = String.fromCharCode(65 + i);
      messages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: letter.repeat(CRON_MAX_MESSAGE_CHARS),
      });
    }
    const result = buildCronConversationText(messages);

    // Each line is 6 + 4000 code units; 11 of them and 10 separators fit.
    expect(result.dropped).toBe(5);
    expect(result.truncated).toBe(0);
    expect(result.text.length).toBeLessThanOrEqual(CRON_MAX_CONVERSATION_CHARS);
    // The kept part is the newest stretch, oldest first, nothing skipped.
    expect(result.text).toBe(unbudgeted(messages.slice(5)));
    // The tiny oldest message would fit on its own but is not picked up.
    expect(result.text).not.toContain("OLDEST-TINY");
  });

  it("truncates each message before counting it", () => {
    const long = "a".repeat(3000) + "b".repeat(5000) + "c".repeat(1000);
    const result = buildCronConversationText([
      { role: "user", content: long },
      { role: "assistant", content: "ok" },
    ]);
    expect(result.truncated).toBe(1);
    expect(result.dropped).toBe(0);
    expect(result.text).toBe(
      `User: ${truncateCronMessage(long)}\n\nNoor: ok`
    );
    expect(result.text).not.toContain("b");
  });

  it("returns an empty text for no messages", () => {
    expect(buildCronConversationText([])).toEqual({
      text: "",
      truncated: 0,
      dropped: 0,
    });
  });
});

describe("budgetExistingFacts", () => {
  const makeFacts = (count: number, length: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `fact-${i}`,
      category: "financial",
      fact: `${i}:`.padEnd(length, "f"),
    }));

  it("numbers a set under the budget exactly as before", () => {
    const facts = makeFacts(3, 20);
    const result = budgetExistingFacts(facts);
    expect(result.facts).toEqual(facts);
    expect(result.dropped).toBe(0);
    expect(result.text).toBe(
      facts.map((f, i) => `[${i + 1}] (${f.category}) ${f.fact}`).join("\n")
    );
  });

  it("keeps the leading facts and numbers exactly the facts it returns", () => {
    const facts = makeFacts(60, 490);
    const result = budgetExistingFacts(facts);
    const kept = result.facts.length;

    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(60);
    expect(result.dropped).toBe(60 - kept);
    expect(result.text.length).toBeLessThanOrEqual(CRON_MAX_EXISTING_FACTS_CHARS);
    // The leading facts, in order: the newest when the caller passes newest first.
    expect(result.facts).toEqual(facts.slice(0, kept));
    // One line per returned fact, numbered 1..kept, and nothing past it.
    const lines = result.text.split("\n");
    expect(lines).toHaveLength(kept);
    expect(lines[kept - 1].startsWith(`[${kept}] `)).toBe(true);
    expect(result.text).not.toContain(`[${kept + 1}] `);
  });

  it("writes (none) for no facts", () => {
    expect(budgetExistingFacts([])).toEqual({
      facts: [],
      text: "(none)",
      dropped: 0,
    });
  });

  it("returns no facts when the first one alone is over the budget", () => {
    const facts = makeFacts(2, CRON_MAX_EXISTING_FACTS_CHARS);
    expect(budgetExistingFacts(facts)).toEqual({
      facts: [],
      text: "(none)",
      dropped: 2,
    });
  });
});

describe("capNewFacts", () => {
  const items = (count: number) => Array.from({ length: count }, (_, i) => ({ n: i }));

  it("returns the items unchanged at the cap and logs nothing", () => {
    const warn = vi.fn();
    const input = items(CRON_MAX_NEW_FACTS_PER_SESSION);
    expect(capNewFacts(input, warn)).toEqual(input);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the first items in order and logs only how many were left out", () => {
    const warn = vi.fn();
    const input = items(CRON_MAX_NEW_FACTS_PER_SESSION + 5);
    expect(capNewFacts(input, warn)).toEqual(
      input.slice(0, CRON_MAX_NEW_FACTS_PER_SESSION)
    );
    expect(warn.mock.calls).toEqual([["[cron-facts-cap] dropped=%d", 5]]);
  });

  it("caps an answer one over the limit", () => {
    const warn = vi.fn();
    const result = capNewFacts(items(CRON_MAX_NEW_FACTS_PER_SESSION + 1), warn);
    expect(result).toHaveLength(CRON_MAX_NEW_FACTS_PER_SESSION);
    expect(warn.mock.calls).toEqual([["[cron-facts-cap] dropped=%d", 1]]);
  });
});

describe("logCronInputBudget", () => {
  it("logs counts and the route only", () => {
    const info = vi.fn();
    logCronInputBudget("cron_summarize", { truncated: 2, dropped: 3 }, undefined, info);
    logCronInputBudget("cron_extract_facts", { truncated: 0, dropped: 1 }, 4, info);
    expect(info.mock.calls).toEqual([
      ["[cron-input] route=%s truncated=%d dropped=%d", "cron_summarize", 2, 3],
      [
        "[cron-input] route=%s truncated=%d dropped=%d facts_dropped=%d",
        "cron_extract_facts",
        0,
        1,
        4,
      ],
    ]);
  });
});
