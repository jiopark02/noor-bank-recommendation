/**
 * userFactCategories — the categories a stored user fact may carry. The fact
 * extraction cron accepts a model-returned category only if it is one of
 * these. Pure and dependency-free, so it can be tested without a database.
 *
 * There is deliberately no "visa" category: immigration status is not
 * collected as memory.
 */

export const USER_FACT_CATEGORIES = [
  "financial",
  "personal",
  "goal",
  "preference",
  "banking",
  "other",
] as const;

export type UserFactCategory = (typeof USER_FACT_CATEGORIES)[number];

export function isUserFactCategory(value: unknown): value is UserFactCategory {
  return (
    typeof value === "string" &&
    (USER_FACT_CATEGORIES as ReadonlyArray<string>).indexOf(value) !== -1
  );
}
