import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { CRISIS_NOTICES, composeCrisisReply } from "@/lib/crisisNotice";

const ALL: Array<[string, string]> = Object.entries(CRISIS_NOTICES).flatMap(
  ([category, notice]) => [
    [`${category}.standard`, notice.standard] as [string, string],
    [`${category}.escalated`, notice.escalated] as [string, string],
  ]
);

// Every digit run a notice may contain: 988, Crisis Text Line, the ANAD
// number, and "24/7".
const ALLOWED_DIGIT_RUNS = new Set(["988", "741741", "1", "888", "375", "7767", "24", "7"]);

describe("CRISIS_NOTICES", () => {
  it("has a standard and an escalated notice for each of the three categories", () => {
    expect(Object.keys(CRISIS_NOTICES).sort()).toEqual([
      "eating",
      "harm_to_others",
      "self_harm",
    ]);
    expect(ALL).toHaveLength(6);
    for (const [, text] of ALL) expect(text.trim().length).toBeGreaterThan(0);
  });

  it.each(ALL)("%s names 988", (_label, text) => {
    expect(text).toContain("988");
  });

  it.each(ALL)("%s names no police or emergency number", (_label, text) => {
    expect(text).not.toMatch(/911|police/i);
  });

  it.each(ALL)("%s carries only US contact numbers", (_label, text) => {
    expect(text).not.toContain("+");
    const runs = text.match(/\d+/g) ?? [];
    for (const run of runs) expect(ALLOWED_DIGIT_RUNS.has(run)).toBe(true);
  });

  it.each(ALL)("%s names 741741 only after 988", (_label, text) => {
    if (text.includes("741741")) {
      expect(text).toContain("988");
      expect(text.indexOf("988")).toBeLessThan(text.indexOf("741741"));
    }
  });

  it("both eating notices give 988 before ANAD, the ANAD number, weekdays and no hours", () => {
    for (const text of [CRISIS_NOTICES.eating.standard, CRISIS_NOTICES.eating.escalated]) {
      expect(text.indexOf("988")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("988")).toBeLessThan(text.indexOf("ANAD"));
      expect(text).toContain("call the ANAD Helpline at 1-888-375-7767 on weekdays.");
      expect(text).not.toMatch(/\d\s?(am|pm)\b|central/i);
    }
    expect(CRISIS_NOTICES.eating.standard).toContain(
      "For ongoing support, call the ANAD Helpline at 1-888-375-7767 on weekdays."
    );
  });

  it("records the date the contact details were verified next to the notices", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../crisisNotice.ts", import.meta.url)),
      "utf8"
    );
    const comment = source.indexOf("// Contact details verified 2026-10-27.");
    expect(comment).toBeGreaterThanOrEqual(0);
    expect(comment).toBeLessThan(source.indexOf("export const CRISIS_NOTICES"));
  });
});

describe("composeCrisisReply", () => {
  const EMPTY = "Sorry, I could not generate a response.";

  it("puts the notice first, then the model reply", () => {
    expect(composeCrisisReply("NOTICE", "Here is help.", EMPTY)).toBe(
      "NOTICE\n\nHere is help."
    );
  });

  it("returns the notice alone when the model reply is the empty-reply text", () => {
    expect(composeCrisisReply("NOTICE", EMPTY, EMPTY)).toBe("NOTICE");
  });

  it("returns the notice alone when there is no model reply", () => {
    expect(composeCrisisReply("NOTICE", "", EMPTY)).toBe("NOTICE");
    expect(composeCrisisReply("NOTICE", "   ", EMPTY)).toBe("NOTICE");
    expect(composeCrisisReply("NOTICE", null, EMPTY)).toBe("NOTICE");
    expect(composeCrisisReply("NOTICE", undefined, EMPTY)).toBe("NOTICE");
  });
});
