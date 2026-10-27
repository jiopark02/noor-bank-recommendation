import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * LLM call telemetry was wired into the chat route and both memory crons
 * without changing what any of them returns, throws, or stores. This file
 * holds the parts of that claim that live in the route files themselves.
 *
 * WHAT IS PINNED BYTE FOR BYTE
 * The chat route's attempt loop gained an attempt counter and a fourth
 * argument to callOpenRouter, so "the loop is unchanged" is not true and is not
 * what is asserted. What is asserted is that the branches deciding the user's
 * response are unchanged: the success branch (persist, SAVE_FAILED, success
 * body), the immediate 401 return, the lastFailure assignment, the 429 return
 * after the loop, and the final return that sends the last failure's error
 * text to the client. Each fixture below was copied from the route as it was
 * before telemetry, and must appear in the route exactly once.
 *
 * The telemetry inputs are pinned too, because a wrong value there passes
 * every CHECK and lands as quietly wrong data: the prompt-block flags, the
 * attempt counter and the usage tally the attempt appends to (LOOP_HEAD), the
 * arguments of the row written once a
 * response arrives (SUCCESS_ROW), and, in both crons, where the observed status
 * and the parsed flag are assigned (STATUS_AFTER_FETCH,
 * JSON_PARSED_AFTER_PARSE).
 *
 * Two behaviors are guarded here: a fetch that throws is recorded and rethrown
 * by callOpenRouter, and the loop starts every attempt, the first included,
 * only when the request budget still has room for a full one (LOOP_HEAD,
 * LOOP_NO_ATTEMPT, LOOP_AFTER_THROW); and the last failed model's error text
 * still reaches the client (fixture v).
 *
 * LINE ENDINGS
 * Both the route source and each fixture are normalized to \n before
 * comparing. The repository stores these files with LF, but a Windows checkout
 * with core.autocrlf=true has CRLF in the working tree while CI on Linux has
 * LF. Normalizing both sides makes the result the same in both places; every
 * other byte, including indentation, is still compared.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. Nothing here runs the routes. It
 * proves the code is shaped as described, not that it behaves so at runtime.
 * What executes is openRouterChatResult.test.ts (the response handling moved
 * out of the route), llmCallLog.test.ts (the write never rejects or hangs) and
 * llmCallTelemetry.test.ts (the row).
 */

function read(relativePath: string): string {
  return norm(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
  );
}

function norm(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** From `async function <name>(` to the first column-0 closing brace. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}\n", start);
  expect(end, `${name} has no closing brace`).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

const CHAT = read("../../app/api/chat/route.ts");
const SUMMARIZE = read("../../app/api/cron/summarize/route.ts");
const EXTRACT = read("../../app/api/cron/extract-facts/route.ts");

// (i) The success branch: persist the turn, SAVE_FAILED on a failed save, and
// the success body the client receives.
const FIXTURE_I = `        if (result.ok) {
          try {
            await persistTurnIfEnabled({
              activeSession,
              authUserId,
              userContent: lastUserMessageText,
              assistantContent: result.message ?? "",
              assistantModel: result.model,
              inputTokens: result.usage?.input_tokens,
              outputTokens: result.usage?.output_tokens,
            });
          } catch (error) {
            console.error("Failed to save messages (OpenRouter branch):", error);
            return NextResponse.json(
              {
                error:
                  "Could not save your conversation. Please try sending your message again.",
                code: "SAVE_FAILED",
              },
              { status: 500 }
            );
          }

          return NextResponse.json({
            success: true,
            message: result.message,
            model: result.model,
            sessionId: activeSession?.id ?? null,
            usage: result.usage,
          });
        }
`;

// (ii) A 401 from the provider returns at once, without trying the next model.
const FIXTURE_II = `        if (result.status === 401) {
          return NextResponse.json(
            { error: "Invalid OpenRouter API key" },
            { status: 401 }
          );
        }
`;

// (iii) Any other failure is remembered and the loop moves on.
const FIXTURE_III = `        lastFailure = result;
      }
`;

// (iv) After the loop, a final 429 is reported as a rate limit.
const FIXTURE_IV = `      if (lastFailure?.status === 429) {
        return NextResponse.json(
          { error: "Rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }
`;

// (v) Otherwise the last failed model's error text is returned to the client.
const FIXTURE_V = `      return NextResponse.json(
        { error: lastFailure?.error || "OpenRouter request failed" },
        { status: lastFailure?.status || 500 }
      );
`;

// The loop head as wired: the prompt-block flags written into every chat row,
// the budget check that leaves the loop before an attempt that cannot fit, the
// counter starting at 0 and incremented once per attempt started, the call,
// and the catch for a thrown attempt, which marks the throw and moves on;
// nothing else stands between the call and the success branch.
const LOOP_HEAD = `      // Which optional blocks the system prompt carries, for llm_calls only.
      const promptBlocks: ChatPromptBlocks = {
        memory: memoryBlock !== "",
        plaidScaffold: capabilityScaffoldDecision.allowed,
        balance: balanceSnapshotInjected,
        financialSnapshot: false,
      };
      let attemptIndex = 0;
      let lastThrew = false;

      for (const model of modelsToTry) {
        // Every attempt, the first included, starts only if it could run to
        // its full timeout inside the request budget.
        const elapsedMs = Date.now() - requestStartedAtMs;
        if (!chatHasBudgetForAnotherAttempt(elapsedMs)) {
          console.warn(
            "[chat-deadline] attempt skipped attempt=%d elapsed_ms=%d",
            attemptIndex + 1,
            elapsedMs
          );
          break;
        }
        attemptIndex++;
        let result: OpenRouterResult;
        try {
          result = await callOpenRouter(
            openRouterApiKey,
            model,
            openRouterMessages,
            {
              attemptIndex,
              userId: authUserId,
              sessionId: activeSession?.id ?? null,
              blocks: promptBlocks,
              tally: usageTally,
            }
          );
        } catch (error) {
          // callOpenRouter has already recorded the attempt.
          lastThrew = true;
          console.error("Chat API error:", error);
          continue;
        }
        lastThrew = false;

        if (result.ok) {
`;

// After the loop: no attempt fitted in the budget.
const LOOP_NO_ATTEMPT = `      if (attemptIndex === 0) {
        return NextResponse.json(
          {
            error: "Chat is taking longer than usual. Please try again.",
            code: "CHAT_TIME_BUDGET_EXHAUSTED",
          },
          { status: 503 }
        );
      }
`;

// After the loop: when the last attempt threw, the response is the 500 a
// throw reaching the outer catch gets.
const LOOP_AFTER_THROW = `      if (lastThrew) {
        return NextResponse.json(
          { error: "Failed to get response from AI" },
          { status: 500 }
        );
      }
`;

// The row callOpenRouter writes once a response arrives: the real HTTP status,
// and response metadata only when the body parsed as JSON.
const SUCCESS_ROW = `  await recordLlmCall(
    buildLlmCallRow({
      route: "chat",
      attemptIndex: telemetry.attemptIndex,
      requestModel: model,
      startedAtMs,
      latencyMs: Date.now() - startedAtMs,
      userId: telemetry.userId,
      sessionId: telemetry.sessionId,
      httpStatus: res.status,
      outcome: classifyLlmOutcome({
        route: "chat",
        httpStatus: res.status,
        threw: false,
        jsonParsed,
        contentPresent: hasNonEmptyContent(data),
      }),
      meta: jsonParsed ? parseOpenRouterResponseMeta(data) : null,
      blocks: telemetry.blocks,
    })
  );

  return result;
`;

// In both crons' request functions: the status is observed as soon as fetch
// returns, before the ok check can throw. The fetch call ends with the shared
// request builder (openRouterRequest.ts) as its body...
const STATUS_AFTER_FETCH = `      })
    ),
  });
  observed.httpStatus = response.status;

  if (!response.ok) {
`;

// ...and jsonParsed is set only after the body has parsed, so a parse failure
// is classified invalid_json rather than empty_content.
const JSON_PARSED_AFTER_PARSE = `  try {
    data = await response.json();
  } catch {
    throw new Error("OpenRouter response was not valid JSON");
  }
  observed.jsonParsed = true;
`;

describe("chat route: the branches that decide the response are unchanged", () => {
  it.each([
    ["(i) success branch", FIXTURE_I],
    ["(ii) 401 return", FIXTURE_II],
    ["(iii) lastFailure assignment", FIXTURE_III],
    ["(iv) 429 return", FIXTURE_IV],
    ["(v) final error return", FIXTURE_V],
  ])("%s appears exactly once, byte for byte", (_label, fixture) => {
    expect(occurrences(CHAT, norm(fixture))).toBe(1);
  });

  it("the loop head adds only the budget check, the counter, the telemetry argument and the throw catch", () => {
    expect(occurrences(CHAT, norm(LOOP_HEAD))).toBe(1);
  });

  it("the loop is left only at the budget check, and the no-attempt and last-throw responses follow it", () => {
    const post = functionBody(CHAT, "POST");
    expect(occurrences(post, "continue;")).toBe(1);
    expect(occurrences(post, "break;")).toBe(1);
    expect(occurrences(post, "lastThrew = true;")).toBe(1);
    expect(occurrences(post, norm(LOOP_NO_ATTEMPT))).toBe(1);
    expect(occurrences(post, norm(LOOP_AFTER_THROW))).toBe(1);
    expect(post.indexOf(norm(LOOP_NO_ATTEMPT))).toBeLessThan(
      post.indexOf(norm(LOOP_AFTER_THROW))
    );
  });
});

describe("chat route: callOpenRouter", () => {
  const body = functionBody(CHAT, "callOpenRouter");

  it("records and then rethrows the same error when fetch throws", () => {
    const match = /\} catch \((\w+)\) \{\n([\s\S]*?)\n {2}\}\n/.exec(body);
    expect(match, "fetch catch block not found").not.toBeNull();
    const [, name, catchBody] = match as RegExpExecArray;
    expect(catchBody).toContain("await recordLlmCall(");
    expect(catchBody.trimEnd().endsWith(`throw ${name};`)).toBe(true);
  });

  it("has exactly one catch, so nothing else swallows an error", () => {
    expect(occurrences(body, "catch (")).toBe(1);
  });

  it("reads the body and builds the result through the moved helpers", () => {
    expect(body).toContain("await readJsonBodyLeniently(res)");
    expect(body).toContain("toOpenRouterResult({");
    expect(body).not.toContain("res.json(");
    expect(CHAT).toContain('from "@/lib/openRouterChatResult"');
  });

  it("records the row before returning the result", () => {
    const recordAt = body.lastIndexOf("await recordLlmCall(");
    const returnAt = body.lastIndexOf("return result;");
    expect(recordAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(recordAt);
  });

  it("writes the response row with the real status and parsed-only metadata", () => {
    expect(occurrences(body, norm(SUCCESS_ROW))).toBe(1);
  });
});

describe.each([
  ["summarize", SUMMARIZE, "callOpenRouterForSummary", "requestSummary", "cron_summarize"],
  ["extract-facts", EXTRACT, "callOpenRouterForExtraction", "requestExtraction", "cron_extract_facts"],
])("%s cron", (_label, source, fn, requestFn, route) => {
  const body = functionBody(source, fn);
  const requestBody = functionBody(source, requestFn);

  it("observes the status right after fetch, before the ok check", () => {
    expect(occurrences(requestBody, norm(STATUS_AFTER_FETCH))).toBe(1);
    expect(occurrences(requestBody, "observed.httpStatus =")).toBe(1);
  });

  it("marks the body parsed only after JSON parsing succeeds", () => {
    expect(occurrences(requestBody, norm(JSON_PARSED_AFTER_PARSE))).toBe(1);
    expect(occurrences(requestBody, "observed.jsonParsed =")).toBe(1);
  });

  it("records in a finally, so every exit writes a row", () => {
    const finallyAt = body.indexOf("} finally {");
    expect(finallyAt).toBeGreaterThan(-1);
    expect(body.slice(finallyAt)).toContain("await recordLlmCall(");
    expect(body).toContain(`route: "${route}"`);
    expect(body).not.toContain("catch (");
  });

  it("passes the session's own user and session ids", () => {
    expect(source).toContain(
      "{ userId: session.user_id, sessionId: session.id }"
    );
  });

  it("keeps the errors it throws", () => {
    expect(source).toContain("`OpenRouter request failed: ${response.status} ${response.statusText}`");
    expect(occurrences(source, '"OpenRouter response was not valid JSON"')).toBe(1);
    expect(occurrences(source, '"OpenRouter response missing message content"')).toBe(1);
  });
});

/** The text between `fetch(OPENROUTER_URL, {` and the `body:` that follows. */
function fetchOptionsBeforeBody(body: string): string {
  const start = body.indexOf("fetch(OPENROUTER_URL, {");
  expect(start, "fetch(OPENROUTER_URL not found").toBeGreaterThan(-1);
  const bodyAt = body.indexOf("body:", start);
  expect(bodyAt, "body: not found after fetch").toBeGreaterThan(start);
  return body.slice(start, bodyAt);
}

describe("chat route: callOpenRouter timeout", () => {
  const body = functionBody(CHAT, "callOpenRouter");

  it("creates its timeout signal from the chat timeout", () => {
    expect(body).toContain(
      "const signal = AbortSignal.timeout(CHAT_LLM_TIMEOUT_MS);"
    );
  });

  it("passes the signal to fetch, before the body", () => {
    expect(fetchOptionsBeforeBody(body)).toContain("signal,");
  });

  it("turns a timeout during the body read into a recorded, thrown failure before any result is built", () => {
    const guardAt = body.indexOf("if (!jsonParsed && signal.aborted) {");
    const resultAt = body.indexOf("toOpenRouterResult({");
    expect(guardAt).toBeGreaterThan(-1);
    expect(resultAt).toBeGreaterThan(guardAt);

    const guard = body.slice(guardAt, resultAt);
    expect(guard).toContain("await recordLlmCall(");
    expect(guard).toContain("threw: true,");
    expect(guard).toMatch(/throw new Error\([^)]*\);\n {2}\}\n/);
  });
});

describe.each([
  ["summarize", SUMMARIZE, "callOpenRouterForSummary", "requestSummary"],
  ["extract-facts", EXTRACT, "callOpenRouterForExtraction", "requestExtraction"],
])("%s cron timeout and run deadline", (_label, source, fn, requestFn) => {
  const body = functionBody(source, fn);
  const requestBody = functionBody(source, requestFn);
  const getBody = functionBody(source, "GET");

  it("creates its timeout signal from the cron timeout and hands it to the request", () => {
    expect(body).toContain(
      "const signal = AbortSignal.timeout(CRON_LLM_TIMEOUT_MS);"
    );
    expect(fetchOptionsBeforeBody(requestBody)).toContain("signal,");
  });

  it("marks a timeout before the row is built, only when the body never parsed", () => {
    const finallyAt = body.indexOf("} finally {");
    const markAt = body.indexOf(
      "observed.timedOut = signal.aborted && !observed.jsonParsed;"
    );
    const recordAt = body.indexOf("await recordLlmCall(", finallyAt);
    expect(markAt).toBeGreaterThan(finallyAt);
    expect(recordAt).toBeGreaterThan(markAt);
  });

  it("checks the run deadline before starting each session", () => {
    expect(
      occurrences(
        getBody,
        "if (!cronRunHasBudgetForAnotherCall(Date.now() - startedAt.getTime())) {"
      )
    ).toBe(1);
    expect(getBody).toContain("deferred: 0,");
  });
});
