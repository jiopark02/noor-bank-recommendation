/**
 * Fixed copy for Supabase Auth errors shown on the sign-in, callback and
 * password-reset screens.
 *
 * The input is the error CODE only (an AuthError's `code`, or the `error_code`
 * parameter of an auth redirect). An error's message, and a redirect's
 * error_description, are never accepted: both are text a third party can
 * shape (a redirect's parameters are whatever the link says), and putting
 * them on screen lets someone write on a page served from our domain. Every
 * output message is one of the constants below.
 *
 * Expiry wording names no duration: link lifetimes are Supabase
 * configuration, not something this file knows.
 */

export type AuthErrorContext =
  | "sign-in"
  | "oauth"
  | "reset-request"
  | "reset-link"
  | "reset-update";

export type AuthErrorCopy = {
  message: string;
  /** Offer to send a new signup confirmation email. */
  offerResend?: boolean;
  /** Offer to start the password reset again from the email step. */
  offerNewResetLink?: boolean;
};

export const AUTH_COPY = {
  INVALID_CREDENTIALS: "Incorrect email or password.",
  EMAIL_NOT_CONFIRMED:
    "Please confirm your email before signing in. Check your inbox for the confirmation link, or send a new one.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  SIGN_IN_FAILED: "We couldn't sign you in. Please try again.",
  OAUTH_FAILED: "We couldn't start Google sign-in. Please try again.",
  // /auth/callback opened with an error in its URL. Only OAuth redirects put
  // one there; a signup confirmation link's errors come from verifyOtp in the
  // page, so this says nothing about links, email or confirming.
  OAUTH_CALLBACK_FAILED: "We couldn't complete sign-in with Google. Please try again.",
  CONFIRM_LINK_EXPIRED:
    "This link has expired or has already been used. If you've already confirmed your email, please sign in.",
  CONFIRM_LINK_FAILED:
    "We couldn't complete sign-in from this link. Please try again, or sign in.",
  CONFIRM_RETRY:
    "We couldn't reach the sign-in service. Please check your connection and try again.",
  RESEND_SENT:
    "If this email belongs to an account that still needs confirming, we've sent a new confirmation link. Please check your inbox.",
  RESEND_FAILED: "We couldn't send the request. Please try again.",
  RESET_REQUEST_FAILED: "We couldn't send the reset email. Please try again.",
  RESET_LINK_EXPIRED:
    "This reset link has expired or has already been used. Please request a new one.",
  RESET_LINK_FAILED: "We couldn't open this reset link. Please request a new one.",
  SAME_PASSWORD: "Your new password must be different from your current password.",
  WEAK_PASSWORD: "Please choose a stronger password.",
  RESET_UPDATE_FAILED: "We couldn't update your password. Please try again.",
} as const;

export const AUTH_COPY_MESSAGES: readonly string[] = Object.keys(AUTH_COPY).map(
  (key) => AUTH_COPY[key as keyof typeof AUTH_COPY]
);

const RATE_LIMIT_CODES = ["over_request_rate_limit", "over_email_send_rate_limit"];
// Codes of an expired or used password-reset link.
const LINK_EXPIRED_CODES = ["otp_expired", "flow_state_expired", "flow_state_not_found"];

export function copyForAuthError(
  code: unknown,
  context: AuthErrorContext
): AuthErrorCopy {
  const c = typeof code === "string" ? code : "";

  if (RATE_LIMIT_CODES.indexOf(c) !== -1) {
    return { message: AUTH_COPY.RATE_LIMITED };
  }

  switch (context) {
    case "sign-in":
      if (c === "invalid_credentials") return { message: AUTH_COPY.INVALID_CREDENTIALS };
      if (c === "email_not_confirmed") {
        return { message: AUTH_COPY.EMAIL_NOT_CONFIRMED, offerResend: true };
      }
      return { message: AUTH_COPY.SIGN_IN_FAILED };
    case "oauth":
      return { message: AUTH_COPY.OAUTH_FAILED };
    case "reset-request":
      return { message: AUTH_COPY.RESET_REQUEST_FAILED };
    case "reset-link":
      if (LINK_EXPIRED_CODES.indexOf(c) !== -1) {
        return { message: AUTH_COPY.RESET_LINK_EXPIRED, offerNewResetLink: true };
      }
      return { message: AUTH_COPY.RESET_LINK_FAILED, offerNewResetLink: true };
    case "reset-update":
      if (c === "same_password") return { message: AUTH_COPY.SAME_PASSWORD };
      if (c === "weak_password") return { message: AUTH_COPY.WEAK_PASSWORD };
      if (
        c === "session_not_found" ||
        c === "session_expired" ||
        c === "bad_jwt" ||
        c === "reauthentication_needed"
      ) {
        return { message: AUTH_COPY.RESET_LINK_EXPIRED, offerNewResetLink: true };
      }
      return { message: AUTH_COPY.RESET_UPDATE_FAILED };
  }
  return { message: AUTH_COPY.SIGN_IN_FAILED };
}

/** The `code` of an AuthError-shaped value, or null. */
export function authErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}
