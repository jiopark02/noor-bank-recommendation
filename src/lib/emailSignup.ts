import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { toLogSafeError } from "./logSafeError";
import { ACCOUNT_INCOMPLETE, INVALID_MONTHLY_AMOUNT } from "./signupCodes";
import { checkSurveyMoney } from "./surveyMoney";
import { sanitizeNameField, validateEmail } from "./validation";
import { buildConfirmationLink } from "./emailConfirmation";
import type { ConfirmationClaim } from "./confirmationSendLimit";

/**
 * The email/password signup half of POST /api/survey — every branch, none of
 * the IO. The route runs it when the request carries no verified Bearer token,
 * builds the real dependencies, and serializes the result. emailSignup.test.ts
 * runs each branch with injected fakes.
 *
 * The account this creates is UNCONFIRMED. It cannot sign in until its owner
 * opens the confirmation link this sends and presses the button on
 * /auth/callback; nothing here signs anyone in.
 *
 * ORDER
 *   1. No password: 401 AUTH_REQUIRED. A signed-in client whose token went
 *      missing looks anonymous here, but it sends no password; a real signup
 *      does. This comes before the pause gate so a signed-in user is not told
 *      that signups are paused.
 *   2. Signups paused: 403, before anything is read or created, so a paused
 *      signup answers 403 whatever it sends.
 *   3. Input, checked on cleaned values, email first: an email that is
 *      missing, empty after trimming or not a string is 400; an email that
 *      fails the same format check the survey page uses is 400. Both names
 *      are sanitized here (sanitizeNameField), whatever the caller did: a
 *      first name that is empty after sanitizing is 400, and a last name that
 *      is empty after sanitizing becomes null. Then the monthly money answers
 *      (checkSurveyMoney, mode "insert"): a missing or invalid amount is 400
 *      INVALID_MONTHLY_AMOUNT. A refused request reads and creates nothing.
 *   4. Look the email up in public.users. A failed read is a 500 and nothing
 *      is created: it is never read as "no row".
 *   5a. A row exists (a second signup for the same email): RESIGNUP below.
 *   5b. No row: generateLink signup creates the unconfirmed Auth user (or, for
 *      an unconfirmed Auth user left without a row, returns it with a new
 *      token) with the request's names as metadata. A refusal is classified by
 *      code (classifyCreateUserError); a duplicate is answered by
 *      answerDuplicate, read-only.
 *   6. Insert the public.users row. A 23505 is RACE below. Any other failure
 *      deletes the Auth user again (ROLLBACK) and answers 500.
 *   7. Insert the survey_responses row. A failure is logged and answered as
 *      surveySaved: false; the account stays.
 *   8. Claim a confirmation send and, only when claimed, send the email.
 *      Awaited, because a serverless function is frozen once the response
 *      returns. confirmationEmailSent says whether it went out.
 *
 * RESIGNUP (5a)
 * generateLink is called with the ROW's names, because it overwrites
 * user_metadata with whatever `data` it is given; the request's names, its
 * password and its survey answers are dropped. Nothing is inserted or rolled
 * back. When the Auth user it returns is not the row's id, nothing is sent.
 * Otherwise claim, then send only when claimed. The body is the full-success
 * body whatever happened, so the response does not say whether an
 * unconfirmed account exists or was mailed; what happened is logged.
 * A duplicate refusal from generateLink (the account is confirmed) is the
 * ordinary 409, as before.
 *
 * RACE (23505 on the users insert)
 * Another request created the row between steps 4 and 6. No rollback (the
 * Auth user is the other request's too) and no survey insert. The row is read
 * again by email: a failed read or no row sends nothing; a row whose id is not
 * the Auth user's sends nothing; the same id claims and sends. Every case
 * answers the full-success body.
 *
 * ROLLBACK
 * The admin API returns an Auth error as a value rather than throwing it, so
 * the delete's result is read, not caught. A retryable error (a network
 * failure or a 502/503/504) is retried once, immediately. "user_not_found" or
 * a 404 means the user is already gone, which is the state the rollback wants.
 * Any other final failure is logged as one line carrying only the error code
 * and the user id.
 *
 * LOGGING
 * Lines go through emit(): deps.log when given, console.error otherwise. They
 * carry user ids and toLogSafeError output, never the email address.
 */

const AUTH_REQUIRED_MESSAGE =
  "We couldn't verify your sign-in for this request. Please reload the page and try again.";
const SIGNUP_PAUSED_MESSAGE =
  "New signups are temporarily paused. Please join the waitlist and we'll email you when signups reopen.";
const EMAIL_REQUIRED_MESSAGE = "Email is required";
const EMAIL_INVALID_MESSAGE = "Please enter a valid email address";
/** Also answered by the route's signed-in path for an empty first name. */
export const NAME_REQUIRED_MESSAGE = "First name is required";
const DUPLICATE_EMAIL_MESSAGE = "An account with this email already exists";
const ACCOUNT_INCOMPLETE_MESSAGE =
  "An account with this email already exists, but its setup was not completed. Please contact support.";
const WEAK_PASSWORD_MESSAGE = "Please choose a stronger password.";
const CREATE_ACCOUNT_FAILED_MESSAGE = "Failed to create account. Please try again.";
const PROFILE_INSERT_FAILED_MESSAGE = "Failed to create user profile record";
export const CONFIRMATION_REQUIRED_MESSAGE =
  "Account created. Please check your email to confirm your address.";

export type SignupMetadata = { first_name: string | null; last_name: string | null };

export type GenerateSignupLinkArgs = {
  email: string;
  password: string;
  data: SignupMetadata;
};

export type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

export type EmailSignupInput = {
  /** Raw request values; email and password are not yet validated. */
  email: unknown;
  password: unknown;
  /** Sanitized again here before it is checked; null when empty. */
  firstName: string | null;
  /** Sanitized again here; empty after sanitizing becomes null. */
  lastName: string | null;
  destinationCountry: unknown;
  /**
   * The whole request body. Only its monthly money keys are read here, to be
   * checked before anything is read or created; insertSurveyResponse builds
   * the survey row from the same body.
   */
  surveyBody: unknown;
};

export type EmailSignupDeps = {
  /** The SIGNUP_DISABLED gate. */
  isSignupDisabled: () => boolean;
  /**
   * auth.admin.generateLink type signup. userId or hashedToken null with
   * error null still counts as a failed creation.
   */
  generateSignupLink: (
    args: GenerateSignupLinkArgs
  ) => Promise<{ userId: string | null; hashedToken: string | null; error: unknown }>;
  /** The public.users row with this (normalized) email, or null. */
  findProfileByEmail: (
    email: string
  ) => Promise<{ row: ProfileRow | null; error: unknown }>;
  /** Keeps the error's `code` (23505 decides a branch). */
  insertProfile: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  /** May also throw; a throw is handled like a returned error. */
  deleteAuthUser: (userId: string) => Promise<{ error: unknown }>;
  insertSurveyResponse: (userId: string) => Promise<{ error: unknown }>;
  /** claimConfirmationSend bound to the service-role rpc. */
  claimConfirmationSend: (userId: string) => Promise<ConfirmationClaim>;
  sendConfirmationEmail: (email: string, link: string) => Promise<boolean>;
  /** Base of the confirmation link. */
  appUrl: string;
  /** ISO timestamp used for created_at and updated_at. */
  now: () => string;
  /** Defaults to console.error. Injected so tests stay quiet. */
  log?: (line: string) => void;
};

export type EmailSignupResult = {
  status: number;
  body: Record<string, unknown>;
};

function emit(deps: EmailSignupDeps, line: string): void {
  if (deps.log) {
    deps.log(line);
    return;
  }
  console.error(line);
}

function failure(
  status: number,
  message: string,
  extra: Record<string, unknown> = {}
): EmailSignupResult {
  return { status, body: { success: false, message, ...extra } };
}

function accepted(confirmationEmailSent: boolean, surveySaved: boolean): EmailSignupResult {
  return {
    status: 200,
    body: {
      success: true,
      confirmationRequired: true,
      confirmationEmailSent,
      surveySaved,
      message: CONFIRMATION_REQUIRED_MESSAGE,
    },
  };
}

function safeErrorText(error: unknown): string {
  return JSON.stringify(toLogSafeError(error));
}

function errorField(error: unknown, field: "code" | "status" | "message"): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as Record<string, unknown>)[field];
}

function codeText(error: unknown): string {
  return String(toLogSafeError(error).code ?? "none");
}

export type CreateUserRefusal = "duplicate" | "weak_password" | "failed";

/**
 * Why createUser / generateLink refused. The error code decides when there is
 * one; only an error without a code falls back to the message text.
 */
export function classifyCreateUserError(error: unknown): CreateUserRefusal {
  const code = errorField(error, "code");
  if (typeof code === "string" && code) {
    if (code === "email_exists" || code === "user_already_exists") {
      return "duplicate";
    }
    if (code === "weak_password") {
      return "weak_password";
    }
    return "failed";
  }
  const message = String(errorField(error, "message") || "").toLowerCase();
  if (message.includes("already") || message.includes("exists")) {
    return "duplicate";
  }
  return "failed";
}

/** A delete that found no such user has reached the state the rollback wants. */
function isAlreadyGone(error: unknown): boolean {
  return (
    errorField(error, "code") === "user_not_found" ||
    errorField(error, "status") === 404
  );
}

async function attemptDelete(
  userId: string,
  deps: EmailSignupDeps
): Promise<unknown> {
  try {
    const { error } = await deps.deleteAuthUser(userId);
    return error ?? null;
  } catch (thrown) {
    return thrown;
  }
}

async function rollbackAuthUser(
  userId: string,
  deps: EmailSignupDeps
): Promise<void> {
  let error = await attemptDelete(userId, deps);
  if (error && isAuthRetryableFetchError(error)) {
    error = await attemptDelete(userId, deps);
  }
  if (error && !isAlreadyGone(error)) {
    emit(
      deps,
      "[signup] rollback of auth user failed: code=" +
        (toLogSafeError(error).code ?? "none") +
        " user_id=" +
        userId
    );
  }
}

/**
 * The answer to a duplicate email. Read-only: an Auth account without a
 * profile row is reported, never repaired or removed.
 */
async function answerDuplicate(
  email: string,
  deps: EmailSignupDeps
): Promise<EmailSignupResult> {
  const { row, error } = await deps.findProfileByEmail(email);
  if (error) {
    emit(
      deps,
      "[signup] profile lookup for a duplicate email failed: code=" + codeText(error)
    );
    return failure(409, DUPLICATE_EMAIL_MESSAGE);
  }
  if (!row) {
    emit(deps, "[signup] duplicate email has an Auth account but no profile row");
    return failure(409, ACCOUNT_INCOMPLETE_MESSAGE, { code: ACCOUNT_INCOMPLETE });
  }
  return failure(409, DUPLICATE_EMAIL_MESSAGE);
}

/** The answer to a refused or empty generateLink. */
async function answerLinkRefusal(
  email: string,
  error: unknown,
  deps: EmailSignupDeps
): Promise<EmailSignupResult> {
  emit(deps, "[signup] auth user creation refused: " + safeErrorText(error));
  const refusal = error ? classifyCreateUserError(error) : "failed";
  if (refusal === "duplicate") {
    return answerDuplicate(email, deps);
  }
  if (refusal === "weak_password") {
    return failure(400, WEAK_PASSWORD_MESSAGE);
  }
  return failure(500, CREATE_ACCOUNT_FAILED_MESSAGE);
}

/**
 * Claims a send for userId and sends only when claimed. Returns whether an
 * email went out. `label` names the branch in the log lines.
 */
async function claimAndSend(
  email: string,
  userId: string,
  hashedToken: string,
  label: string,
  deps: EmailSignupDeps
): Promise<boolean> {
  const claim = await deps.claimConfirmationSend(userId);
  if (claim !== "claimed") {
    emit(
      deps,
      "[signup] " + label + " confirmation not sent (claim=" + claim + ") user_id=" + userId
    );
    return false;
  }
  try {
    const sent = await deps.sendConfirmationEmail(
      email,
      buildConfirmationLink(deps.appUrl, hashedToken)
    );
    if (!sent) {
      emit(
        deps,
        "[signup] " + label + " confirmation not sent (returned false) user_id=" + userId
      );
    }
    return sent;
  } catch (error) {
    emit(
      deps,
      "[signup] " +
        label +
        " confirmation not sent (threw) user_id=" +
        userId +
        " " +
        safeErrorText(error)
    );
    return false;
  }
}

function logMismatch(
  deps: EmailSignupDeps,
  branch: "resignup" | "race-23505",
  rowId: string,
  authId: string
): void {
  emit(
    deps,
    "[signup] resignup id mismatch branch=" + branch + " row_id=" + rowId + " auth_id=" + authId
  );
}

export async function createEmailAccount(
  input: EmailSignupInput,
  deps: EmailSignupDeps
): Promise<EmailSignupResult> {
  if (!input.password) {
    return failure(401, AUTH_REQUIRED_MESSAGE, { code: "AUTH_REQUIRED" });
  }

  if (deps.isSignupDisabled()) {
    return failure(403, SIGNUP_PAUSED_MESSAGE);
  }

  // Trimmed before it is checked, so an email of only whitespace is missing
  // rather than an empty address. A non-string email counts as missing.
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) {
    return failure(400, EMAIL_REQUIRED_MESSAGE);
  }
  if (!validateEmail(email).isValid) {
    return failure(400, EMAIL_INVALID_MESSAGE);
  }

  const firstName = sanitizeNameField(input.firstName);
  if (!firstName) {
    return failure(400, NAME_REQUIRED_MESSAGE);
  }
  const lastName = sanitizeNameField(input.lastName) || null;

  const money = checkSurveyMoney(input.surveyBody, "insert");
  if (!money.ok) {
    return failure(400, money.message, { code: INVALID_MONTHLY_AMOUNT });
  }

  const password = input.password as string;
  const now = deps.now();

  const existing = await deps.findProfileByEmail(email);
  if (existing.error) {
    emit(deps, "[signup] profile lookup before signup failed: code=" + codeText(existing.error));
    return failure(500, CREATE_ACCOUNT_FAILED_MESSAGE);
  }

  // ---- RESIGNUP: a users row already has this email ----
  if (existing.row) {
    const row = existing.row;
    const link = await deps.generateSignupLink({
      email,
      password,
      data: { first_name: row.first_name, last_name: row.last_name },
    });
    if (link.error || !link.userId || !link.hashedToken) {
      return answerLinkRefusal(email, link.error, deps);
    }
    if (link.userId !== row.id) {
      logMismatch(deps, "resignup", row.id, link.userId);
      return accepted(true, true);
    }
    await claimAndSend(email, link.userId, link.hashedToken, "resignup", deps);
    return accepted(true, true);
  }

  // ---- NEW SIGNUP ----
  const link = await deps.generateSignupLink({
    email,
    password,
    data: { first_name: firstName, last_name: lastName },
  });
  if (link.error || !link.userId || !link.hashedToken) {
    return answerLinkRefusal(email, link.error, deps);
  }
  const userId = link.userId;
  const hashedToken = link.hashedToken;

  const { error: profileError } = await deps.insertProfile({
    id: userId,
    email,
    first_name: firstName,
    last_name: lastName,
    raw_user_meta_data: {
      source: "survey_signup",
      destination_country: input.destinationCountry || null,
    },
    created_at: now,
    updated_at: now,
  });

  if (profileError && errorField(profileError, "code") === "23505") {
    // ---- RACE: the row appeared after the lookup ----
    const again = await deps.findProfileByEmail(email);
    if (again.error) {
      emit(
        deps,
        "[signup] resignup race-23505 lookup=error code=" +
          codeText(again.error) +
          " auth_id=" +
          userId
      );
      return accepted(true, true);
    }
    if (!again.row) {
      emit(deps, "[signup] resignup id mismatch branch=race-23505 lookup=none auth_id=" + userId);
      return accepted(true, true);
    }
    if (again.row.id !== userId) {
      logMismatch(deps, "race-23505", again.row.id, userId);
      return accepted(true, true);
    }
    await claimAndSend(email, userId, hashedToken, "race-23505", deps);
    return accepted(true, true);
  }

  if (profileError) {
    emit(
      deps,
      "[signup] profile insert failed: user_id=" +
        userId +
        " " +
        safeErrorText(profileError)
    );
    await rollbackAuthUser(userId, deps);
    return failure(500, PROFILE_INSERT_FAILED_MESSAGE);
  }

  const { error: surveyError } = await deps.insertSurveyResponse(userId);
  const surveySaved = !surveyError;
  if (surveyError) {
    emit(
      deps,
      "[signup] survey response insert failed: user_id=" +
        userId +
        " " +
        safeErrorText(surveyError)
    );
  }

  const sent = await claimAndSend(email, userId, hashedToken, "signup", deps);
  return accepted(sent, surveySaved);
}
