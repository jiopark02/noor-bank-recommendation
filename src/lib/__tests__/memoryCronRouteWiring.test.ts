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
    const throwAt = body.indexOf("  if (stats.failed > 0) {\n    throw new Error(");
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
