import { describe, expect, it } from "vitest";
import {
  USER_FACT_CATEGORIES,
  isUserFactCategory,
} from "../userFactCategories";

/**
 * The fact extraction cron keeps a model-returned fact only when its category
 * passes isUserFactCategory. "visa" is not a category, so a visa fact the
 * model returns is skipped instead of stored.
 */

describe("USER_FACT_CATEGORIES", () => {
  it("holds the six categories and no visa", () => {
    expect([...USER_FACT_CATEGORIES]).toEqual([
      "financial",
      "personal",
      "goal",
      "preference",
      "banking",
      "other",
    ]);
    expect(USER_FACT_CATEGORIES as ReadonlyArray<string>).not.toContain("visa");
  });
});

describe("isUserFactCategory", () => {
  it("accepts each category", () => {
    for (const category of USER_FACT_CATEGORIES) {
      expect(isUserFactCategory(category)).toBe(true);
    }
  });

  it("rejects visa", () => {
    expect(isUserFactCategory("visa")).toBe(false);
  });

  it("rejects other casing, empty and non-string values", () => {
    for (const value of ["VISA", "Financial", "", " financial", null, undefined, 1, {}]) {
      expect(isUserFactCategory(value)).toBe(false);
    }
  });
});
