import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The chat route reads fresh bank data in two places. Each read must sit
 * inside the branch of its own egress decision, so that a decision that
 * denies (for example every channel under AI_PLAID_STATE=off) means the read
 * never happens and nothing from it reaches the prompt. The third channel,
 * financial analysis, is evaluated and logged with no read and no branch
 * behind it.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. The decisions themselves are
 * executed in plaidEgressPolicy.test.ts.
 */

const CHAT = readFileSync(
  fileURLToPath(new URL("../../app/api/chat/route.ts", import.meta.url)),
  "utf8"
).replace(/\r\n?/g, "\n");

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** From `    if (<decision>.allowed) {` to its closing brace at the same indent. */
function allowedBranch(decision: string): string {
  const open = `\n    if (${decision}.allowed) {\n`;
  const start = CHAT.indexOf(open);
  expect(start, `${decision} branch not found`).toBeGreaterThan(-1);
  const end = CHAT.indexOf("\n    }\n", start + open.length);
  expect(end, `${decision} branch has no closing brace`).toBeGreaterThan(start);
  return CHAT.slice(start, end);
}

describe.each([
  ["capabilityScaffoldDecision", "await getPlaidChatState("],
  ["balanceKeywordDecision", "await fetchBalanceSummaryFromPlaidRoute("],
])("%s", (decision, call) => {
  it("guards the only call that reads this bank data", () => {
    expect(occurrences(CHAT, call)).toBe(1);
    expect(allowedBranch(decision)).toContain(call);
  });
});

describe("financialAnalysisDecision", () => {
  it("is evaluated and logged once, with no branch and no read behind it", () => {
    expect(occurrences(CHAT, 'channel: "financial_analysis_keyword"')).toBe(1);
    expect(
      occurrences(CHAT, "logPlaidEgressDecision(financialAnalysisDecision,")
    ).toBe(1);
    expect(occurrences(CHAT, "financialAnalysisDecision.allowed")).toBe(0);
    expect(occurrences(CHAT, "fetchFinancialSnapshotFromPlaidRoutes")).toBe(0);
  });
});

describe("bank-data reads in the chat route", () => {
  it("happen only through the two guarded helpers", () => {
    expect(occurrences(CHAT, "plaidClient")).toBe(0);
    // Each helper is defined once and called once.
    expect(occurrences(CHAT, "fetchBalanceSummaryFromPlaidRoute(")).toBe(2);
    expect(occurrences(CHAT, "getPlaidChatState(")).toBe(1);
  });
});
