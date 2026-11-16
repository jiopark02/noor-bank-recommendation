/**
 * The monthly money answers of POST /api/survey: monthly_income,
 * monthly_budget, and expected_monthly_spending (which the route derives from
 * monthly_budget when the body does not carry it). Shared by the route, the
 * signup decision in emailSignup.ts and the survey page, so the server check
 * and the page's input limit come from one constant. No server imports: the
 * page bundles this file.
 *
 * A valid amount is a JSON number that is a whole number, above 0 and at most
 * MAX_MONTHLY_AMOUNT. Nothing else is coerced: a numeric string, a fraction,
 * zero, a negative, null, a boolean, an object or an array is refused. NaN and
 * Infinity cannot be sent as JSON (JSON.stringify writes them as null), but a
 * raw body such as 1e400 parses to Infinity, so both are refused here too.
 *
 * Zero is refused on purpose: Noor is for people with a monthly income.
 */

export const MAX_MONTHLY_AMOUNT = 999999;

/** Digits in MAX_MONTHLY_AMOUNT: the most digits the page's money input keeps. */
export const MAX_MONTHLY_AMOUNT_DIGITS = String(MAX_MONTHLY_AMOUNT).length;

// Formatted with a fixed locale, so the text does not depend on the runtime's.
const MAX_TEXT = MAX_MONTHLY_AMOUNT.toLocaleString("en-US");

export const INVALID_MONTHLY_INCOME_MESSAGE =
  "Please enter your monthly income as a whole number from 1 to " +
  MAX_TEXT +
  ".";

export const INVALID_MONTHLY_SPENDING_MESSAGE =
  "Please enter your monthly spending as a whole number from 1 to " +
  MAX_TEXT +
  ".";

export type SurveyMoneyField =
  | "monthly_income"
  | "monthly_budget"
  | "expected_monthly_spending";

/** Checked in this order; the first refusal is the one reported. */
const FIELDS: SurveyMoneyField[] = [
  "monthly_income",
  "monthly_budget",
  "expected_monthly_spending",
];

/** Required in a new survey row. expected_monthly_spending is derivable. */
const REQUIRED_ON_INSERT: SurveyMoneyField[] = ["monthly_income", "monthly_budget"];

export function isValidMonthlyAmount(value: unknown): boolean {
  return (
    typeof value === "number" &&
    isFinite(value) &&
    Math.floor(value) === value &&
    value > 0 &&
    value <= MAX_MONTHLY_AMOUNT
  );
}

export type SurveyMoneyCheck =
  | { ok: true }
  | { ok: false; field: SurveyMoneyField; message: string };

/**
 * mode "insert": a new survey_responses row. monthly_income and
 * monthly_budget must be present and valid; expected_monthly_spending is
 * checked when its key is present.
 *
 * mode "update": an existing row. Only keys that are present are checked, and
 * a present key must hold a valid amount, null included: the route writes a
 * column whenever its key is present, so a null would clear the answer. An
 * absent key leaves its column as it is.
 */
export function checkSurveyMoney(
  body: unknown,
  mode: "insert" | "update"
): SurveyMoneyCheck {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  for (const field of FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(record, field);
    const required = mode === "insert" && REQUIRED_ON_INSERT.indexOf(field) !== -1;
    if (!present && !required) continue;
    if (!isValidMonthlyAmount(record[field])) {
      return {
        ok: false,
        field,
        message:
          field === "monthly_income"
            ? INVALID_MONTHLY_INCOME_MESSAGE
            : INVALID_MONTHLY_SPENDING_MESSAGE,
      };
    }
  }
  return { ok: true };
}
