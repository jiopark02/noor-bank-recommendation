import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The chat route reads fresh bank data in one place, getPlaidChatState. That
 * read must sit inside the branch of the capability-scaffold decision, so a
 * decision that denies (every channel under AI_PLAID_STATE=off) means the
 * read never happens and nothing from it reaches the prompt. The
 * balance-keyword decision reads nothing itself: it only raises that read's
 * depth, inside the same branch. The third channel, financial analysis, is
 * evaluated and logged with no read and no branch behind it.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. The decisions themselves are
 * executed in plaidEgressPolicy.test.ts, and the depth they lead to in
 * plaidChatContext.test.ts (resolvePlaidChatDepth).
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

describe("capabilityScaffoldDecision", () => {
  it("guards the only call that reads bank data", () => {
    expect(occurrences(CHAT, "await getPlaidChatState(")).toBe(1);
    expect(allowedBranch("capabilityScaffoldDecision")).toContain(
      "await getPlaidChatState("
    );
  });
});

describe("balanceKeywordDecision", () => {
  it("reads nothing, and only sets the depth of the guarded read", () => {
    expect(occurrences(CHAT, 'channel: "balance_keyword"')).toBe(1);
    expect(occurrences(CHAT, "balanceKeywordDecision.allowed")).toBe(1);
    expect(occurrences(CHAT, "if (balanceKeywordDecision.allowed)")).toBe(0);
    expect(allowedBranch("capabilityScaffoldDecision")).toContain(
      "balanceKeywordAllowed: balanceKeywordDecision.allowed"
    );
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
  it("happen only through the guarded bank-state read", () => {
    expect(occurrences(CHAT, "plaidClient")).toBe(0);
    expect(occurrences(CHAT, "readBankData")).toBe(0);
    expect(occurrences(CHAT, "/api/plaid/")).toBe(0);
    expect(occurrences(CHAT, "fetchBalanceSummaryFromPlaidRoute")).toBe(0);
    expect(occurrences(CHAT, "buildBalanceSummary")).toBe(0);
    expect(occurrences(CHAT, "getPlaidChatState(")).toBe(1);
  });
});
