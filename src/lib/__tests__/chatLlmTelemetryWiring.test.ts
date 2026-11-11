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
 * response are shaped as the fixtures below: the success branch (persist,
 * SAVE_FAILED, success body), the immediate return on a 401, and the one
 * return after the loop for a request whose attempts all failed. Each fixture
 * must appear in the route exactly once. The success branch was copied from
 * the route as it was before telemetry. Two things were added to it since:
 * the timing of the save for the [chat-stages] line, which changes nothing
 * the branch returns or stores, and the id of the session the turn was stored
 * in, which the success body now reports because a save can move to another
 * session (chatRouteSave.test.ts executes it). Since the crisis notice was added, the
 * returns go through respond(), which adds a crisisNotice field only when a
 * crisis signal was detected, and the success branch stores and returns the
 * reply with the notice in front (chatRouteCrisis.test.ts executes both).
 * Since the model-failure responses became one response, the 401 return and
 * the return after the loop both send it, and no return reads the failed
 * attempt's status or error text (chatRouteModelFailure.test.ts executes
 * them).
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
 * LOOP_NO_ATTEMPT, LOOP_ALL_FAILED).
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

/**
 * The text with every line that is wholly a `//` comment removed. A line of
 * code that has `//` somewhere in it, a string included, is kept whole.
 */
function withoutCommentLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
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
          // With a crisis signal the notice leads the reply, and the reply
          // stored is the one shown.
          const notice = crisisNotice();
          const replyMessage =
            notice === null
              ? result.message
              : composeCrisisReply(notice, result.message, EMPTY_ASSISTANT_REPLY);
          const saveStartedAtMs = Date.now();
          let savedSessionId: string | null = null;
          try {
            savedSessionId = await persistTurnIfEnabled({
              activeSession,
              authUserId,
              userContent: lastUserMessageText,
              assistantContent: replyMessage ?? "",
              assistantModel: result.model,
              inputTokens: result.usage?.input_tokens,
              outputTokens: result.usage?.output_tokens,
              requestStartedAtMs,
            });
          } catch (error) {
            console.error("Failed to save messages (OpenRouter branch):", error);
            return respond(
              {
                error:
                  "Could not save your conversation. Please try sending your message again.",
                code: "SAVE_FAILED",
              },
              { status: 500 }
            );
          } finally {
            // Without a session there is no save to time.
            if (activeSession) stageMs.save = Date.now() - saveStartedAtMs;
          }

          return respond({
            success: true,
            message: replyMessage,
            model: result.model,
            // The session the turn was stored in, which is not the one the
            // request started with when that one was closed meanwhile.
            sessionId: savedSessionId ?? activeSession?.id ?? null,
            usage: result.usage,
          });
        }
`;

// (ii) A failed attempt is logged by kind and upstream status. A 401 from the
// provider then returns at once, without trying the next model; any other
// failure falls through to the end of the loop body and the next model.
const FIXTURE_II = `        logFailedModelAttempt(attemptIndex, result.status);

        // Auth errors should fail fast rather than retrying other models.
        if (result.status === 401) {
          return respond(CHAT_MODEL_FAILED_BODY, {
            status: CHAT_MODEL_FAILED_STATUS,
          });
        }
      }
`;

// (iii) The response both of those returns send.
const FIXTURE_III = `const CHAT_MODEL_FAILED_BODY = {
  error: "Chat is temporarily unavailable. Please try again.",
  code: "CHAT_MODEL_FAILED",
} as const;
const CHAT_MODEL_FAILED_STATUS = 502;
`;

// The loop head as wired: the prompt-block flags written into every chat row,
// the budget check that leaves the loop before an attempt that cannot fit, the
// counter starting at 0 and incremented once per attempt started, the call,
// and the catch for a thrown attempt, which logs the attempt with the thrown
// error's cause code and name and nothing else from it, and moves on; nothing
// else stands between the call and the success branch.
const LOOP_HEAD = `      // Which optional blocks the system prompt carries, for llm_calls only.
      const promptBlocks: ChatPromptBlocks = {
        memory: memoryBlock !== "",
        plaidScaffold: capabilityScaffoldDecision.allowed,
        balance: balanceSnapshotInjected,
        financialSnapshot: false,
      };
      let attemptIndex = 0;

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
          // callOpenRouter has already recorded the attempt. A thrown attempt
          // has no upstream status to report; its cause code and its name are
          // all that is read from the error, never its message.
          logFailedModelAttempt(
            attemptIndex,
            null,
            networkCauseCode(error),
            errorName(error)
          );
          continue;
        }

        if (result.ok) {
`;

// After the loop: no attempt fitted in the budget.
const LOOP_NO_ATTEMPT = `      if (attemptIndex === 0) {
        return respond(CHAT_TIME_BUDGET_EXHAUSTED_BODY, { status: 503 });
      }
`;

// The body of that response, which a wait cut at the pre-loop deadline also
// gets (chatRouteDeadline.test.ts executes both).
const TIME_BUDGET_BODY = `const CHAT_TIME_BUDGET_EXHAUSTED_BODY = {
  error: "Chat is taking longer than usual. Please try again.",
  code: "CHAT_TIME_BUDGET_EXHAUSTED",
} as const;
`;

// After the loop: at least one attempt started and none answered. One return,
// whichever way the attempts failed.
const LOOP_ALL_FAILED = `      // Every attempt that started has failed.
      return respond(CHAT_MODEL_FAILED_BODY, {
        status: CHAT_MODEL_FAILED_STATUS,
      });
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

describe("chat route: the branches that decide the response are as pinned", () => {
  it.each([
    ["(i) success branch", FIXTURE_I],
    ["(ii) failed-attempt log and 401 return", FIXTURE_II],
    ["(iii) model-failure response", FIXTURE_III],
    ["(iv) time-budget response", TIME_BUDGET_BODY],
  ])("%s appears exactly once, byte for byte", (_label, fixture) => {
    expect(occurrences(CHAT, norm(fixture))).toBe(1);
  });

  it("the loop head adds only the budget check, the counter, the telemetry argument and the throw catch", () => {
    expect(occurrences(CHAT, norm(LOOP_HEAD))).toBe(1);
  });

  it("the loop is left only at the budget check, and the no-attempt and all-failed responses follow it", () => {
    const post = functionBody(CHAT, "POST");
    expect(occurrences(post, "continue;")).toBe(1);
    expect(occurrences(post, "break;")).toBe(1);
    expect(occurrences(post, norm(LOOP_NO_ATTEMPT))).toBe(1);
    expect(occurrences(post, norm(LOOP_ALL_FAILED))).toBe(1);
    expect(post.indexOf(norm(LOOP_NO_ATTEMPT))).toBeLessThan(
      post.indexOf(norm(LOOP_ALL_FAILED))
    );
  });

  it("no response is built from a failed attempt's status or error text", () => {
    // The model-failure response is sent from the 401 return and from the
    // return after the loop, and from nowhere else. A failed result is read
    // for its status only, by the 401 check and the log line.
    const post = functionBody(CHAT, "POST");
    expect(occurrences(post, "respond(CHAT_MODEL_FAILED_BODY, {")).toBe(2);
    expect(post).not.toContain("result.error");
    expect(occurrences(post, "result.status")).toBe(2);
  });

  it("the thrown error of an attempt is read only by networkCauseCode and errorName", () => {
    // Inside the attempt's catch the error is passed to the two readers and
    // used nowhere else, so its message cannot reach the log or the response.
    // Lines that are wholly a comment are removed first, so prose about the
    // error does not count. Only whole lines: a `//` inside a string on a code
    // line must not hide the code after it.
    const post = functionBody(CHAT, "POST");
    const catchAt = post.indexOf("} catch (error) {\n          // callOpenRouter has already recorded");
    expect(catchAt).toBeGreaterThan(-1);
    const catchBody = withoutCommentLines(
      post.slice(catchAt, post.indexOf("continue;", catchAt))
    );
    const uses = catchBody.match(/\berror\b/g) ?? [];
    // The binding in `catch (error)` and one argument to each reader.
    expect(uses).toHaveLength(3);
    expect(occurrences(catchBody, "networkCauseCode(error)")).toBe(1);
    expect(occurrences(catchBody, "errorName(error)")).toBe(1);
  });
});

describe("chat route: callOpenRouter", () => {
  const body = functionBody(CHAT, "callOpenRouter");

  /**
   * Every catch block in callOpenRouter: its bound name and its body, from the
   * `{` after `catch (name)` to the `}` that closes it at the same indent.
   */
  function catchBlocks(): Array<{ name: string; indent: string; body: string }> {
    const blocks: Array<{ name: string; indent: string; body: string }> = [];
    const opener = /\n( *)\} catch \((\w+)\) \{\n/g;
    let match: RegExpExecArray | null;
    while ((match = opener.exec(body)) !== null) {
      const [, indent, name] = match;
      const start = match.index + match[0].length;
      const end = body.indexOf(`\n${indent}}\n`, start);
      expect(end, `catch (${name}) has no closing brace`).toBeGreaterThan(start);
      blocks.push({ name, indent, body: body.slice(start, end) });
    }
    return blocks;
  }

  it("finds every catch: one for building the request, one for the attempt", () => {
    // The probe below holds for each block it finds, so it must find them all.
    expect(catchBlocks()).toHaveLength(occurrences(body, "catch ("));
    expect(catchBlocks().length).toBeGreaterThan(0);
  });

  it("no catch swallows an error: each one ends by throwing", () => {
    for (const block of catchBlocks()) {
      expect(block.body.trimEnd(), `catch (${block.name})`).toMatch(
        /\n?\s*throw [^;]+;$/
      );
    }
  });

  it("no catch returns, so ending with a throw is the only way out of each", () => {
    // Ending with a throw is not enough on its own: a return earlier in the
    // block, under a condition, would leave by another way.
    for (const block of catchBlocks()) {
      expect(
        withoutCommentLines(block.body),
        `catch (${block.name})`
      ).not.toMatch(/\breturn\b/);
    }
  });

  it("records and then rethrows the same error when the attempt throws", () => {
    // The outer catch: the one that records the row, at the function's indent.
    const outer = catchBlocks().filter((b) => b.indent === "  ");
    expect(outer).toHaveLength(1);
    const [{ name, body: catchBody }] = outer;
    expect(catchBody).toContain("await recordLlmCall(");
    expect(catchBody.trimEnd().endsWith(`throw ${name};`)).toBe(true);
  });

  it("a request body that cannot be built is rethrown as ChatRequestBuildError, to the catch that records it", () => {
    const inner = catchBlocks().filter((b) => b.indent !== "  ");
    expect(inner).toHaveLength(1);
    const [{ name, body: catchBody }] = inner;
    // Its whole body, comments aside, is the one throw.
    expect(withoutCommentLines(catchBody).trim()).toBe(
      `throw new ChatRequestBuildError(${name});`
    );
    // Only the build is inside the inner try; fetch is not.
    const innerTry = body.indexOf("    try {\n      requestBody = JSON.stringify(");
    expect(innerTry).toBeGreaterThan(-1);
    expect(body.indexOf("fetch(OPENROUTER_URL")).toBeGreaterThan(
      body.indexOf("throw new ChatRequestBuildError(")
    );
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

  it("hands the run deadline check to the batch loop, timed from the start of the run", () => {
    // The check itself, before each session, is executed in
    // memoryCronBatch.test.ts.
    expect(occurrences(getBody, "await runMemoryCronBatch<ChatSession>({")).toBe(1);
    expect(getBody).toContain("      now: Date.now,\n");
    expect(getBody).toContain("      runStartedAtMs: startedAt.getTime(),\n");
    expect(getBody).toContain("      hasBudget: cronRunHasBudgetForAnotherCall,\n");
    expect(getBody).toContain("    deferred: 0,");
  });
});
