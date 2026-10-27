import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The memory crons' system prompts decide what is remembered about a user.
 * Both now follow the same rule: do not keep what the bank feed (Plaid) can
 * supply fresh, such as balances and transaction amounts, but do keep amounts
 * and schedules the user states that the bank feed cannot know.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. It pins the prompt text; whether the
 * model follows it is checked only against live output.
 */

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8"
  ).replace(/\r\n?/g, "\n");
}

/** The template literal assigned to `const <name> = \``. */
function promptConstant(source: string, name: string): string {
  const open = `const ${name} = \``;
  const start = source.indexOf(open);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("`;\n", start + open.length);
  expect(end, `${name} has no closing backtick`).toBeGreaterThan(start);
  return source.slice(start + open.length, end);
}

const SUMMARY_PROMPT = promptConstant(
  read("../../app/api/cron/summarize/route.ts"),
  "SUMMARY_SYSTEM_PROMPT"
);
const EXTRACTION_PROMPT = promptConstant(
  read("../../app/api/cron/extract-facts/route.ts"),
  "EXTRACTION_SYSTEM_PROMPT"
);

describe("summary prompt", () => {
  it("does not preserve live balances or transaction amounts", () => {
    expect(SUMMARY_PROMPT).toContain(
      "Do NOT preserve live account balances or individual transaction amounts"
    );
  });

  it("preserves what the user states that the bank feed cannot know", () => {
    expect(SUMMARY_PROMPT).toContain(
      "Preserve specifics the user states that a connected bank feed cannot know: money received from family or other people, rent or bills paid in cash, accounts or cards that are not connected, scholarship or aid amounts and dates"
    );
  });

  it("no longer asks to preserve every number", () => {
    expect(SUMMARY_PROMPT).not.toContain("Preserve specifics: numbers");
  });

  it("still forbids full sensitive identifiers", () => {
    expect(SUMMARY_PROMPT).toContain(
      "Never include full sensitive identifiers"
    );
  });

  it("leaves out emotions, crisis content and safety notices", () => {
    expect(SUMMARY_PROMPT).toContain(
      "Do NOT include the user's emotions, mental health, or any mention of self-harm, suicide, harming others, or eating problems, and do not mention safety notices Noor showed."
    );
  });
});

describe("fact-extraction prompt", () => {
  it("stores a fact only if it would change the next piece of advice", () => {
    expect(EXTRACTION_PROMPT).toContain(
      "Store a fact only if it would change the next piece of advice Noor gives."
    );
  });

  it("does not remember what Plaid can provide, but keeps what it cannot know", () => {
    expect(EXTRACTION_PROMPT).toContain("Do not remember what Plaid can provide.");
    expect(EXTRACTION_PROMPT).toContain(
      "DO extract amounts and\n  schedules the user states that the bank feed cannot know"
    );
  });

  it("keeps the seven categories", () => {
    expect(EXTRACTION_PROMPT).toContain(
      "category must be one of: financial, personal, goal, preference, visa, banking, other."
    );
  });

  it("still forbids full sensitive identifiers", () => {
    expect(EXTRACTION_PROMPT).toContain(
      "Full sensitive identifiers (complete SSN, full card numbers)."
    );
  });

  it("does not extract emotions or crisis content, even when it would change advice", () => {
    expect(EXTRACTION_PROMPT).toContain(
      "- Emotions, mood, stress, mental health, or anything about self-harm, suicide, harming\n  others, or eating problems — even if stated as a current fact. This rule applies even\n  if the fact would change advice."
    );
  });
});
