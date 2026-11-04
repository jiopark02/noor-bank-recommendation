/**
 * Machine-readable `code` values in POST /api/survey failure bodies. Shared by
 * the server and the survey page, so the page can branch on a code rather
 * than on message text.
 */

/** The email belongs to an Auth account whose profile row does not exist. */
export const ACCOUNT_INCOMPLETE = "ACCOUNT_INCOMPLETE";

/**
 * A monthly income or spending answer is missing or not a whole number in
 * range (see surveyMoney.ts). Refused before anything is created or written.
 */
export const INVALID_MONTHLY_AMOUNT = "INVALID_MONTHLY_AMOUNT";
