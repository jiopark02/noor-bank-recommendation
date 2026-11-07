/**
 * Turns the text of the survey page's money input into the digits it keeps.
 * Pure, so the rules run in unit tests; the page renders the result.
 *
 * Typing is limited to digits by the input's key handler, which also stops a
 * digit once the field is full (moneyInputKeyBlocked), so the other rules
 * matter for pasted text such as "$1,234.56":
 *   - everything from the first "." on is dropped: cents are cut off, never
 *     rounded, because the server accepts whole amounts only;
 *   - every remaining non-digit (currency signs, thousands separators,
 *     spaces) is removed;
 *   - leading zeros are removed;
 *   - at most MAX_MONTHLY_AMOUNT_DIGITS digits are kept. The cap is all nines,
 *     so the digit limit alone keeps the value within what the server accepts.
 */

import { MAX_MONTHLY_AMOUNT_DIGITS } from "./surveyMoney";

/**
 * The input's maxLength. It must be long enough to hold a formatted amount
 * with cents ("$999,999.99") so the browser does not cut pasted text before
 * it is parsed; the digit limit is applied by moneyInputDigits.
 */
export const MONEY_INPUT_MAX_LENGTH = 24;

/** The kept digits, "" when none are left. */
export function moneyInputDigits(text: string): string {
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  return whole
    .replace(/\D/g, "")
    .replace(/^0+/, "")
    .slice(0, MAX_MONTHLY_AMOUNT_DIGITS);
}

/**
 * Whether a key press must be blocked because the field already holds the
 * most digits it keeps. Only a digit key is blocked, and only when nothing is
 * selected: a digit typed over a selection replaces it and cannot lengthen
 * the amount. Without this, the extra digit would be inserted and the digit
 * limit in moneyInputDigits would then cut the last digit off, changing the
 * amount (123456 with the caret after the 1, then 9, would become 192345).
 * A null selection is read as no selection.
 */
export function moneyInputKeyBlocked(
  key: string,
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null
): boolean {
  if (!/^\d$/.test(key)) return false;
  if (moneyInputDigits(value).length < MAX_MONTHLY_AMOUNT_DIGITS) return false;
  return selectionStart === selectionEnd;
}

/** The amount the kept digits stand for, 0 when none are left. */
export function moneyInputAmount(text: string): number {
  const digits = moneyInputDigits(text);
  return digits ? parseInt(digits, 10) : 0;
}
