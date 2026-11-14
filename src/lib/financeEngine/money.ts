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

/**
 * An integer amount of cents that is exactly representable: above
 * Number.MAX_SAFE_INTEGER, neighbouring integers collapse and sums stop
 * being exact, so such a value is not a usable amount.
 */
export function isCents(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x);
}
