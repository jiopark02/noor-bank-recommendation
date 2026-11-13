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

export type LinkTokenClaimRpc = (
  fn: "plaid_link_token_claim",
  args: { p_user_id: string; p_max_count: number; p_window_seconds: number }
) => PromiseLike<{ data: unknown; error: unknown }>;

export async function claimLinkTokenIssue(
  rpc: LinkTokenClaimRpc,
  userId: string
): Promise<LinkTokenClaim> {
  try {
    const { data, error } = await rpc("plaid_link_token_claim", {
      p_user_id: userId,
      p_max_count: LINK_TOKEN_ISSUE_LIMIT,
      p_window_seconds: LINK_TOKEN_ISSUE_WINDOW_SECONDS,
    });
    if (error) return "error";
    if (data === true) return "claimed";
    if (data === false) return "held";
    return "error";
  } catch {
    return "error";
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
