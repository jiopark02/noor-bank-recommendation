import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * How the two memory cron routes wire into memoryCronBatch.ts.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. The route files cannot be imported
 * without their database and network dependencies. The loop, the failure
 * rules and the state writes are executed in memoryCronBatch.test.ts and
 * aiMemoryCronState.test.ts; this file holds only that each route records its
 * stages in the right places and hands the loop its own columns.
 */

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8"
  ).replace(/\r\n?/g, "\n");
}

/** The body of `async function <name>(`, up to its closing brace. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n}\n", start);
  expect(end, `${name} has no end`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const SUMMARIZE = read("../../app/api/cron/summarize/route.ts");
const EXTRACT = read("../../app/api/cron/extract-facts/route.ts");

describe.each([
  [
    "summarize",
    SUMMARIZE,
    "cron_summarize",
    "summary",
    "facts",
    "SUMMARIZE_BATCH_LIMIT",
    "getSessionsNeedingSummary(limit, nowIso)",
    "callOpenRouterForSummary",
  ],
  [
    "extract-facts",
    EXTRACT,
    "cron_extract_facts",
    "facts",
    "summary",
    "EXTRACT_BATCH_LIMIT",
    "getSessionsNeedingFactsExtraction(limit, nowIso)",
    "callOpenRouterForExtraction",
  ],
])(
  "%s route",
  (_label, source, route, prefix, otherPrefix, batchLimit, fetch, callFn) => {
    const getBody = functionBody(source, "GET");
    const callBody = functionBody(source, callFn);

    it("runs the batch once, for its own route, limits and candidate query", () => {
      expect(occurrences(getBody, "await runMemoryCronBatch<ChatSession>({")).toBe(1);
      expect(getBody).toContain(`      route: "${route}",\n`);
      expect(getBody).toContain("      candidateLimit: SESSION_CANDIDATE_LIMIT,\n");
      expect(getBody).toContain(`      batchLimit: ${batchLimit},\n`);
      expect(getBody).toContain(fetch);
    });

    it("reads and writes only its own state columns, with the session's own user id", () => {
      expect(getBody).toContain(`      failuresOf: (s) => s.${prefix}_failures,\n`);
      expect(getBody).toContain(
        `writeCronBackoff("${prefix}", s.id, s.user_id, next)`
      );
      expect(getBody).toContain(
        `writeCronCountedFailure("${prefix}", s.id, s.user_id, before, next)`
      );
      expect(getBody).toContain(
        `writeCronGiveUp("${prefix}", s.id, s.user_id, before, reason, at)`
      );
      expect(getBody).not.toContain(`("${otherPrefix}"`);
      expect(getBody).not.toContain(`s.${otherPrefix}_failures`);
    });

    it("records cron_runs items from the batch", () => {
      expect(getBody).toContain("const items = cronRunItems(batch);");
    });

    it("copies what the model call observed to the tracker in its finally", () => {
      const finallyAt = callBody.indexOf("} finally {");
      const copyAt = callBody.indexOf(
        "    tracker.call = {\n      httpStatus: observed.httpStatus,\n      timedOut: observed.timedOut,\n    };"
      );
      const timedOutAt = callBody.indexOf(
        "observed.timedOut = signal.aborted && !observed.jsonParsed;"
      );
      expect(finallyAt).toBeGreaterThan(-1);
      expect(copyAt).toBeGreaterThan(timedOutAt);
      expect(timedOutAt).toBeGreaterThan(finallyAt);
    });

    it("no longer counts attempts from llm_calls", () => {
      expect(source).not.toContain("getRespondedAttemptCounts");
      expect(source).not.toContain("partitionByAttemptBound");
      expect(source).not.toContain("applyGiveUps");
    });
  }
);

/**
 * Where another household member's shared bank data entered a session, only
 * what was said before that moment may reach the model. Each route reads the
 * moment first and hands it to the message read as its upper bound. The
 * order matters: when sharing ends, the rows marking the moment are deleted
 * together with the messages they mark, so reading the messages first could
 * be followed by finding no moment.
 */
describe.each([
  [
    "summarize",
    functionBody(SUMMARIZE, "summarizeOneSession"),
    "MAX_MESSAGES_PER_SUMMARY",
    "markSessionSummarized",
    "summarized",
  ],
  [
    "extract-facts",
    functionBody(EXTRACT, "extractOneSession"),
    "MAX_MESSAGES_PER_EXTRACTION",
    "markFactsExtracted",
    "extracted",
  ],
])("%s route: messages from before shared bank data entered", (_label, body, limit, mark, word) => {
  const SHARED_READ =
    "const sharedFrom = await getEarliestSharedSourceTime(session.id, session.user_id);";
  const MESSAGE_READ = `const recent = await getSessionMessages(session.id, session.user_id, {\n    limit: ${limit},\n    order: "desc",\n    before: sharedFrom ?? undefined,\n  });\n  const messages = recent.reverse();`;

  it("reads the moment once, with the session's own user id, before the messages and before the model call", () => {
    expect(occurrences(body, "getEarliestSharedSourceTime(")).toBe(1);
    expect(occurrences(body, "await getSessionMessages(")).toBe(1);
    const sharedAt = body.indexOf(SHARED_READ);
    const messagesAt = body.indexOf(MESSAGE_READ);
    const callAt = body.indexOf('tracker.stage = "call";');
    expect(sharedAt).toBeGreaterThan(-1);
    expect(messagesAt).toBeGreaterThan(sharedAt);
    expect(callAt).toBeGreaterThan(messagesAt);
  });

  it("hands the moment to the message read unchanged, as its upper bound", () => {
    expect(body).toContain(MESSAGE_READ);
    expect(occurrences(body, "sharedFrom")).toBe(3);
    expect(body).not.toMatch(/new Date\(\s*sharedFrom/);
  });

  it("builds the model's input from those messages only", () => {
    expect(occurrences(body, "buildConversationText(messages)")).toBe(1);
    expect(occurrences(body, "buildConversationText(")).toBe(1);
    expect(body).not.toContain("buildConversationText(recent");
  });

  it("ends a session with nothing from before the moment without calling the model", () => {
    const emptyAt = body.indexOf("if (messages.length === 0) {\n    if (sharedFrom !== null) {");
    const markAt = body.indexOf(
      `    await ${mark}(session.id, session.user_id);\n    return;\n  }`,
      emptyAt
    );
    const callAt = body.indexOf('tracker.stage = "call";');
    expect(emptyAt).toBeGreaterThan(body.indexOf(MESSAGE_READ));
    expect(markAt).toBeGreaterThan(emptyAt);
    expect(callAt).toBeGreaterThan(markAt);
    expect(body).toContain(
      `has no message from before \` +\n          "shared bank data entered it — marking ${word}."`
    );
  });
});

describe("summarizeOneSession stages", () => {
  const body = functionBody(SUMMARIZE, "summarizeOneSession");

  it("marks a session whose summary is already stored done, before reading messages", () => {
    const checkAt = body.indexOf(
      "const stored = await getSummaryBySessionId(session.id, session.user_id);"
    );
    const markAt = body.indexOf(
      "if (stored) {\n    await markSessionSummarized(session.id, session.user_id);\n    return;\n  }"
    );
    const messagesAt = body.indexOf("await getSessionMessages(");
    expect(checkAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(checkAt);
    expect(messagesAt).toBeGreaterThan(markAt);
  });

  it("enters call right before the model call, interpret right after, store right before storing", () => {
    expect(body).toContain(
      '  tracker.stage = "call";\n  const rawOutput = await callOpenRouterForSummary(\n'
    );
    expect(body).toContain("    tracker\n  );\n\n  tracker.stage = \"interpret\";\n");
    expect(body).toContain(
      '  tracker.stage = "store";\n  await storeSummaryUnlessCrisis('
    );
    for (const stage of ["call", "interpret", "store"]) {
      expect(occurrences(body, `tracker.stage = "${stage}";`)).toBe(1);
    }
  });
});

/**
 * The summarize route also summarizes the part of a session from the moment
 * shared bank data entered it, apart from the summary above: its own
 * function, its own prompt, its own batch and state columns, and only while
 * the switch is on. The extract-facts route has no such part: it still reads
 * only what was said before that moment.
 */
describe("summarize route: the summary of a session's shared-data part", () => {
  const body = functionBody(SUMMARIZE, "summarizeSharedSpan");
  const batchBody = functionBody(SUMMARIZE, "runSharedSummaryBatch");
  const getBody = functionBody(SUMMARIZE, "GET");
  const ordinaryBody = functionBody(SUMMARIZE, "summarizeOneSession");

  const SPAN_READ = "const span = await getSessionSharedSpan(session.id, session.user_id);";
  const MESSAGE_READ =
    "const recentShared = await getSessionMessages(session.id, session.user_id, {\n    limit: MAX_MESSAGES_PER_SUMMARY,\n    order: \"desc\",\n    from: span.from,\n  });\n  const sharedMessages = recentShared.reverse();";

  it("reads the marks once, before the messages and before the model call, and hands their start to the message read unchanged, as its lower bound", () => {
    expect(occurrences(body, "getSessionSharedSpan(")).toBe(1);
    expect(occurrences(body, "await getSessionMessages(")).toBe(1);
    const spanAt = body.indexOf(SPAN_READ);
    const messagesAt = body.indexOf(MESSAGE_READ);
    const callAt = body.indexOf('tracker.stage = "call";');
    expect(spanAt).toBeGreaterThan(-1);
    expect(messagesAt).toBeGreaterThan(spanAt);
    expect(callAt).toBeGreaterThan(messagesAt);
    expect(body).not.toContain("before:");
    expect(body).not.toMatch(/new Date\(\s*span/);
    expect(body).not.toContain("getEarliestSharedSourceTime(");
  });

  it("builds the model's input from those messages only, with its own prompt", () => {
    expect(occurrences(body, "buildConversationText(sharedMessages)")).toBe(1);
    expect(occurrences(body, "buildConversationText(")).toBe(1);
    expect(body).toContain(
      "callOpenRouterForSummary(\n    apiKey,\n    SHARED_SUMMARY_SYSTEM_PROMPT,\n    conversationText,"
    );
    expect(occurrences(body, "conversationText")).toBe(2);
    expect(ordinaryBody).not.toContain("SHARED_SUMMARY_SYSTEM_PROMPT");
    expect(SUMMARIZE).toContain(
      "const SHARED_SUMMARY_SYSTEM_PROMPT = `${SUMMARY_SYSTEM_PROMPT}\\n\\n${SHARED_SUMMARY_PARAGRAPH}`;"
    );
  });

  it("marks done without the model a session already holding the summary, with no mark, or with no message in that part", () => {
    const storedAt = body.indexOf(
      "if (await hasSharedSummary(session.id, session.user_id)) {\n    await markSharedSummaryDone(session.id, session.user_id);\n    return;\n  }"
    );
    const noMarkAt = body.indexOf("if (span === null) {");
    const emptyAt = body.indexOf("if (sharedMessages.length === 0) {");
    const callAt = body.indexOf('tracker.stage = "call";');
    expect(storedAt).toBeGreaterThan(-1);
    expect(body.indexOf(SPAN_READ)).toBeGreaterThan(storedAt);
    expect(noMarkAt).toBeGreaterThan(storedAt);
    expect(emptyAt).toBeGreaterThan(noMarkAt);
    expect(callAt).toBeGreaterThan(emptyAt);
  });

  it("enters each stage once, and stores through the crisis gate with its own store and completion mark", () => {
    for (const stage of ["call", "interpret", "store"]) {
      expect(occurrences(body, `tracker.stage = "${stage}";`)).toBe(1);
    }
    expect(body).toContain('  tracker.stage = "store";\n  await storeSummaryUnlessCrisis(');
    expect(occurrences(body, "await saveSharedSummary(")).toBe(1);
    expect(body.indexOf("await saveSharedSummary(")).toBeGreaterThan(
      body.indexOf("await storeSummaryUnlessCrisis(")
    );
    expect(body).toContain("markSessionSummarized: markSharedSummaryDone,");
    expect(body).toContain("messageCount: sharedMessages.length,");
    // It never writes chat_summaries or the ordinary completion flag.
    expect(body).not.toContain("createSummary,");
    expect(body).not.toContain("await createSummary(");
    expect(body).not.toContain("markSessionSummarized(");
  });

  it("runs its own batch with its own candidates and state columns, on the run's clock", () => {
    expect(occurrences(batchBody, "runMemoryCronBatch<ChatSession>({")).toBe(1);
    expect(batchBody).toContain("getSessionsNeedingSharedSummary(limit, nowIso)");
    expect(batchBody).toContain("    failuresOf: (s) => s.shared_summary_failures,\n");
    expect(batchBody).toContain('writeCronBackoff("shared_summary", s.id, s.user_id, next)');
    expect(batchBody).toContain(
      'writeCronCountedFailure("shared_summary", s.id, s.user_id, before, next)'
    );
    expect(batchBody).toContain(
      'writeCronGiveUp("shared_summary", s.id, s.user_id, before, reason, at)'
    );
    expect(batchBody).toContain("    runStartedAtMs,\n");
    expect(batchBody).toContain("    hasBudget: cronRunHasBudgetForAnotherCall,\n");
    expect(batchBody).not.toContain('("summary"');
    expect(batchBody).not.toContain('("facts"');
    expect(batchBody).not.toContain("s.summary_failures");
  });

  it("runs that batch only while the switch is on, after the ordinary batch", () => {
    expect(occurrences(getBody, "isSharedSummaryEnabled()")).toBe(1);
    expect(occurrences(getBody, "runSharedSummaryBatch(")).toBe(1);
    const switchAt = getBody.indexOf("const sharedStats = isSharedSummaryEnabled()");
    const guardAt = getBody.indexOf("if (sharedStats !== null && !stats.stopped) {");
    const batchAt = getBody.indexOf("await runSharedSummaryBatch(");
    const ordinaryAt = getBody.indexOf("await runMemoryCronBatch<ChatSession>({");
    expect(switchAt).toBeGreaterThan(ordinaryAt);
    expect(guardAt).toBeGreaterThan(switchAt);
    expect(batchAt).toBeGreaterThan(guardAt);
    expect(getBody).not.toContain('("shared_summary"');
  });

  it("extract-facts has no such part: no lower bound, none of these names", () => {
    expect(EXTRACT).not.toContain("from:");
    expect(EXTRACT).not.toMatch(/shared_summar|SharedSummar|getSessionSharedSpan|SharedSpan/);
  });
});

describe("extractOneSession stages and completion", () => {
  const body = functionBody(EXTRACT, "extractOneSession");

  it("enters call right before the model call and interpret right after", () => {
    expect(body).toContain(
      '  tracker.stage = "call";\n  const rawOutput = await callOpenRouterForExtraction(\n'
    );
    expect(body).toContain("    tracker\n  );\n  tracker.stage = \"interpret\";\n");
  });

  it("enters store after the answer is capped and before any fact is written", () => {
    const capAt = body.indexOf("validated.newFacts = capNewFacts(validated.newFacts);");
    const storeAt = body.indexOf('tracker.stage = "store";');
    const firstWriteAt = body.indexOf("for (const item of validated.supersede) {");
    expect(capAt).toBeGreaterThan(-1);
    expect(storeAt).toBeGreaterThan(capAt);
    expect(firstWriteAt).toBeGreaterThan(storeAt);
  });

  it("throws instead of marking done when any fact write failed", () => {
    const throwAt = body.indexOf("  if (stats.failed > 0) {\n    throw Object.assign(");
    const markAt = body.lastIndexOf(
      "  await markFactsExtracted(session.id, session.user_id);"
    );
    expect(throwAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(throwAt);
    expect(body.slice(markAt)).not.toContain("stats.failed");
  });

  it("absorbs a duplicate on both the new-fact save and the supersede recovery save", () => {
    expect(occurrences(body, "isUniqueViolation(")).toBe(2);
    const recoveryAt = body.indexOf("} catch (recoveryError) {");
    const absorbAt = body.indexOf("if (isUniqueViolation(recoveryError)) {");
    const failedAt = body.indexOf("stats.failed++;", recoveryAt);
    expect(recoveryAt).toBeGreaterThan(-1);
    expect(absorbAt).toBeGreaterThan(recoveryAt);
    expect(failedAt).toBeGreaterThan(absorbAt);
  });
});
