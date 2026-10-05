import { describe, it, expect, vi } from "vitest";
import {
  surveyFailureAction,
  resumeAfterSurveySaveFailure,
  DEFAULT_SUBMIT_FAILURE_MESSAGE,
  RESAVE_PROMPT_MESSAGE,
  SIGN_IN_AFTER_SAVE_FAILURE_MESSAGE,
  staySignedInAfterSubmit,
  type ResumeDeps,
} from "../surveySubmitOutcome";
import { SURVEY_SAVE_FAILED } from "../signupCodes";

/**
 * The survey page's handling of a failed submit, executed with fakes.
 *
 * Mutations of surveySubmitOutcome.ts and the tests each one turns red:
 *   M1  the SURVEY_SAVE_FAILED code ignored                   -> A1
 *   M2  the isAuthed condition dropped                        -> A2
 *   M3  the body message or the default not used             -> A3, A4
 *   M4  record not called after a successful sign-in          -> S1
 *   M5  record (or adopt) called when sign-in fails           -> F1, F2
 *   M6  adopt and record in the other order                   -> S1
 *   M7  staySignedIn hardcoded or taken from elsewhere        -> S1, S2
 *   M8  success decided on the error alone (no session)       -> F2
 *   M9  credentials altered on the way to signIn              -> S3
 *   M10 the password not cleared after a successful sign-in   -> S1
 *   M11 the password cleared when sign-in fails               -> F1, F2
 *   M12 a recovered choice ignored on the resubmit            -> K1
 *   M13 the form's choice used for a signed-in arrival        -> K2
 *   M14 the form's choice ignored for a new signup            -> K3
 */

describe("surveyFailureAction", () => {
  it("A1 a signup whose survey save failed signs in and resaves", () => {
    expect(
      surveyFailureAction(false, { success: false, code: SURVEY_SAVE_FAILED, message: "x" })
    ).toEqual({ kind: "signInAndResave" });
  });

  it("A2 an already signed-in submit with the same code just shows the message", () => {
    expect(
      surveyFailureAction(true, { success: false, code: SURVEY_SAVE_FAILED, message: "saved nothing" })
    ).toEqual({ kind: "message", message: "saved nothing" });
  });

  it("A3 any other failure shows its message", () => {
    expect(
      surveyFailureAction(false, { success: false, code: "ACCOUNT_INCOMPLETE", message: "contact support" })
    ).toEqual({ kind: "message", message: "contact support" });
  });

  it("A4 a failure without a message shows the default", () => {
    expect(surveyFailureAction(false, { success: false })).toEqual({
      kind: "message",
      message: DEFAULT_SUBMIT_FAILURE_MESSAGE,
    });
    expect(surveyFailureAction(false, null)).toEqual({
      kind: "message",
      message: DEFAULT_SUBMIT_FAILURE_MESSAGE,
    });
  });
});

type FakeSession = { user: { id: string } };

const SESSION: FakeSession = { user: { id: "user_signed_in_1" } };
const INPUT = { email: "a@example.com", password: "pw-123456", staySignedIn: false };

function fakeDeps(signInResult: { session: FakeSession | null; error: unknown }) {
  const calls: string[] = [];
  const deps = {
    signIn: vi.fn(async () => {
      calls.push("signIn");
      return signInResult;
    }),
    adoptSession: vi.fn(() => {
      calls.push("adopt");
    }),
    recordSignedInUser: vi.fn(() => {
      calls.push("record");
    }),
    clearPassword: vi.fn(() => {
      calls.push("clear");
    }),
  };
  return { deps: deps as ResumeDeps<FakeSession> & typeof deps, calls };
}

describe("resumeAfterSurveySaveFailure", () => {
  it("S1 signs in, then adopts the session, records that user with the form's choice, then clears the password", async () => {
    const { deps, calls } = fakeDeps({ session: SESSION, error: null });
    const result = await resumeAfterSurveySaveFailure(INPUT, deps);
    expect(calls).toEqual(["signIn", "adopt", "record", "clear"]);
    expect(deps.clearPassword).toHaveBeenCalledTimes(1);
    expect(deps.adoptSession).toHaveBeenCalledWith(SESSION);
    expect(deps.recordSignedInUser).toHaveBeenCalledWith("user_signed_in_1", false);
    expect(result).toEqual({ ok: true, message: RESAVE_PROMPT_MESSAGE });
  });

  it("S2 passes staySignedIn true through as well", async () => {
    const { deps } = fakeDeps({ session: SESSION, error: null });
    await resumeAfterSurveySaveFailure({ ...INPUT, staySignedIn: true }, deps);
    expect(deps.recordSignedInUser).toHaveBeenCalledWith("user_signed_in_1", true);
  });

  it("S3 signs in with exactly the given credentials", async () => {
    const { deps } = fakeDeps({ session: SESSION, error: null });
    await resumeAfterSurveySaveFailure(INPUT, deps);
    expect(deps.signIn).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "pw-123456",
    });
  });

  it("F1 a sign-in error adopts, records and clears nothing", async () => {
    const { deps, calls } = fakeDeps({
      session: null,
      error: { code: "invalid_credentials" },
    });
    const result = await resumeAfterSurveySaveFailure(INPUT, deps);
    expect(calls).toEqual(["signIn"]);
    expect(deps.adoptSession).not.toHaveBeenCalled();
    expect(deps.recordSignedInUser).not.toHaveBeenCalled();
    expect(deps.clearPassword).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, message: SIGN_IN_AFTER_SAVE_FAILURE_MESSAGE });
  });

  it("F2 no session without an error is still a failure", async () => {
    const { deps, calls } = fakeDeps({ session: null, error: null });
    const result = await resumeAfterSurveySaveFailure(INPUT, deps);
    expect(calls).toEqual(["signIn"]);
    expect(deps.clearPassword).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});

describe("staySignedInAfterSubmit", () => {
  it("K1 a resubmit after recovery keeps the choice recorded then, whatever else is true", () => {
    for (const formChoice of [true, false]) {
      expect(
        staySignedInAfterSubmit({ isAuthed: true, recoveredChoice: false, formChoice })
      ).toBe(false);
      expect(
        staySignedInAfterSubmit({ isAuthed: true, recoveredChoice: true, formChoice })
      ).toBe(true);
    }
  });

  it("K2 a signed-in arrival without recovery stays signed in, whatever the form says", () => {
    expect(
      staySignedInAfterSubmit({ isAuthed: true, recoveredChoice: null, formChoice: false })
    ).toBe(true);
    expect(
      staySignedInAfterSubmit({ isAuthed: true, recoveredChoice: null, formChoice: true })
    ).toBe(true);
  });

  it("K3 a new signup uses the form's choice", () => {
    expect(
      staySignedInAfterSubmit({ isAuthed: false, recoveredChoice: null, formChoice: false })
    ).toBe(false);
    expect(
      staySignedInAfterSubmit({ isAuthed: false, recoveredChoice: null, formChoice: true })
    ).toBe(true);
  });
});
