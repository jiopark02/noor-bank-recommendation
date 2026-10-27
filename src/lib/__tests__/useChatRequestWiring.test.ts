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

  it("a usage-limit refusal shows the server's text in the bubble, not the generic retry text", () => {
    // The generic "try again in a moment" is wrong for the 24-hour and 30-day
    // limits, so on USAGE_LIMIT_REACHED the bubble carries the route's text,
    // which names the window. Every other error keeps the generic text.
    const notOk = source.indexOf("if (!response.ok) {");
    expect(notOk).toBeGreaterThan(-1);
    const notOkBody = source.slice(notOk, source.indexOf("\n        }\n", notOk));
    expect(notOkBody).toContain(
      'if (data.code === "USAGE_LIMIT_REACHED" && serverMessage) {'
    );
    expect(notOkBody).toContain("usageLimitMessage = serverMessage;");
    expect(occurrences("usageLimitMessage = ")).toBe(1);
    expect(occurrences("let usageLimitMessage: string | null = null;")).toBe(1);

    // The send's own catch: the first one after the response check.
    const catchAt = source.indexOf("} catch (err) {", notOk);
    expect(catchAt).toBeGreaterThan(notOk);
    const catchBody = source.slice(catchAt, source.indexOf("} finally {", catchAt));
    expect(catchBody.replace(/\s+/g, " ")).toContain(
      'content: usageLimitMessage ?? "Sorry, there was an error generating a response. Please try again in a moment.",'
    );
  });

  it("an error response's crisisNotice is shown as a bubble before the error bubble", () => {
    const notOk = source.indexOf("if (!response.ok) {");
    const notOkBody = source.slice(notOk, source.indexOf("\n        }\n", notOk));
    expect(notOkBody).toContain(
      'if (typeof data.crisisNotice === "string" && data.crisisNotice) {'
    );
    expect(notOkBody).toContain("crisisNoticeText = data.crisisNotice;");
    expect(occurrences("crisisNoticeText = ")).toBe(1);

    const catchAt = source.indexOf("} catch (err) {", notOk);
    const catchBody = source.slice(catchAt, source.indexOf("} finally {", catchAt));
    expect(catchBody).toContain("content: noticeText,");
    expect(catchBody).toContain(
      "setMessages((prev) => [...prev, ...noticeMessages, errorMessage]);"
    );
  });

  it("an error without a server notice falls back to the standard notice, detected locally", () => {
    // A response that is not JSON, a failed fetch, or a refusal before the
    // route parsed the body carries no crisisNotice. The server's notice wins
    // when there is one, so the two are never both shown.
    const notOk = source.indexOf("if (!response.ok) {");
    const catchAt = source.indexOf("} catch (err) {", notOk);
    const catchBody = source.slice(catchAt, source.indexOf("} finally {", catchAt));
    const flat = catchBody.replace(/\s+/g, " ");
    expect(flat).toContain(
      "const fallbackCrisis = crisisNoticeText ? null : detectCrisisSignal(userMessage.content);"
    );
    expect(flat).toContain(
      "const noticeText = crisisNoticeText ?? (fallbackCrisis ? CRISIS_NOTICES[fallbackCrisis].standard : null);"
    );
    expect(flat).toContain("const noticeMessages: ChatMessage[] = noticeText ?");
    expect(occurrences("detectCrisisSignal(userMessage.content)")).toBe(2);
  });

  it("an over-long message with a crisis signal shows the standard notice locally", () => {
    const guard = source.indexOf("if (!apiMessages) {");
    const guardBody = source.slice(guard, source.indexOf("\n      }\n", guard));
    expect(guardBody).toContain("detectCrisisSignal(userMessage.content)");
    expect(guardBody).toContain("content: CRISIS_NOTICES[localCrisis].standard,");
    expect(guardBody).toContain("setMessages((prev) => [...prev, noticeMessage]);");
    expect(guardBody.indexOf("detectCrisisSignal(")).toBeLessThan(guardBody.indexOf("return;"));
  });
});
