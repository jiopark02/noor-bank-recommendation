import { createHmac, hkdfSync, randomInt } from "crypto";
import { escapeHtml } from "@/lib/escapeHtml";
import type { BuiltEmail } from "@/lib/emailConfirmation";

/**
 * accountReauth — a one-time email code that confirms a recent sign-in before
 * the account is deleted or its data exported.
 *
 * The application makes the code, emails it to the confirmed address on the
 * verified token, and stores only a keyed hash of it through the functions of migration
 * 20261121130000_account_reauth_codes.sql (whether it is applied is live
 * state). The database decides: the issue limit, the attempt count, the
 * lifetime and whether a verification is recent are all answered by those
 * functions under a row lock, with the values below passed as arguments.
 *
 *   startReauth          issue a code and send it
 *   verifyReauth         check a code the user typed
 *   requireRecentReauth  the gate the delete and export routes call after
 *                        authentication and before anything else; a
 *                        verification for export is used up by the check
 *
 * Every failure to decide is closed: a check that cannot be made refuses the
 * action (503), and a code that cannot be hashed or stored is not sent.
 *
 * THE SESSION
 * A verification answers only for the sign-in session that made it. The
 * session is the session_id claim of the bearer token the route has just had
 * the auth server accept (sessionIdFromVerifiedToken); the claim is read from
 * that same string, never from the body. A token without a well-formed
 * session id gets 403 REAUTH_SESSION_UNAVAILABLE from verify and from the
 * gate, and no rpc is made.
 *
 * THE HASH KEY
 * The stored hash is an HMAC keyed by a key derived (HKDF-SHA256) from the
 * service-role key under the fixed label REAUTH_CODE_KEY_LABEL, which nothing
 * else derives from. A copy of the table alone (a backup, an export from the
 * database) therefore does not give back the codes. Without the service-role
 * key no key is derived, and no code is issued or checked.
 *
 * Nothing here writes to the console; lines go through the injected log and
 * carry the route, the outcome and an error code only: never the address, the
 * code, the key or the hash.
 */

export type AccountReauthMode = "off" | "enforce";

/**
 * ACCOUNT_REAUTH_MODE. Exactly "off" skips reauthentication; any other value,
 * unset and empty included, enforces. No trimming or case folding.
 */
export function resolveAccountReauthMode(raw: string | undefined): AccountReauthMode {
  return raw === "off" ? "off" : "enforce";
}

export type ReauthPurpose = "delete_account" | "export_data";

export const REAUTH_PURPOSES: readonly ReauthPurpose[] = ["delete_account", "export_data"];

export function parseReauthPurpose(value: unknown): ReauthPurpose | null {
  return value === "delete_account" || value === "export_data" ? value : null;
}

export const REAUTH_CODE_DIGITS = 6;
/** How long an issued code can be verified. */
export const REAUTH_CODE_TTL_SECONDS = 600;
/** Attempts counted against one code. */
export const REAUTH_MAX_ATTEMPTS = 5;
/** Codes one user may be issued inside one window. */
export const REAUTH_ISSUE_LIMIT = 5;
export const REAUTH_ISSUE_WINDOW_SECONDS = 3600;
/** How long a verification answers the gate. */
export const REAUTH_VERIFIED_WINDOW_SECONDS = 600;

/** Used only to derive the hash key; no other derivation uses this label. */
export const REAUTH_CODE_KEY_LABEL = "noor/account-reauth-code/hmac-sha256/v1";

/**
 * The hash key, derived from the service-role key, or null when there is no
 * usable service-role key.
 */
export function deriveReauthCodeKey(serviceRoleKey: string | undefined): Buffer | null {
  if (typeof serviceRoleKey !== "string" || serviceRoleKey.trim().length === 0) {
    return null;
  }
  const derived = hkdfSync(
    "sha256",
    Buffer.from(serviceRoleKey, "utf8"),
    Buffer.alloc(0),
    Buffer.from(REAUTH_CODE_KEY_LABEL, "utf8"),
    32
  );
  return Buffer.from(derived);
}

/** HMAC-SHA256 of "<purpose>:<user_id>:<code>", hex. */
export function hashReauthCode(
  key: Buffer,
  purpose: ReauthPurpose,
  userId: string,
  code: string
): string {
  return createHmac("sha256", key).update(`${purpose}:${userId}:${code}`, "utf8").digest("hex");
}

export function generateReauthCode(): string {
  const n = randomInt(0, Math.pow(10, REAUTH_CODE_DIGITS));
  return ("000000" + String(n)).slice(-REAUTH_CODE_DIGITS);
}

const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The session_id claim of a bearer token, or null when the token is not
 * three dot-separated parts, its payload is not JSON, or the claim is not a
 * lowercase UUID. Only call this on a token the auth server has just
 * accepted: the payload is trusted because that server verified this exact
 * string, not because of anything checked here.
 */
export function sessionIdFromVerifiedToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1].length === 0) return null;
  let payload: unknown;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { session_id?: unknown }).session_id;
  return typeof value === "string" && SESSION_ID_SHAPE.test(value) ? value : null;
}

const CODE_SHAPE = /^[0-9]{6}$/;

export function normalizeReauthCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return CODE_SHAPE.test(trimmed) ? trimmed : null;
}

export const REAUTH_CODES = {
  REAUTH_REQUIRED: "REAUTH_REQUIRED",
  REAUTH_CHECK_UNAVAILABLE: "REAUTH_CHECK_UNAVAILABLE",
  REAUTH_UNAVAILABLE: "REAUTH_UNAVAILABLE",
  REAUTH_BAD_REQUEST: "REAUTH_BAD_REQUEST",
  REAUTH_EMAIL_UNAVAILABLE: "REAUTH_EMAIL_UNAVAILABLE",
  REAUTH_RATE_LIMITED: "REAUTH_RATE_LIMITED",
  REAUTH_SEND_FAILED: "REAUTH_SEND_FAILED",
  REAUTH_CODE_INVALID: "REAUTH_CODE_INVALID",
  REAUTH_CODE_REJECTED: "REAUTH_CODE_REJECTED",
  REAUTH_LOCKED: "REAUTH_LOCKED",
  REAUTH_SESSION_UNAVAILABLE: "REAUTH_SESSION_UNAVAILABLE",
} as const;

export type ReauthCode = (typeof REAUTH_CODES)[keyof typeof REAUTH_CODES];

export const REAUTH_MESSAGES: Record<ReauthCode, string> = {
  REAUTH_REQUIRED: "Please confirm it's you with the code we email you, then try again.",
  REAUTH_CHECK_UNAVAILABLE: "We couldn't confirm it's you right now. Please try again in a moment.",
  REAUTH_UNAVAILABLE: "We couldn't send or check a code right now. Please try again in a moment.",
  REAUTH_BAD_REQUEST: "Something went wrong. Please try again.",
  REAUTH_EMAIL_UNAVAILABLE: "Your account has no confirmed email address we can send a code to.",
  REAUTH_RATE_LIMITED: "Too many codes requested. Please wait a while and try again.",
  REAUTH_SEND_FAILED: "We couldn't send the email. Please try again.",
  REAUTH_CODE_INVALID: "Enter the 6-digit code from the email.",
  REAUTH_CODE_REJECTED: "That code didn't work. Check it, or request a new one.",
  REAUTH_LOCKED: "Too many tries for this code. Request a new one.",
  REAUTH_SESSION_UNAVAILABLE: "Please sign out, sign in again, and then try again.",
};

export type ReauthResult = { status: number; body: Record<string, unknown> };

function refusal(status: number, code: ReauthCode): ReauthResult {
  return { status, body: { error: REAUTH_MESSAGES[code], code } };
}

export type ReauthRpc = (
  fn: "account_reauth_issue" | "account_reauth_verify" | "account_reauth_check",
  args: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: unknown }>;

export type ReauthLog = (line: string) => void;

const RPC_ERROR_CODE_SHAPE = /^[A-Z0-9]{1,16}$/;

/** An rpc error's code when it has the expected shape, else a fixed word. */
function rpcErrorCause(error: unknown): string {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && RPC_ERROR_CODE_SHAPE.test(code) ? code : "rpc_error";
}

type RpcAnswer = { ok: true; data: unknown } | { ok: false; cause: string };

async function callRpc(
  getRpc: () => ReauthRpc,
  fn: Parameters<ReauthRpc>[0],
  args: Record<string, unknown>
): Promise<RpcAnswer> {
  try {
    const { data, error } = await getRpc()(fn, args);
    if (error) return { ok: false, cause: rpcErrorCause(error) };
    return { ok: true, data };
  } catch {
    return { ok: false, cause: "throw" };
  }
}

/** The verified caller, from the token only. */
export type ReauthIdentity = {
  id: string;
  email: string | null;
  /** The token's session_id claim, or null when it has none in the expected form. */
  sessionId: string | null;
  /** Whether the auth server reports the address as confirmed. */
  emailConfirmed: boolean;
};

export type ReauthDeps = {
  mode: AccountReauthMode;
  /** The derived hash key, or null when it cannot be derived. */
  key: Buffer | null;
  /** The service-role rpc; may throw when the client cannot be built. */
  rpc: () => ReauthRpc;
  /** Sends the code; true only when the provider accepted the message. */
  sendCode: (to: string, email: BuiltEmail) => Promise<boolean>;
  log: ReauthLog;
  /** Injected for tests; generateReauthCode otherwise. */
  newCode?: () => string;
};

const PURPOSE_TEXT: Record<ReauthPurpose, string> = {
  delete_account: "delete your NOOR account",
  export_data: "download a copy of your NOOR data",
};

export const REAUTH_EMAIL_SUBJECT = "Your NOOR verification code";

/** The email carrying the code. It takes the code and the purpose only. */
export function buildReauthCodeEmail(code: string, purpose: ReauthPurpose): BuiltEmail {
  const safeCode = escapeHtml(code);
  const action = PURPOSE_TEXT[purpose];
  const minutes = Math.round(REAUTH_CODE_TTL_SECONDS / 60);
  const text =
    `Your NOOR verification code is ${code}.\n\n` +
    `Enter it in the app to ${action}. It expires in ${minutes} minutes.\n\n` +
    "If you didn't ask for this code, don't share it with anyone, and secure your account.";
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your verification code</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px;">
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; border-bottom: 1px solid #f0f0f0;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.3em; color: #000000;">NOOR</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
                Enter this code in the app to ${action}. It expires in ${minutes} minutes.
              </p>
              <p style="margin: 0 0 30px; font-size: 32px; font-weight: 600; letter-spacing: 0.3em; color: #000000; text-align: center;">${safeCode}</p>
              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #999999;">
                If you didn't ask for this code, don't share it with anyone, and secure your account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
  return { subject: REAUTH_EMAIL_SUBJECT, html, text };
}

/**
 * Issue a code for the purpose and email it. The stored row is written
 * before the email is sent, so a code that reaches the inbox is always one
 * the database knows.
 */
export async function startReauth(
  deps: ReauthDeps,
  identity: ReauthIdentity,
  purposeInput: unknown
): Promise<ReauthResult> {
  const purpose = parseReauthPurpose(purposeInput);
  if (purpose === null) {
    deps.log("[account-reauth] route=start outcome=bad_request");
    return refusal(400, REAUTH_CODES.REAUTH_BAD_REQUEST);
  }
  if (deps.mode === "off") {
    return { status: 200, body: { status: "not_required" } };
  }
  // A code goes only to an address the auth server reports as confirmed.
  const to = typeof identity.email === "string" ? identity.email.trim() : "";
  if (to.length === 0 || identity.emailConfirmed !== true) {
    deps.log("[account-reauth] route=start outcome=no_email");
    return refusal(409, REAUTH_CODES.REAUTH_EMAIL_UNAVAILABLE);
  }
  if (deps.key === null) {
    deps.log("[account-reauth] route=start outcome=unavailable cause=no_key");
    return refusal(503, REAUTH_CODES.REAUTH_UNAVAILABLE);
  }

  const code = (deps.newCode ?? generateReauthCode)();
  const answer = await callRpc(deps.rpc, "account_reauth_issue", {
    p_user_id: identity.id,
    p_purpose: purpose,
    p_code_hash: hashReauthCode(deps.key, purpose, identity.id, code),
    p_ttl_seconds: REAUTH_CODE_TTL_SECONDS,
    p_max_issues: REAUTH_ISSUE_LIMIT,
    p_window_seconds: REAUTH_ISSUE_WINDOW_SECONDS,
  });
  if (!answer.ok) {
    deps.log(`[account-reauth] route=start outcome=unavailable cause=${answer.cause}`);
    return refusal(503, REAUTH_CODES.REAUTH_UNAVAILABLE);
  }
  if (answer.data === "held") {
    deps.log("[account-reauth] route=start outcome=held");
    return refusal(429, REAUTH_CODES.REAUTH_RATE_LIMITED);
  }
  if (answer.data !== "issued") {
    deps.log("[account-reauth] route=start outcome=unavailable cause=bad_answer");
    return refusal(503, REAUTH_CODES.REAUTH_UNAVAILABLE);
  }

  let sent = false;
  try {
    sent = await deps.sendCode(to, buildReauthCodeEmail(code, purpose));
  } catch {
    sent = false;
  }
  if (!sent) {
    deps.log("[account-reauth] route=start outcome=send_failed");
    return refusal(502, REAUTH_CODES.REAUTH_SEND_FAILED);
  }
  deps.log("[account-reauth] route=start outcome=sent");
  return { status: 200, body: { status: "sent" } };
}

/** Check a code the user typed. */
export async function verifyReauth(
  deps: ReauthDeps,
  identity: ReauthIdentity,
  purposeInput: unknown,
  codeInput: unknown
): Promise<ReauthResult> {
  const purpose = parseReauthPurpose(purposeInput);
  if (purpose === null) {
    deps.log("[account-reauth] route=verify outcome=bad_request");
    return refusal(400, REAUTH_CODES.REAUTH_BAD_REQUEST);
  }
  if (deps.mode === "off") {
    return { status: 200, body: { status: "not_required" } };
  }
  const code = normalizeReauthCode(codeInput);
  if (code === null) {
    return refusal(400, REAUTH_CODES.REAUTH_CODE_INVALID);
  }
  if (identity.sessionId === null) {
    deps.log("[account-reauth] route=verify outcome=no_session");
    return refusal(403, REAUTH_CODES.REAUTH_SESSION_UNAVAILABLE);
  }
  if (deps.key === null) {
    deps.log("[account-reauth] route=verify outcome=unavailable cause=no_key");
    return refusal(503, REAUTH_CODES.REAUTH_UNAVAILABLE);
  }

  const answer = await callRpc(deps.rpc, "account_reauth_verify", {
    p_user_id: identity.id,
    p_purpose: purpose,
    p_code_hash: hashReauthCode(deps.key, purpose, identity.id, code),
    p_session_id: identity.sessionId,
    p_max_attempts: REAUTH_MAX_ATTEMPTS,
  });
  if (!answer.ok) {
    deps.log(`[account-reauth] route=verify outcome=unavailable cause=${answer.cause}`);
    return refusal(503, REAUTH_CODES.REAUTH_UNAVAILABLE);
  }
  switch (answer.data) {
    case "verified":
      deps.log("[account-reauth] route=verify outcome=verified");
      return { status: 200, body: { status: "verified" } };
    case "refused":
      deps.log("[account-reauth] route=verify outcome=refused");
      return refusal(403, REAUTH_CODES.REAUTH_CODE_REJECTED);
    case "locked":
      deps.log("[account-reauth] route=verify outcome=locked");
      return refusal(429, REAUTH_CODES.REAUTH_LOCKED);
    default:
      deps.log("[account-reauth] route=verify outcome=unavailable cause=bad_answer");
      return refusal(503, REAUTH_CODES.REAUTH_UNAVAILABLE);
  }
}

export type ReauthGateResult = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };

/**
 * The gate for an account action. Passes when the mode is off, or when the
 * database reports a verification for this purpose, made by this request's
 * session, inside the window. For export_data the check also uses the
 * verification up, so one verification answers one export; account deletion
 * only reads it, since a deletion that stops part-way is retried.
 */
export async function requireRecentReauth(
  deps: Pick<ReauthDeps, "mode" | "rpc" | "log">,
  caller: { userId: string; sessionId: string | null },
  purpose: ReauthPurpose
): Promise<ReauthGateResult> {
  if (deps.mode === "off") return { ok: true };
  if (caller.sessionId === null) {
    deps.log(`[account-reauth] route=gate purpose=${purpose} outcome=no_session`);
    return { ok: false, ...refusal(403, REAUTH_CODES.REAUTH_SESSION_UNAVAILABLE) };
  }
  const answer = await callRpc(deps.rpc, "account_reauth_check", {
    p_user_id: caller.userId,
    p_purpose: purpose,
    p_session_id: caller.sessionId,
    p_window_seconds: REAUTH_VERIFIED_WINDOW_SECONDS,
    p_consume: purpose === "export_data",
  });
  if (!answer.ok) {
    deps.log(`[account-reauth] route=gate purpose=${purpose} outcome=unavailable cause=${answer.cause}`);
    return { ok: false, ...refusal(503, REAUTH_CODES.REAUTH_CHECK_UNAVAILABLE) };
  }
  if (answer.data === true) return { ok: true };
  if (answer.data === false) {
    deps.log(`[account-reauth] route=gate purpose=${purpose} outcome=required`);
    return { ok: false, ...refusal(403, REAUTH_CODES.REAUTH_REQUIRED) };
  }
  deps.log(`[account-reauth] route=gate purpose=${purpose} outcome=unavailable cause=bad_answer`);
  return { ok: false, ...refusal(503, REAUTH_CODES.REAUTH_CHECK_UNAVAILABLE) };
}
