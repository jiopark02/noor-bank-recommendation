// =============================================================================
// The notice a bank's line shows when its re-link did not go through: the
// kinds there are, and the sentence for each.
//
// This file imports nothing, on purpose. The module that decides what the
// screens show from a finance summary reads its sentences from here, and that
// module is also loaded on the server; a file that reads the session, or
// imports one that does, must not come along with it. What decides the kind
// (the session read, the route's answer, Link's exit) lives in
// plaidRelinkFlow.ts.
//
// Nothing the server says is in a sentence. The only variable part is the
// bank's name as the screen already shows it.
// =============================================================================

/**
 * Why a re-link did not go through.
 *
 *   session_ended - there is no session, or the route did not accept it.
 *   token_refused - Plaid refused the stored token for this bank; asking again
 *                   cannot help, the bank has to be removed and connected anew.
 *   not_linked    - the user has no connection row for this bank any more.
 *   start_failed  - everything else before Link opened: worth another try.
 *   link_exit_error - Link opened and closed reporting an error.
 */
export type RelinkNoticeKind =
  | "session_ended"
  | "token_refused"
  | "not_linked"
  | "start_failed"
  | "link_exit_error";

/** A notice for one bank, shown on that bank's line only. */
export type RelinkNotice = { itemId: string; kind: RelinkNoticeKind };

/** The sentence for a notice, naming the bank where the sentence has a place for it. */
export function relinkNoticeMessage(
  kind: RelinkNoticeKind,
  institutionName: string
): string {
  switch (kind) {
    case "session_ended":
      return "Your session ended. Sign in again, then re-link this bank.";
    case "token_refused":
      return `We can't re-link ${institutionName}. Remove it under Accounts, then connect it again.`;
    case "not_linked":
      return "This bank is no longer linked. Refresh the page to see your current banks.";
    case "link_exit_error":
      return `We couldn't finish re-linking ${institutionName}. Please try again.`;
    default:
      return `We couldn't start re-linking ${institutionName}. Please try again in a moment.`;
  }
}
