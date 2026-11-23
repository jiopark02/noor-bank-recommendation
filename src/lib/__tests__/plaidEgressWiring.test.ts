import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The chat route reads the user's own fresh bank data in one place,
 * getPlaidChatState. That read must sit inside the branch of the
 * capability-scaffold decision, so a decision that denies (every channel
 * under AI_PLAID_STATE=off) means the read never happens and nothing from it
 * reaches the prompt. The balance-keyword decision reads nothing itself: it
 * only raises that read's depth, inside the same branch. The financial
 * analysis channel is evaluated and logged with no read and no branch behind
 * it. The banks another household member shares are read in one place too,
 * readSharedForChat, inside the same branch and only when the
 * household-shared decision allows.
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

describe("householdSharedDecision", () => {
  it("guards the only read of another member's shared banks, inside the capability-scaffold branch", () => {
    expect(occurrences(CHAT, 'channel: "household_shared"')).toBe(1);
    expect(occurrences(CHAT, "readSharedForChat(")).toBe(1);
    const branch = allowedBranch("capabilityScaffoldDecision");
    expect(branch).toContain("readSharedForChat(");
    expect(branch).toContain(
      "householdSharedDecision.allowed && sharedListForRead !== null\n          ? beforeLoop(\"shared_state\""
    );
    expect(branch).toContain("householdSharedAllowed: householdSharedDecision.allowed");
  });

  it("puts the shared block and the one-line notice in the prompt only inside that branch", () => {
    const branch = allowedBranch("capabilityScaffoldDecision");
    expect(occurrences(CHAT, "systemPrompt += sharedBlock;")).toBe(1);
    expect(occurrences(CHAT, "systemPrompt += SHARED_NOT_IN_TURN_BLOCK;")).toBe(1);
    expect(branch).toContain("systemPrompt += sharedBlock;");
    expect(branch).toContain("systemPrompt += SHARED_NOT_IN_TURN_BLOCK;");
  });

  it("the list of what is shared is read only while the switch is on and the mode is not off", () => {
    expect(occurrences(CHAT, "listSharedForChat(")).toBe(1);
    expect(CHAT).toContain(
      "const sharedStateEnabled = resolveSharedStateEnabled() && plaidStateEnabled;"
    );
    const guard = CHAT.indexOf(
      '\n    if (sharedStateEnabled) {\n      try {\n        sharedList = await beforeLoop("shared_list", () => listSharedForChat(authUserId));'
    );
    expect(guard).toBeGreaterThan(-1);
    expect(CHAT.indexOf("listSharedForChat(")).toBeGreaterThan(guard);
    expect(CHAT.indexOf("listSharedForChat(")).toBeLessThan(
      CHAT.indexOf("const hasSharedConnections")
    );
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
