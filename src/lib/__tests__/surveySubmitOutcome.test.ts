import { describe, it, expect } from "vitest";
import {
  surveyFailureMessage,
  signupOutcome,
  DEFAULT_SUBMIT_FAILURE_MESSAGE,
} from "../surveySubmitOutcome";

/**
 * The survey page's handling of the POST /api/survey answer, executed.
 *
 * Mutations of surveySubmitOutcome.ts and the tests each one turns red:
 *   the body message or the default not used                 -> A3, A4
 *   a send failure read as sent                              -> A1, A5
 */

describe("signupOutcome", () => {
  it("A1 a signup whose email went out says to check the inbox", () => {
    expect(
      signupOutcome({ success: true, confirmationRequired: true, confirmationEmailSent: true, surveySaved: true })
    ).toBe("check-email");
  });

  it("A5 anything but an explicit true offers to send it again", () => {
    for (const sent of [false, undefined, null, "true", 1]) {
      expect(
        signupOutcome({ success: true, confirmationRequired: true, confirmationEmailSent: sent })
      ).toBe("check-email-send-failed");
    }
    expect(signupOutcome(null)).toBe("check-email-send-failed");
  });
});

describe("surveyFailureMessage", () => {
  it("A3 a failure shows its message", () => {
    expect(
      surveyFailureMessage({ success: false, code: "ACCOUNT_INCOMPLETE", message: "contact support" })
    ).toBe("contact support");
  });

  it("A4 a failure without a message shows the default", () => {
    expect(surveyFailureMessage({ success: false })).toBe(DEFAULT_SUBMIT_FAILURE_MESSAGE);
    expect(surveyFailureMessage(null)).toBe(DEFAULT_SUBMIT_FAILURE_MESSAGE);
    expect(surveyFailureMessage({ success: false, message: "" })).toBe(
      DEFAULT_SUBMIT_FAILURE_MESSAGE
    );
  });
});
