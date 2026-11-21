/**
 * The settings screen's reading of /api/account/reauth/start and /verify
 * answers, and its copy. The server decides; nothing read here is trusted by
 * the delete or export route, which ask the database themselves. Nothing is
 * written to browser storage.
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
  codeLabel: "Code from the email",
  // The first press either sends a code or, when the server requires none,
  // runs the action at once; the screen cannot know which before it asks, so
  // the first-step words promise neither.
  start: "Continue",
  working: "Please wait…",
  checking: "Checking…",
  sessionExpired: "Your session has expired. Please sign in again.",
  fallback: "Something went wrong. Please try again.",
  exportTitle: "Export your data?",
  exportBody: "To protect your data, we may email you a code to confirm it's you before the download starts.",
  exportConfirm: "Download",
} as const;

const RESTART_CODES = ["REAUTH_LOCKED", "REAUTH_REQUIRED"];

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

/** Whether a delete or export answer asks for a new code. */
export function isReauthRequiredAnswer(status: number, body: unknown): boolean {
  return (
    status === 403 &&
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).code === "REAUTH_REQUIRED"
  );
}
