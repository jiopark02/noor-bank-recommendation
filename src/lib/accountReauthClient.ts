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
 */

export type ReauthStep =
  | { kind: "not_required" }
  | { kind: "sent" }
  | { kind: "verified" }
  /** The code can no longer be used: the next press sends a new one. */
  | { kind: "restart"; message: string }
  | { kind: "error"; message: string };

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
} as const;

/** Answers after which the code step starts over from idle. */
const RESTART_CODES = ["REAUTH_LOCKED", "REAUTH_REQUIRED", "REAUTH_SESSION_UNAVAILABLE"];

export function readReauthAnswer(status: number, body: unknown): ReauthStep {
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

export type ReauthStage = "idle" | "code" | "verified";

/** What one press of the action button does in a stage. */
export type ReauthPress = "start" | "verify" | "act";

export function pressAction(stage: ReauthStage): ReauthPress {
  if (stage === "idle") return "start";
  if (stage === "code") return "verify";
  return "act";
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
 * After a start answer. From idle it is the press itself; from code it is
 * "Get a new code", which never runs the action.
 */
export function afterStart(from: "idle" | "code", step: ReauthStep): ReauthOutcome {
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
      // earlier code usable: stay in code and say why.
      return outcome("code", false, step.message);
    default:
      return outcome("code", false, REAUTH_UI.fallback);
  }
}

/** After a verify answer, made from the code stage. */
export function afterVerify(step: ReauthStep): ReauthOutcome {
  switch (step.kind) {
    case "verified":
    case "not_required":
      return outcome("verified", true, null, REAUTH_UI.verified, true);
    case "restart":
      return outcome("idle", false, step.message, null, true);
    case "error":
      return outcome("code", false, step.message);
    default:
      return outcome("code", false, REAUTH_UI.fallback);
  }
}

/**
 * The stage after the action's own answer failed. A refusal that asks for a
 * new verification starts over; anything else keeps the stage, so a retry
 * of a deletion that stopped part-way goes straight to the action.
 */
export function stageAfterFailedAction(
  stage: ReauthStage,
  status: number,
  body: unknown
): ReauthStage {
  return isReauthRequiredAnswer(status, body) ? "idle" : stage;
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
