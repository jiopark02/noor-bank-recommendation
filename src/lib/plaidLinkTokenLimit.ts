/**
 * plaidLinkTokenLimit — asks the database whether a link token for a new bank
 * connection may be issued to this user now, through plaid_link_token_claim
 * (migration 20261113120000_plaid_link_token_issues.sql). A claim that passes
 * is recorded by the same call, so the caller asks Plaid only on "claimed".
 *
 *   claimed  the function answered true: issue.
 *   held     the function answered false: the user is over the limit for the
 *            current window. Do not issue.
 *   error    anything else (an error, a throw, an answer that is not a
 *            boolean). Fail-closed: do not issue. A missing function lands
 *            here, which is why the migration is applied before the caller is
 *            deployed.
 *
 * What counts is an issue that passed the claim: one that Plaid then refuses
 * still counts. Re-link tokens (/api/plaid/relink) are not claimed here.
 *
 * An "error" outcome carries its cause, for the caller's log line:
 *   <code>      the rpc answered an error whose code is 1-16 upper-case letters
 *               or digits (a SQLSTATE or PostgREST code), copied as is
 *   rpc_error   the rpc answered an error with any other code, or none
 *   throw       the rpc call threw (a client that cannot be built lands here)
 *   bad_answer  no error, but the answer is not a boolean
 * The error's message, details and hint are never read: they can carry
 * values. The code is copied only in that shape, so it cannot bring text into
 * the log, and it cannot collide with the lower-case labels.
 *
 * The rpc is injected so this module holds no client. It never logs; the
 * caller logs the outcome with its own context.
 */

/**
 * Most new-connection link tokens one user may be issued inside one window.
 * Unvalidated default: not yet checked against real use.
 */
export const LINK_TOKEN_ISSUE_LIMIT = 10;

/**
 * The window's length, in seconds (24 hours). It starts at the first issue
 * inside it. Unvalidated default: not yet checked against real use.
 */
export const LINK_TOKEN_ISSUE_WINDOW_SECONDS = 86_400;

export type LinkTokenLimitMode = "off" | "enforce";

/**
 * PLAID_LINK_TOKEN_LIMIT_MODE. Exactly "off" skips the claim; any other value,
 * unset included, enforces. No trimming or case folding.
 */
export function resolveLinkTokenLimitMode(
  raw: string | undefined
): LinkTokenLimitMode {
  return raw === "off" ? "off" : "enforce";
}

export type LinkTokenClaim = "claimed" | "held" | "error";

export type LinkTokenClaimResult =
  | { claim: "claimed" }
  | { claim: "held" }
  | { claim: "error"; cause: string };

export type LinkTokenClaimRpc = (
  fn: "plaid_link_token_claim",
  args: { p_user_id: string; p_max_count: number; p_window_seconds: number }
) => PromiseLike<{ data: unknown; error: unknown }>;

const RPC_ERROR_CODE_SHAPE = /^[A-Z0-9]{1,16}$/;

/** The cause for an rpc error: its code when it has the safe shape. */
function rpcErrorCause(error: unknown): string {
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && RPC_ERROR_CODE_SHAPE.test(code)
    ? code
    : "rpc_error";
}

export async function claimLinkTokenIssue(
  rpc: LinkTokenClaimRpc,
  userId: string
): Promise<LinkTokenClaimResult> {
  let answer: { data: unknown; error: unknown };
  try {
    answer = await rpc("plaid_link_token_claim", {
      p_user_id: userId,
      p_max_count: LINK_TOKEN_ISSUE_LIMIT,
      p_window_seconds: LINK_TOKEN_ISSUE_WINDOW_SECONDS,
    });
  } catch {
    return { claim: "error", cause: "throw" };
  }
  try {
    const { data, error } = answer;
    if (error) return { claim: "error", cause: rpcErrorCause(error) };
    if (data === true) return { claim: "claimed" };
    if (data === false) return { claim: "held" };
    return { claim: "error", cause: "bad_answer" };
  } catch {
    // An answer that is not an object at all (or throws when read).
    return { claim: "error", cause: "bad_answer" };
  }
}

export const LINK_TOKEN_LIMIT_CODE = "LINK_TOKEN_LIMIT_REACHED";
export const LINK_TOKEN_CHECK_CODE = "LINK_TOKEN_CHECK_UNAVAILABLE";

const LINK_TOKEN_LIMIT_MESSAGE =
  "You've tried to connect a bank too many times in the last 24 hours. Please try again later.";
const LINK_TOKEN_CHECK_MESSAGE =
  "Bank connections aren't available right now. Please try again later.";

/** The response for a claim that did not pass, or null to go on and issue. */
export function linkTokenClaimRefusal(
  claim: LinkTokenClaim
): { status: 429 | 503; body: { error: string; code: string } } | null {
  if (claim === "claimed") return null;
  if (claim === "held") {
    return {
      status: 429,
      body: { error: LINK_TOKEN_LIMIT_MESSAGE, code: LINK_TOKEN_LIMIT_CODE },
    };
  }
  return {
    status: 503,
    body: { error: LINK_TOKEN_CHECK_MESSAGE, code: LINK_TOKEN_CHECK_CODE },
  };
}
