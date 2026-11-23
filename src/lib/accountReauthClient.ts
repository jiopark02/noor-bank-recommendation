/**
 * The settings screen's email-code step for deleting the account and
 * exporting its data: how it reads /api/account/reauth/start and /verify
 * answers, which stage it is in, what a press does in each stage, and its
 * copy. The server decides; nothing here is trusted by the delete or export
 * route, which ask the database themselves. Nothing is written to browser
 * storage, and every function here is pure, so the transitions are tested by
 * execution (accountReauthClient.test.ts).
 *
 * STAGES
 *   idle      a press asks for a code (start). The server may answer that no
 *             code is required, and then the action runs in the same press.
 *   code      a code was sent; a press checks the typed code (verify) and, on
 *             success, runs the action in the same press. "Get a new code"
 *             asks for another one and stays here.
 *   verified  the code was accepted; a press runs the action without verify.
 *             The stage survives a failed action (a deletion that stopped
 *             part-way, say), so the retry goes straight to the action, and
 *             ends when the server answers that it needs a new verification.
 *   unconfirmed
 *             a verify request ended without a readable answer (the request
 *             failed, or its body could not be read), so the code may or may
 *             not have been accepted. The screen looks like the code stage. A
 *             press does not send the code again (a second verify of an
 *             accepted code is refused) but runs the action, and the action's
 *             own check on the server decides: it goes ahead, or it answers
 *             that a verification is required and the step returns to the
 *             code stage. Nothing is sent until the user presses.
 *
 * Closing the modal returns to idle from any stage (afterClose), and an
 * answer to a request sent before the close changes nothing
 * (answerStillCurrent).
 */

export type ReauthStep =
  | { kind: "not_required" }
  | { kind: "sent" }
  | { kind: "verified" }
  /** The code can no longer be used: the next press sends a new one. */
  | { kind: "restart"; message: string }
  | { kind: "error"; message: string }
  /** No readable answer: the request failed, or its body could not be read. */
  | { kind: "unknown" };

export const REAUTH_UI = {
  codeSent: "We emailed you a 6-digit code. Enter it below to continue.",
  newCodeSent: "We emailed you a new code. Use the newest one.",
  verified: "Code accepted. You can try again without a new code.",
  codeLabel: "Code from the email",
  newCode: "Get a new code",
  // The first press either sends a code or, when the server requires none,
  // runs the action at once; the screen cannot know which before it asks, so
  // the first-step words promise neither.
  start: "Continue",
  working: "Please wait…",
  deleting: "Deleting…",
  deleteConfirm: "Delete Account",
  sessionExpired: "Your session has expired. Please sign in again.",
  fallback: "Something went wrong. Please try again.",
  exportTitle: "Export your data?",
  exportBody: "To protect your data, we may email you a code to confirm it's you before the download starts.",
  exportConfirm: "Download",
  // For every failed export request, a failed answer or a network failure
  // once the request was sent: the export check may already have used the
  // verification up, so the next try starts with a new code.
  exportFailed: "Your data couldn't be exported. Request a new code and try again.",
  // A verify request ended without a readable answer.
  verifyUnknown: "Connection lost while checking your code. Press again to continue.",
  // After that, the action's check answered that a verification is required.
  codeUnconfirmed: "We couldn't confirm your code. Enter it again or request a new one.",
} as const;

/** Answers after which the code step starts over from idle. */
const RESTART_CODES = ["REAUTH_LOCKED", "REAUTH_REQUIRED", "REAUTH_SESSION_UNAVAILABLE"];

/**
 * An answer read as a step. `body` is undefined only when the body could not
 * be read (the page passes undefined for that and nothing else), which makes
 * the step unknown whatever the status.
 */
export function readReauthAnswer(status: number, body: unknown): ReauthStep {
  if (body === undefined) return { kind: "unknown" };
  const record =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (status === 200) {
    if (record.status === "not_required") return { kind: "not_required" };
    if (record.status === "sent") return { kind: "sent" };
    if (record.status === "verified") return { kind: "verified" };
    return { kind: "error", message: REAUTH_UI.fallback };
  }
  const message = typeof record.error === "string" && record.error.length > 0 ? record.error : REAUTH_UI.fallback;
  if (typeof record.code === "string" && RESTART_CODES.indexOf(record.code) !== -1) {
    return { kind: "restart", message };
  }
  return { kind: "error", message };
}

/** Whether a delete or export answer asks for a new verification. */
export function isReauthRequiredAnswer(status: number, body: unknown): boolean {
  if (status !== 403 || typeof body !== "object" || body === null) return false;
  const code = (body as Record<string, unknown>).code;
  return code === "REAUTH_REQUIRED" || code === "REAUTH_SESSION_UNAVAILABLE";
}

export type ReauthStage = "idle" | "code" | "verified" | "unconfirmed";

/** What one press of the action button does in a stage. */
export type ReauthPress = "start" | "verify" | "act";

export function pressAction(stage: ReauthStage): ReauthPress {
  if (stage === "idle") return "start";
  if (stage === "code") return "verify";
  // verified and unconfirmed: the action itself, with no verify.
  return "act";
}

/** Whether the screen shows the code field and "Get a new code". */
export function showsCodeEntry(stage: ReauthStage): boolean {
  return stage === "code" || stage === "unconfirmed";
}

/**
 * The screen after an answer: the next stage, whether the action runs now in
 * the same press, an error line, a notice line, and whether the typed code is
 * cleared.
 */
export type ReauthOutcome = {
  stage: ReauthStage;
  proceed: boolean;
  error: string | null;
  notice: string | null;
  clearCode: boolean;
};

function outcome(
  stage: ReauthStage,
  proceed: boolean,
  error: string | null = null,
  notice: string | null = null,
  clearCode = false
): ReauthOutcome {
  return { stage, proceed, error, notice, clearCode };
}

/**
 * After a start answer. From idle it is the press itself; from code or
 * unconfirmed it is "Get a new code", which never runs the action. A new code
 * sent moves either to the code stage; a refused one keeps the stage it was
 * asked from, so an unconfirmed code is not verified again.
 */
export function afterStart(
  from: "idle" | "code" | "unconfirmed",
  step: ReauthStep
): ReauthOutcome {
  if (from === "idle") {
    switch (step.kind) {
      case "sent":
        return outcome("code", false, null, REAUTH_UI.codeSent, true);
      case "not_required":
        return outcome("idle", true);
      case "restart":
      case "error":
        return outcome("idle", false, step.message);
      default:
        return outcome("idle", false, REAUTH_UI.fallback);
    }
  }
  switch (step.kind) {
    case "sent":
      return outcome("code", false, null, REAUTH_UI.newCodeSent, true);
    case "not_required":
      // Reauthentication was turned off meanwhile: the next press starts over
      // and will be answered not_required.
      return outcome("idle", false, null, null, true);
    case "restart":
    case "error":
      // A refused new code (the issue limit, a failed email) leaves the
      // earlier code usable: stay where the step was and say why.
      return outcome(from, false, step.message);
    default:
      return outcome(from, false, REAUTH_UI.fallback);
  }
}

/**
 * After a verify answer, made from the code stage. An unknown answer never
 * runs the action: it waits in unconfirmed for the user's next press, and the
 * typed code is kept.
 */
export function afterVerify(step: ReauthStep): ReauthOutcome {
  switch (step.kind) {
    case "verified":
    case "not_required":
      return outcome("verified", true, null, REAUTH_UI.verified, true);
    case "restart":
      return outcome("idle", false, step.message, null, true);
    case "error":
      return outcome("code", false, step.message);
    case "unknown":
      return outcome("unconfirmed", false, REAUTH_UI.verifyUnknown);
    default:
      return outcome("code", false, REAUTH_UI.fallback);
  }
}

function reauthRequiredCode(status: number, body: unknown): boolean {
  return (
    status === 403 &&
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).code === "REAUTH_REQUIRED"
  );
}

/**
 * The stage after the action's own answer failed. A refusal that asks for a
 * new verification starts over, except from unconfirmed, where REAUTH_REQUIRED
 * means the unconfirmed code was not accepted and the step goes back to the
 * code stage; anything else keeps the stage, so a retry of a deletion that
 * stopped part-way goes straight to the action.
 */
export function stageAfterFailedAction(
  stage: ReauthStage,
  status: number,
  body: unknown
): ReauthStage {
  if (stage === "unconfirmed" && reauthRequiredCode(status, body)) return "code";
  return isReauthRequiredAnswer(status, body) ? "idle" : stage;
}

/**
 * The whole screen after a failed action answer, for the one case that has
 * its own words: from unconfirmed, REAUTH_REQUIRED returns to the code stage
 * with REAUTH_UI.codeUnconfirmed and clears the typed code. Null otherwise;
 * the page then handles the answer as before.
 */
export function afterFailedAction(
  stage: ReauthStage,
  status: number,
  body: unknown
): ReauthOutcome | null {
  if (stage !== "unconfirmed" || !reauthRequiredCode(status, body)) return null;
  return outcome(stageAfterFailedAction(stage, status, body), false, REAUTH_UI.codeUnconfirmed, null, true);
}

/**
 * Closing the delete or export modal, by Cancel, the backdrop or the export
 * starting, while a request is in flight or not: the step starts over, with
 * no code, error or notice kept.
 */
export function afterClose(): ReauthOutcome {
  return outcome("idle", false, null, null, true);
}

/**
 * Whether an answer may still change the screen. Every close advances the
 * screen's counter; an answer to a request sent before the latest close is
 * dropped, so a request still in flight when the modal closed cannot put its
 * stage, code, error or notice back afterwards.
 */
export function answerStillCurrent(sentAtClose: number, closesNow: number): boolean {
  return sentAtClose === closesNow;
}

/** The delete button's words for the stage and the request in flight, if any. */
export function deleteButtonLabel(stage: ReauthStage, busy: ReauthPress | null): string {
  if (busy === "act") return REAUTH_UI.deleting;
  if (busy !== null) return REAUTH_UI.working;
  return stage === "idle" ? REAUTH_UI.start : REAUTH_UI.deleteConfirm;
}

/** The export button's words for the stage and the request in flight, if any. */
export function exportButtonLabel(stage: ReauthStage, busy: ReauthPress | null): string {
  if (busy !== null) return REAUTH_UI.working;
  return stage === "idle" ? REAUTH_UI.start : REAUTH_UI.exportConfirm;
}
