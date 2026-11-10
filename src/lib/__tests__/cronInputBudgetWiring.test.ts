import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * How the memory crons use cronInputBudget.ts.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. The route files cannot be imported
 * without their database and network dependencies; the budget itself is
 * executed in cronInputBudget.test.ts.
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

describe.each([
  ["summarize", SUMMARIZE, "cron_summarize"],
])("%s cron conversation budget", (_label, source, route) => {
  it("serializes the conversation through the budget, not on its own", () => {
    expect(source).toContain('from "@/lib/cronInputBudget";');
    expect(source).toContain("return buildCronConversationText(trimmed);");
    expect(source).not.toContain("${m.content}");
  });

  it("logs the counts for its own route", () => {
    expect(source).toContain(`logCronInputBudget("${route}", conversation`);
  });
});

describe("the crisis check and the output filter read the model's answer", () => {
  it("summarize: the conversation goes only to the model call", () => {
    const body = functionBody(SUMMARIZE, "summarizeOneSession");
    expect(occurrences(body, "conversationText")).toBe(2);
    expect(body).toContain(
      "callOpenRouterForSummary(\n    apiKey,\n    SUMMARY_SYSTEM_PROMPT,\n    conversationText,"
    );
    const parseAt = body.indexOf(
      "const { summary, topics } = parseSummaryOutput(rawOutput);"
    );
    expect(parseAt).toBeGreaterThan(-1);
    const afterParse = body.slice(parseAt);
    expect(afterParse).toContain("await storeSummaryUnlessCrisis(");
    expect(afterParse).toContain("    summary,\n    topics,\n");
    expect(afterParse).not.toMatch(/conversation/i);
  });

  it.each([
    "../summaryCrisisGate.ts",
    "../memoryOutputFilter.ts",
    "../aiMemory.ts",
    "../crisisSignals.ts",
  ])("%s does not depend on the input budget", (path) => {
    expect(read(path)).not.toContain("cronInputBudget");
  });
});
