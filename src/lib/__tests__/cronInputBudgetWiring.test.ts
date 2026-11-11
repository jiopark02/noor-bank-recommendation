import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * How the memory crons use cronInputBudget.ts.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. The route files cannot be imported
 * without their database and network dependencies; the budget itself is
 * executed in cronInputBudget.test.ts and the old_number check in
 * factExtractionValidation.test.ts.
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
  ["summarize", SUMMARIZE, "cron_summarize"],
  ["extract-facts", EXTRACT, "cron_extract_facts"],
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

  it("extract-facts: stored facts come from the parsed answer only", () => {
    const body = functionBody(EXTRACT, "extractOneSession");
    expect(occurrences(body, "userContent")).toBe(2);
    const parseAt = body.indexOf("const parsed = parseExtractionJson(rawOutput);");
    expect(parseAt).toBeGreaterThan(-1);
    const afterParse = body.slice(parseAt);
    expect(afterParse).not.toMatch(/conversation|userContent/i);
    expect(afterParse).toContain("fact: item.fact,");
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

describe("extract-facts existing facts budget", () => {
  const body = functionBody(EXTRACT, "extractOneSession");

  it("numbers, checks and resolves old_number against the budgeted facts", () => {
    expect(body).toContain("const existing = budgetExistingFacts(factsArray);");
    expect(body).toContain("${existing.text}");
    expect(body).toContain(
      "validateExtraction(\n    parsed,\n    existing.facts.length,\n    session.id\n  );"
    );
    expect(occurrences(body, "existing.facts[item.oldNumber - 1]")).toBe(2);
    expect(body).not.toContain("factsArray.length");
    expect(body).not.toContain("factsArray[");
  });

  it("logs how many facts were left out", () => {
    expect(body).toContain(
      'logCronInputBudget("cron_extract_facts", conversation, existing.dropped);'
    );
  });
});

describe("extract-facts new facts cap", () => {
  const body = functionBody(EXTRACT, "extractOneSession");

  it("caps the validated new facts before any of them is saved", () => {
    const capAt = body.indexOf(
      "validated.newFacts = capNewFacts(validated.newFacts);"
    );
    const validateAt = body.indexOf("validateExtraction(");
    const saveLoopAt = body.indexOf("for (const item of validated.newFacts) {");
    expect(validateAt).toBeGreaterThan(-1);
    expect(capAt).toBeGreaterThan(validateAt);
    expect(saveLoopAt).toBeGreaterThan(capAt);
    expect(occurrences(body, "validated.newFacts")).toBe(3);
  });
});
