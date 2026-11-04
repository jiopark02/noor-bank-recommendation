import { describe, it, expect } from "vitest";
import {
  AUTH_COPY,
  AUTH_COPY_MESSAGES,
  authErrorCode,
  copyForAuthError,
  type AuthErrorContext,
} from "../authErrorCopy";

/**
 * Fixed auth error copy: the code picks a constant, and nothing an error or a
 * redirect carries reaches the screen.
 */

const CONTEXTS: AuthErrorContext[] = [
  "sign-in",
  "oauth",
  "confirm-link",
  "reset-request",
  "reset-link",
  "reset-update",
];

const CODES: unknown[] = [
  "invalid_credentials",
  "email_not_confirmed",
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "otp_expired",
  "flow_state_expired",
  "flow_state_not_found",
  "access_denied",
  "same_password",
  "weak_password",
  "session_not_found",
  "unexpected_failure",
  "<script>alert(1)</script>",
  "",
  null,
  undefined,
  42,
  { message: "attacker text" },
];

describe("copyForAuthError", () => {
  it("A1 sign-in codes", () => {
    expect(copyForAuthError("invalid_credentials", "sign-in")).toEqual({
      message: AUTH_COPY.INVALID_CREDENTIALS,
    });
    expect(copyForAuthError("email_not_confirmed", "sign-in")).toEqual({
      message: AUTH_COPY.EMAIL_NOT_CONFIRMED,
      offerResend: true,
    });
    expect(copyForAuthError("over_request_rate_limit", "sign-in").message).toBe(
      AUTH_COPY.RATE_LIMITED
    );
  });

  it("A2 an expired confirmation link offers a resend; access_denied alone does not", () => {
    for (const code of ["otp_expired", "flow_state_expired", "flow_state_not_found"]) {
      expect(copyForAuthError(code, "confirm-link")).toEqual({
        message: AUTH_COPY.CONFIRM_LINK_EXPIRED,
        offerResend: true,
      });
    }
    expect(copyForAuthError("access_denied", "confirm-link")).toEqual({
      message: AUTH_COPY.CONFIRM_LINK_FAILED,
    });
  });

  it("A3 reset codes, each offering a new link where the old one is unusable", () => {
    expect(copyForAuthError("otp_expired", "reset-link")).toEqual({
      message: AUTH_COPY.RESET_LINK_EXPIRED,
      offerNewResetLink: true,
    });
    expect(copyForAuthError("anything", "reset-link").offerNewResetLink).toBe(true);
    expect(copyForAuthError("same_password", "reset-update").message).toBe(
      AUTH_COPY.SAME_PASSWORD
    );
    expect(copyForAuthError("session_not_found", "reset-update")).toEqual({
      message: AUTH_COPY.RESET_LINK_EXPIRED,
      offerNewResetLink: true,
    });
    expect(copyForAuthError("unexpected_failure", "reset-request").message).toBe(
      AUTH_COPY.RESET_REQUEST_FAILED
    );
  });

  it("A4 an unknown code gets the context's general message", () => {
    expect(copyForAuthError("unexpected_failure", "sign-in").message).toBe(AUTH_COPY.SIGN_IN_FAILED);
    expect(copyForAuthError("unexpected_failure", "oauth").message).toBe(AUTH_COPY.OAUTH_FAILED);
    expect(copyForAuthError(null, "confirm-link").message).toBe(AUTH_COPY.CONFIRM_LINK_FAILED);
    expect(copyForAuthError(undefined, "reset-update").message).toBe(AUTH_COPY.RESET_UPDATE_FAILED);
  });

  it("A5 every output, for every code and context, is one of the fixed messages", () => {
    for (const context of CONTEXTS) {
      for (const code of CODES) {
        const copy = copyForAuthError(code, context);
        expect(AUTH_COPY_MESSAGES).toContain(copy.message);
        expect(copy.message).not.toContain("attacker");
        expect(copy.message).not.toContain("<script>");
      }
    }
  });

  it("A6 takes a code, not an error: the signature has two parameters", () => {
    expect(copyForAuthError.length).toBe(2);
  });

  it("A7 no message names a duration", () => {
    for (const message of AUTH_COPY_MESSAGES) {
      expect(message).not.toMatch(/\b\d+\s*(seconds?|minutes?|hours?|days?)\b/i);
    }
  });
});

describe("authErrorCode", () => {
  it("A8 reads only a string code", () => {
    expect(authErrorCode({ code: "otp_expired", message: "x" })).toBe("otp_expired");
    expect(authErrorCode({ message: "x" })).toBeNull();
    expect(authErrorCode({ code: 5 })).toBeNull();
    expect(authErrorCode(null)).toBeNull();
    expect(authErrorCode("otp_expired")).toBeNull();
  });
});
