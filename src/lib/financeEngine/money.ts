import type { RecurringFrequency } from "./types";

/**
 * Rounds half away from zero, so a negative amount rounds the same way as its
 * positive mirror (Math.round alone sends -0.5 to -0, not -1).
 */
function roundHalfAwayFromZero(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * Converts a dollar amount to integer cents. Meant for adapters: Plaid reports
 * floats, so 15.49 arrives as 15.4899999… and must be rounded, not truncated.
 * NaN and Infinity pass through unchanged; isCents rejects them downstream.
 */
export function toCents(dollars: number): number {
  return roundHalfAwayFromZero(dollars * 100);
}

export function isCents(x: unknown): x is number {
  return typeof x === "number" && isFinite(x) && Math.floor(x) === x;
}

export function sumCents(xs: number[]): number {
  let total = 0;
  for (let i = 0; i < xs.length; i++) total += xs[i];
  return total;
}

/**
 * One occurrence's amount expressed per month. Exact ratios (52/12, 26/12),
 * rounded once at the end. UNKNOWN has no defensible ratio and returns null —
 * callers list it rather than guess.
 */
export function monthlyCentsFromCadence(
  cents: number,
  frequency: RecurringFrequency
): number | null {
  switch (frequency) {
    case "WEEKLY":
      return roundHalfAwayFromZero((cents * 52) / 12);
    case "BIWEEKLY":
      return roundHalfAwayFromZero((cents * 26) / 12);
    case "SEMI_MONTHLY":
      return cents * 2;
    case "MONTHLY":
      return cents;
    case "ANNUALLY":
      return roundHalfAwayFromZero(cents / 12);
    default:
      return null;
  }
}
