import { describe, expect, it } from "vitest";
import { generateSystemPrompt } from "../noorAIPrompt";

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
