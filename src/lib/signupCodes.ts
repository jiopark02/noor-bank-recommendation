/**
 * Machine-readable `code` values in POST /api/survey failure bodies. Shared by
 * the server and the survey page, so the page can branch on a code rather
 * than on message text.
 */

/** The email belongs to an Auth account whose profile row does not exist. */
export const ACCOUNT_INCOMPLETE = "ACCOUNT_INCOMPLETE";

/** The account was created but its survey answers were not saved. */
export const SURVEY_SAVE_FAILED = "SURVEY_SAVE_FAILED";
