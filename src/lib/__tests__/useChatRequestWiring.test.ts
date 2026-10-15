import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * useChat builds the /api/chat request through buildChatRequestMessages and
 * sends messages only.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. There is no React test setup, so
 * nothing here runs the hook. What executes is chatInputLimits.test.ts, which
 * runs buildChatRequestMessages itself. This file only proves the hook calls
 * it and that the request body names no field other than messages.
 */

const source = readFileSync(
  fileURLToPath(new URL("../../hooks/useChat.ts", import.meta.url)),
  "utf8"
).replace(/\r\n?/g, "\n");

function occurrences(needle: string): number {
  return source.split(needle).length - 1;
}

describe("useChat request wiring", () => {
  it("builds the messages through buildChatRequestMessages, once", () => {
    expect(occurrences("buildChatRequestMessages(messages, userMessage)")).toBe(1);
    expect(occurrences("[...messages, userMessage]")).toBe(0);
  });

  it("the only fetch with a body sends { messages } and no userContext", () => {
    expect(occurrences("body: JSON.stringify(")).toBe(1);
    const start = source.indexOf("body: JSON.stringify(");
    const end = source.indexOf("})", start);
    const bodyExpression = source.slice(start, end + 2);
    expect(bodyExpression.replace(/\s+/g, " ")).toBe(
      "body: JSON.stringify({ messages: apiMessages, })"
    );
  });

  it("an over-long message returns before fetch", () => {
    const guard = source.indexOf("if (!apiMessages) {");
    const fetchCall = source.indexOf('fetch("/api/chat"');
    expect(guard).toBeGreaterThan(-1);
    expect(fetchCall).toBeGreaterThan(guard);
    const guardBody = source.slice(guard, source.indexOf("\n      }\n", guard));
    expect(guardBody).toContain("return;");
  });

  it("an over-long message releases the send lock and the loading state before it returns", () => {
    // The refusal returns outside the try/finally that normally resets both,
    // so it must reset them itself. Without isSendingRef.current = false every
    // later send in the tab is ignored by the guard at the top of sendMessage.
    const guard = source.indexOf("if (!apiMessages) {");
    const guardLines = source
      .slice(guard, source.indexOf("\n      }\n", guard))
      .split("\n")
      .map((line) => line.trim());
    const returnAt = guardLines.indexOf("return;");
    const unlockAt = guardLines.indexOf("isSendingRef.current = false;");
    const loadingAt = guardLines.indexOf("setIsLoading(false);");
    expect(returnAt).toBeGreaterThan(-1);
    expect(unlockAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(-1);
    expect(unlockAt).toBeLessThan(returnAt);
    expect(loadingAt).toBeLessThan(returnAt);
  });
});
