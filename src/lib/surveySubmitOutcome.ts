import { SURVEY_SAVE_FAILED } from "./signupCodes";

/**
 * What the survey page does with a failed POST /api/survey, and the sign-in
 * sequence it runs when an account was created but its answers were not
 * saved. Browser-safe: no Supabase client is imported here; the page injects
 * the calls. surveySubmitOutcome.test.ts runs both with fakes.
 */

/** Shown when a failure body carries no message of its own. */
export const DEFAULT_SUBMIT_FAILURE_MESSAGE =
  "Failed to create account. Please try again.";

/** After signing in, the form is in signed-in mode and needs one more press. */
export const RESAVE_PROMPT_MESSAGE =
  "Your account is ready, but your answers weren't saved. Please press Submit again.";

/** The account exists but signing in to it failed. */
export const SIGN_IN_AFTER_SAVE_FAILURE_MESSAGE =
  "Your account was created, but we couldn't sign you in. Please log in, then retake the survey from Settings.";

export type SurveyFailureAction =
  | { kind: "signInAndResave" }
  | { kind: "message"; message: string };

/**
 * signInAndResave only for a signup (not yet signed in) whose account was
 * created but whose survey row was not; every other failure shows its message.
 */
export function surveyFailureAction(
  isAuthed: boolean,
  result: unknown
): SurveyFailureAction {
  const body =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : {};
  if (!isAuthed && body.code === SURVEY_SAVE_FAILED) {
    return { kind: "signInAndResave" };
  }
  const message =
    typeof body.message === "string" && body.message
      ? body.message
      : DEFAULT_SUBMIT_FAILURE_MESSAGE;
  return { kind: "message", message };
}

export type ResumeInput = {
  email: string;
  password: string;
  staySignedIn: boolean;
};

export type ResumeDeps<S extends { user: { id: string } }> = {
  signIn: (credentials: {
    email: string;
    password: string;
  }) => Promise<{ session: S | null; error: unknown }>;
  /** The page's own session adoption, as on a signed-in arrival. */
  adoptSession: (session: S) => void;
  /** The same record the page writes after a successful submit. */
  recordSignedInUser: (userId: string, staySignedIn: boolean) => void;
};

export type ResumeResult = { ok: boolean; message: string };

/**
 * Sign in with the credentials just used to create the account, then adopt
 * the session and record the user, in that order. Nothing is adopted or
 * recorded unless sign-in returned a session.
 */
export async function resumeAfterSurveySaveFailure<
  S extends { user: { id: string } },
>(input: ResumeInput, deps: ResumeDeps<S>): Promise<ResumeResult> {
  const { session, error } = await deps.signIn({
    email: input.email,
    password: input.password,
  });
  if (error || !session) {
    return { ok: false, message: SIGN_IN_AFTER_SAVE_FAILURE_MESSAGE };
  }
  deps.adoptSession(session);
  deps.recordSignedInUser(session.user.id, input.staySignedIn);
  return { ok: true, message: RESAVE_PROMPT_MESSAGE };
}
