/**
 * What the survey page does with the answer to POST /api/survey. Browser-safe:
 * no Supabase client is imported here. surveySubmitOutcome.test.ts runs it.
 *
 * A new email signup is not signed in by the page: the account is
 * unconfirmed until its owner opens the confirmation link, so a successful
 * signup only says to check the inbox, or that the email could not be sent.
 */

/** Shown when a failure body carries no message of its own. */
export const DEFAULT_SUBMIT_FAILURE_MESSAGE =
  "Failed to create account. Please try again.";

/** The message a failed submit shows: the body's own, else the default. */
export function surveyFailureMessage(result: unknown): string {
  const body =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : {};
  return typeof body.message === "string" && body.message
    ? body.message
    : DEFAULT_SUBMIT_FAILURE_MESSAGE;
}

export type SignupOutcome = "check-email" | "check-email-send-failed";

/**
 * What a successful signup shows. Only an explicit confirmationEmailSent
 * true says the email went out; anything else offers to send it again.
 */
export function signupOutcome(result: unknown): SignupOutcome {
  const body =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : {};
  return body.confirmationEmailSent === true ? "check-email" : "check-email-send-failed";
}
