/**
 * confirmationSendLimit — asks the database whether a signup confirmation
 * email may go out to this user now, through email_confirmation_claim
 * (migration 20261104120000_email_confirmation_sends.sql). A claim that passes
 * is recorded by the same call, so a caller sends only on "claimed".
 *
 *   claimed  the function answered true: send.
 *   held     the function answered false: inside the 60-second gap or over
 *            the 24-hour count. Do not send.
 *   error    anything else (an error, a throw, an answer that is not a
 *            boolean). Fail-closed: do not send. A missing function lands
 *            here, which is why the migration is applied before the callers
 *            are deployed.
 *
 * The rpc is injected so this module holds no client. It never logs; the
 * caller logs the outcome with its own context.
 */

export type ConfirmationClaim = "claimed" | "held" | "error";

export type ConfirmationClaimRpc = (
  fn: "email_confirmation_claim",
  args: { p_user_id: string }
) => PromiseLike<{ data: unknown; error: unknown }>;

export async function claimConfirmationSend(
  rpc: ConfirmationClaimRpc,
  userId: string
): Promise<ConfirmationClaim> {
  try {
    const { data, error } = await rpc("email_confirmation_claim", {
      p_user_id: userId,
    });
    if (error) return "error";
    if (data === true) return "claimed";
    if (data === false) return "held";
    return "error";
  } catch {
    return "error";
  }
}
