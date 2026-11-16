import { describe, it, expect, vi, afterEach } from "vitest";
import { validateExtraction } from "@/lib/factExtractionValidation";
import { budgetExistingFacts } from "@/lib/cronInputBudget";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateExtraction against budgeted existing facts", () => {
  // Enough long facts that the facts budget keeps only some of them.
  const factsArray = Array.from({ length: 60 }, (_, i) => ({
    id: `fact-${i}`,
    category: "financial",
    fact: `${i}:`.padEnd(490, "f"),
  }));
  const existing = budgetExistingFacts(factsArray);
  const kept = existing.facts.length;

  it("keeps fewer facts than it was given", () => {
    expect(kept).toBeGreaterThan(1);
    expect(kept).toBeLessThan(factsArray.length);
  });

  it("accepts an old_number the model was shown and drops one past it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = validateExtraction(
      {
        new_facts: [],
        supersede: [
          { old_number: kept, category: "financial", fact: "Rent is $1,700." },
          { old_number: kept + 1, category: "financial", fact: "Rent is $1,800." },
        ],
        expire: [{ old_number: kept - 1 }, { old_number: kept + 2 }],
      },
      existing.facts.length,
      "session-1"
    );
    expect(result.supersede.map((s) => s.oldNumber)).toEqual([kept]);
    expect(result.expire.map((e) => e.oldNumber)).toEqual([kept - 1]);
    // Every accepted number resolves to a fact the model was shown.
    for (const item of [...result.supersede, ...result.expire]) {
      expect(existing.facts[item.oldNumber - 1]).toBe(factsArray[item.oldNumber - 1]);
    }
  });

  it("accepts the same numbers when every fact fits", () => {
    const result = validateExtraction(
      {
        supersede: [
          { old_number: kept + 1, category: "financial", fact: "Rent is $1,800." },
        ],
        expire: [{ old_number: kept + 2 }],
      },
      factsArray.length,
      "session-1"
    );
    expect(result.supersede.map((s) => s.oldNumber)).toEqual([kept + 1]);
    expect(result.expire.map((e) => e.oldNumber)).toEqual([kept + 2]);
  });
});
