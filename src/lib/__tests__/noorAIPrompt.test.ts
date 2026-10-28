import { describe, expect, it } from "vitest";
import {
  buildStaticSystemPrompt,
  generateSystemPrompt,
  type UserContext,
} from "../noorAIPrompt";

const OLD_OFF_LINE =
  "You have access to the user's profile and financial data, but ONLY bring it up when their question directly relates to it.";

describe("generateSystemPrompt — guideline 2", () => {
  it("under off, tells the model it has no bank data", () => {
    const prompt = generateSystemPrompt({}, { plaidStateEnabled: false });
    expect(prompt).toContain(
      "You have access to the user's profile, but not to their bank data — no balances, accounts, or transactions are available to you."
    );
    expect(prompt).toContain(
      "if asked about balances or transactions, say you cannot see them right now."
    );
    expect(prompt).not.toContain(OLD_OFF_LINE);
    expect(prompt).not.toContain("profile and financial data");
  });

  it("with no options behaves as off", () => {
    const prompt = generateSystemPrompt({});
    expect(prompt).toContain("but not to their bank data");
  });

  it("when Plaid state is enabled, points at the per-turn block, unchanged", () => {
    const prompt = generateSystemPrompt({}, { plaidStateEnabled: true });
    expect(prompt).toContain(
      `2. **Only use context when relevant.** Bring up the user's profile or financial data only when their question directly relates to it. What financial data you can actually see this turn is stated below under "What you can see this turn" — rely on that, not on assumptions.`
    );
    expect(prompt).not.toContain("but not to their bank data");
  });
});

describe("generateSystemPrompt — the per-user context comes last", () => {
  const ALICE: UserContext = {
    firstName: "Alice",
    lastName: "Zephyrine",
    hasCreditHistory: true,
    monthlyIncome: 4321,
    monthlySpending: 1234,
    savingsGoal: 9876,
  };
  const BOB: UserContext = { firstName: "Bob", hasCreditHistory: false };

  it.each([false, true])(
    "two different users' prompts both start with the fixed part (plaidStateEnabled=%s)",
    (plaidStateEnabled) => {
      const fixed = buildStaticSystemPrompt({ plaidStateEnabled });
      const alice = generateSystemPrompt(ALICE, { plaidStateEnabled });
      const bob = generateSystemPrompt(BOB, { plaidStateEnabled });
      expect(alice).not.toBe(bob);
      expect(alice.startsWith(fixed)).toBe(true);
      expect(bob.startsWith(fixed)).toBe(true);
    }
  );

  it("the fixed part carries none of the user's values", () => {
    const fixed = buildStaticSystemPrompt();
    for (const value of ["Alice", "Zephyrine", "4,321", "1,234", "9,876"]) {
      expect(generateSystemPrompt(ALICE)).toContain(value);
      expect(fixed).not.toContain(value);
    }
    expect(fixed).not.toContain("## Current User Context");
  });

  it("the context section follows Safety and Escalation", () => {
    const prompt = generateSystemPrompt(ALICE);
    const safetyAt = prompt.indexOf("### Safety and Escalation");
    const contextAt = prompt.indexOf("## Current User Context");
    expect(safetyAt).toBeGreaterThan(-1);
    expect(contextAt).toBeGreaterThan(safetyAt);
    expect(occurrencesOf(prompt, "## Current User Context")).toBe(1);
  });
});

describe("buildStaticSystemPrompt — identity, boundaries and safety priority", () => {
  it.each([false, true])(
    "states the AI identity, safety first right after it, then boundaries (plaidStateEnabled=%s)",
    (plaidStateEnabled) => {
      const fixed = buildStaticSystemPrompt({ plaidStateEnabled });
      expect(
        fixed.startsWith(
          "You are Noor, an AI personal finance guide for people who are just getting started with managing their money.\n\n## Safety comes first\n"
        )
      ).toBe(true);
      const safetyAt = fixed.indexOf("## Safety comes first");
      const identityAt = fixed.indexOf("## Identity and Tone");
      const boundariesAt = fixed.indexOf("## Boundaries");
      expect(identityAt).toBeGreaterThan(safetyAt);
      expect(boundariesAt).toBeGreaterThan(identityAt);
      expect(occurrencesOf(fixed, "## Safety comes first")).toBe(1);
      expect(occurrencesOf(fixed, "## Boundaries")).toBe(1);
    }
  );

  it("the safety section overrides the brevity, volunteering and greeting rules by name", () => {
    const fixed = buildStaticSystemPrompt();
    expect(fixed).toContain(
      `this section overrides every other rule in this prompt, including "Don't volunteer information", "Be concise by default", and any instruction to answer a greeting in 1-2 sentences.`
    );
    for (const line of [
      "1. **Match the user's intent (unless 'Safety comes first' applies).**",
      "3. **Simple questions get simple answers (unless 'Safety comes first' applies).**",
      "4. **Don't volunteer information (unless 'Safety comes first' applies).**",
      "5. **Be concise by default (unless 'Safety comes first' applies).**",
      "- Greeting or small talk: 1–2 short sentences (unless 'Safety comes first' applies)",
      "### Safety and Escalation\n'Safety comes first' above takes priority over this section.",
    ]) {
      expect(fixed).toContain(line);
    }
  });

  it("boundaries: says it is an AI, claims no feelings, discourages reliance, limits memory use", () => {
    const fixed = buildStaticSystemPrompt();
    for (const line of [
      "- If asked whether you are a person, say plainly that you are an AI.",
      "- Do not claim to have feelings, memories of your own, or a personal life.",
      "- Do not encourage the user to rely on you for emotional support or companionship; you are not a therapist or counselor.",
      "- Use remembered information only when it is needed to answer the current financial question. Do not bring up earlier personal topics to build closeness.",
    ]) {
      expect(fixed).toContain(line);
    }
  });

  it("guideline 7 gives a next step instead of empathy first, and no friend persona remains", () => {
    const fixed = buildStaticSystemPrompt();
    expect(fixed).toContain("acknowledge it briefly, then give a concrete next step");
    expect(fixed).not.toContain("with empathy");
    expect(fixed.toLowerCase()).not.toContain("friend");
  });
});

function occurrencesOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
