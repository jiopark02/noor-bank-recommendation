import { randomBytes } from "crypto";
import { validateEmail, PASSWORD_SYMBOLS } from "./validation";
import { buildConfirmationLink } from "./emailConfirmation";
import type { ConfirmationClaim } from "./confirmationSendLimit";

/**
 * POST /api/auth/resend-confirmation — every branch, none of the IO. The
 * route reads the body under a byte limit, gates on the admin client being
 * configured, builds the real dependencies and serializes the result.
 * resendConfirmation.test.ts runs each branch with injected fakes.
 *
 * The request carries an email and nothing else that is read. It is
 * unauthenticated by design: the callers are the sign-in page (an unconfirmed
 * account), the callback's expired-link screen and the survey's send-failed
 * panel, none of which has a session.
 *
 * ORDER
 *   1. Email format: 400 on a missing or malformed email. This and the
 *      route's 413 / 503 are the only answers that differ.
 *   2. users row by normalized email -> id. No row: nothing to do.
 *   3. auth.admin.getUserById(id). No user, a different email on the Auth
 *      user, or an email already confirmed: nothing to do.
 *   4. claimConfirmationSend(id). Only "claimed" goes on; "held" and "error"
 *      stop here (error is fail-closed).
 *   5. generateLink signup for that email. The metadata passed is the Auth
 *      user's own user_metadata, as read in step 3, because generateLink
 *      overwrites user_metadata with whatever `data` it is given. The
 *      password is random: generateLink requires one and ignores it for a
 *      user who already exists. A link whose user id is not the id from
 *      step 2 is not sent.
 *   6. Send the email (awaited; a failure is logged).
 *
 * Every branch after step 1 answers the same 200 body, so the response does
 * not say whether an account exists, is confirmed, or was mailed. The time a
 * branch takes still differs; that is reduced by nothing here.
 *
 * LOGGING
 * One line per request through deps.log (console.error by default):
 * `[resend-confirmation] branch=<name>` plus `user_id=<id>` when one is known
 * and an error code when there is one. Never the email address.
 */

export const RESEND_MAX_BODY_BYTES = 4096;

export const RESEND_ACCEPTED_MESSAGE =
  "If this email belongs to an account that still needs confirming, we've sent a new confirmation link. Please check your inbox.";
const EMAIL_INVALID_MESSAGE = "Please enter a valid email address";

export type ResendAuthUser = {
  email: string | null;
  emailConfirmed: boolean;
  userMetadata: Record<string, unknown>;
};

export type ResendDeps = {
  findUserIdByEmail: (
    email: string
  ) => Promise<{ userId: string | null; error: unknown }>;
  getAuthUser: (
    userId: string
  ) => Promise<{ user: ResendAuthUser | null; error: unknown }>;
  claim: (userId: string) => Promise<ConfirmationClaim>;
  generateSignupLink: (args: {
    email: string;
    password: string;
    data: Record<string, unknown>;
  }) => Promise<{ userId: string | null; hashedToken: string | null; error: unknown }>;
  sendConfirmationEmail: (email: string, link: string) => Promise<boolean>;
  appUrl: string;
  /** Defaults to generatePlaceholderPassword. */
  randomPassword?: () => string;
  /** Defaults to console.error. */
  log?: (line: string) => void;
};

export type ResendResult = { status: number; body: Record<string, unknown> };

const ACCEPTED: ResendResult = {
  status: 200,
  body: { success: true, message: RESEND_ACCEPTED_MESSAGE },
};

function accepted(): ResendResult {
  return { status: ACCEPTED.status, body: { ...ACCEPTED.body } };
}

function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string" && /^[\w.-]{1,64}$/.test(code)) return code;
  }
  return "none";
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

function pick(alphabet: string, byte: number): string {
  return alphabet.charAt(byte % alphabet.length);
}

/**
 * A password nobody knows, for generateLink's required argument. It meets the
 * signup policy (validatePassword) by construction, with one character from
 * each class, so a strength check on it cannot refuse the call. 48 random
 * base64url characters carry the entropy; the modulo bias of the four class
 * characters does not matter beside them.
 */
export function generatePlaceholderPassword(): string {
  const bytes = randomBytes(40);
  return (
    pick(UPPER, bytes[0]) +
    pick(LOWER, bytes[1]) +
    pick(DIGITS, bytes[2]) +
    pick(PASSWORD_SYMBOLS, bytes[3]) +
    bytes.subarray(4).toString("base64").replace(/[^A-Za-z0-9]/g, "x")
  );
}

export async function resendConfirmation(
  body: unknown,
  deps: ResendDeps
): Promise<ResendResult> {
  const log = deps.log ?? ((line: string) => console.error(line));
  const emit = (branch: string, userId?: string, error?: unknown): void => {
    let line = "[resend-confirmation] branch=" + branch;
    if (userId) line += " user_id=" + userId;
    if (error !== undefined) line += " code=" + codeOf(error);
    log(line);
  };

  const raw =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).email
      : undefined;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email || !validateEmail(email).isValid) {
    return { status: 400, body: { success: false, message: EMAIL_INVALID_MESSAGE } };
  }

  try {
    const found = await deps.findUserIdByEmail(email);
    if (found.error) {
      emit("lookup-error", undefined, found.error);
      return accepted();
    }
    const userId = found.userId;
    if (!userId) {
      emit("no-row");
      return accepted();
    }

    const auth = await deps.getAuthUser(userId);
    if (auth.error) {
      emit("auth-read-error", userId, auth.error);
      return accepted();
    }
    if (!auth.user) {
      emit("no-auth-user", userId);
      return accepted();
    }
    // generateLink is keyed by email. If the Auth user's email is not the one
    // asked about, the call could reach (or create) a different Auth user.
    if ((auth.user.email ?? "").trim().toLowerCase() !== email) {
      emit("email-mismatch", userId);
      return accepted();
    }
    if (auth.user.emailConfirmed) {
      emit("confirmed", userId);
      return accepted();
    }

    const claim = await deps.claim(userId);
    if (claim !== "claimed") {
      emit(claim === "held" ? "held" : "claim-error", userId);
      return accepted();
    }

    const password = (deps.randomPassword ?? generatePlaceholderPassword)();
    const link = await deps.generateSignupLink({
      email,
      password,
      data: auth.user.userMetadata,
    });
    if (link.error || !link.hashedToken || !link.userId) {
      emit("link-error", userId, link.error ?? null);
      return accepted();
    }
    if (link.userId !== userId) {
      emit("link-id-mismatch", userId);
      return accepted();
    }

    const sent = await deps.sendConfirmationEmail(
      email,
      buildConfirmationLink(deps.appUrl, link.hashedToken)
    );
    emit(sent ? "sent" : "send-failed", userId);
    return accepted();
  } catch (error) {
    emit("threw", undefined, error);
    return accepted();
  }
}
