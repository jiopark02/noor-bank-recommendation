import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { toLogSafeError } from "./logSafeError";
import { DEFAULT_FIRST_NAME } from "./defaultFirstName";

/**
 * The email/password signup half of POST /api/survey — every branch, none of
 * the IO. The route runs it when the request carries no verified Bearer token,
 * builds the real dependencies, and serializes the result. emailSignup.test.ts
 * runs each branch with injected fakes.
 *
 * ORDER
 *   1. No password: 401 AUTH_REQUIRED. A signed-in client whose token went
 *      missing looks anonymous here, but it sends no password; a real signup
 *      does. This comes before the pause gate so a signed-in user is not told
 *      that signups are paused.
 *   2. Signups paused: 403, before any account is created.
 *   3. No email: 400.
 *   4. Create the Auth user. The attributes are built here, not by the caller.
 *   5. Insert the public.users row. If that fails, delete the Auth user again
 *      (see ROLLBACK) and answer 500.
 *   6. Insert the survey_responses row.
 *   7. Send the welcome email. Awaited, because a serverless function is frozen
 *      once the response returns; a failure is logged and never blocks success.
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
const DUPLICATE_EMAIL_MESSAGE = "An account with this email already exists";
const CREATE_AUTH_FAILED_MESSAGE = "Failed to create auth user";
const PROFILE_INSERT_FAILED_MESSAGE = "Failed to create user profile record";
const SURVEY_SAVE_FAILED_MESSAGE =
  "Account was created, but saving survey data failed. Please contact support.";
const SUCCESS_MESSAGE = "Account created successfully";

export type CreateAuthUserAttributes = {
  email: string;
  password: string;
  email_confirm: true;
  user_metadata: { first_name: string; last_name: string | null };
};

export type EmailSignupInput = {
  /** Raw request values; email and password are not yet validated. */
  email: unknown;
  password: unknown;
  /** Already sanitized; null when empty. */
  firstName: string | null;
  lastName: string | null;
  destinationCountry: unknown;
  institutionId: unknown;
  university: unknown;
  countryOfOrigin: unknown;
};

export type EmailSignupDeps = {
  /** The SIGNUP_DISABLED gate. */
  isSignupDisabled: () => boolean;
  /** userId null with error null still counts as a failed creation. */
  createAuthUser: (
    attributes: CreateAuthUserAttributes
  ) => Promise<{ userId: string | null; error: unknown }>;
  insertProfile: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  /** May also throw; a throw is handled like a returned error. */
  deleteAuthUser: (userId: string) => Promise<{ error: unknown }>;
  insertSurveyResponse: (userId: string) => Promise<{ error: unknown }>;
  sendWelcomeEmail: (email: string, firstName: string) => Promise<boolean>;
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

function safeErrorText(error: unknown): string {
  return JSON.stringify(toLogSafeError(error));
}

function errorField(error: unknown, field: "code" | "status" | "message"): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as Record<string, unknown>)[field];
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

  if (!input.email) {
    return failure(400, EMAIL_REQUIRED_MESSAGE);
  }

  // A non-string email or password throws here, as it did before this module
  // existed; the route's catch answers it.
  const email = (input.email as string).toLowerCase().trim();
  const password = input.password as string;
  const firstName = input.firstName || DEFAULT_FIRST_NAME;
  const now = deps.now();

  const { userId, error: createError } = await deps.createAuthUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: input.lastName },
  });

  if (createError || !userId) {
    const message = String(errorField(createError, "message") || "").toLowerCase();
    if (message.includes("already") || message.includes("exists")) {
      return failure(409, DUPLICATE_EMAIL_MESSAGE);
    }

    emit(deps, "[signup] auth user creation failed: " + safeErrorText(createError));
    const rawMessage = errorField(createError, "message");
    return failure(
      500,
      typeof rawMessage === "string" && rawMessage
        ? rawMessage
        : CREATE_AUTH_FAILED_MESSAGE
    );
  }

  const { error: profileError } = await deps.insertProfile({
    id: userId,
    email,
    first_name: firstName,
    last_name: input.lastName,
    raw_user_meta_data: {
      source: "survey_signup",
      destination_country: input.destinationCountry || null,
    },
    created_at: now,
    updated_at: now,
  });

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
  if (surveyError) {
    emit(
      deps,
      "[signup] survey response insert failed: user_id=" +
        userId +
        " " +
        safeErrorText(surveyError)
    );
    return failure(500, SURVEY_SAVE_FAILED_MESSAGE, { userId });
  }

  // An email that was only whitespace is empty here; as before this module
  // existed, no welcome email is attempted and the response carries no email.
  if (email) {
    try {
      const sent = await deps.sendWelcomeEmail(email, firstName);
      if (!sent) {
        emit(deps, "[signup] welcome email not sent (returned false) user_id=" + userId);
      }
    } catch (error) {
      emit(
        deps,
        "[signup] welcome email not sent (threw) user_id=" +
          userId +
          " " +
          safeErrorText(error)
      );
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      userId,
      profile: {
        firstName,
        lastName: input.lastName,
        ...(email ? { email } : {}),
        institutionId: input.institutionId || null,
        university: input.university || null,
        countryOfOrigin: input.countryOfOrigin || null,
      },
      message: SUCCESS_MESSAGE,
    },
  };
}
