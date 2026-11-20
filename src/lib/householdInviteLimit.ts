/**
 * householdInviteLimit — asks the database whether this user may create
 * another household invite now, through household_invite_claim (migration
 * 20261120120000_household_invites_and_membership_changes.sql; whether it is
 * applied is live state). A claim that passes is recorded by the same call.
 *
 *   claimed  the function answered true: go on and create the invite.
 *   held     the function answered false: over the limit for the window.
 *   error    anything else (an error, a throw, an answer that is not a
 *            boolean). Fail-closed: no invite is created.
 *
 * An "error" outcome carries its cause for the caller's log line: the rpc
 * error's code when it is 1-16 upper-case letters or digits, otherwise
 * rpc_error, throw or bad_answer. The error's message is never read.
 *
 * The rpc is injected so this module holds no client, and it never logs.
 */

/** Most invites one user may create inside one window. */
export const HOUSEHOLD_INVITE_LIMIT = 10;

/** The window's length in seconds (24 hours), from its first claim. */
export const HOUSEHOLD_INVITE_WINDOW_SECONDS = 86_400;

export type HouseholdInviteLimitMode = "off" | "enforce";

/**
 * HOUSEHOLD_INVITE_LIMIT_MODE. Exactly "off" skips the claim; any other
 * value, unset included, enforces. No trimming or case folding.
 */
export function resolveHouseholdInviteLimitMode(
  raw: string | undefined
): HouseholdInviteLimitMode {
  return raw === "off" ? "off" : "enforce";
}

export type HouseholdInviteClaimResult =
  | { claim: "claimed" }
  | { claim: "held" }
  | { claim: "error"; cause: string };

export type HouseholdInviteClaimRpc = (
  fn: "household_invite_claim",
  args: { p_user_id: string; p_max_count: number; p_window_seconds: number }
) => PromiseLike<{ data: unknown; error: unknown }>;

const RPC_ERROR_CODE_SHAPE = /^[A-Z0-9]{1,16}$/;

function rpcErrorCause(error: unknown): string {
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && RPC_ERROR_CODE_SHAPE.test(code)
    ? code
    : "rpc_error";
}

export async function claimHouseholdInvite(
  rpc: HouseholdInviteClaimRpc,
  userId: string
): Promise<HouseholdInviteClaimResult> {
  let answer: { data: unknown; error: unknown };
  try {
    answer = await rpc("household_invite_claim", {
      p_user_id: userId,
      p_max_count: HOUSEHOLD_INVITE_LIMIT,
      p_window_seconds: HOUSEHOLD_INVITE_WINDOW_SECONDS,
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
    return { claim: "error", cause: "bad_answer" };
  }
}
