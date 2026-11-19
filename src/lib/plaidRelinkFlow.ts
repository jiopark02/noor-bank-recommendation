// =============================================================================
// What the browser does when the user asks to re-link a bank: whether the
// request for an update-mode link token is sent, and which sentence a refusal
// becomes. No React, no network and no Supabase client here: the hook supplies
// those, so every decision below runs in a test without a DOM.
//
// The request goes out only with a session's access token. Without one nothing
// is sent, so the route never sees a re-link request without an Authorization
// header.
//
// Nothing the server says is shown. Its status and its `errorType` /
// `errorCode` fields are compared with fixed values to choose one of the
// sentences below, and the only variable part of a sentence is the bank's name
// as the screen already shows it.
// =============================================================================

import {
  linkTokenSession,
  readPlaidSession,
  type PlaidSessionDeps,
} from "@/lib/plaidConnectFlow";

/**
 * Why a re-link did not go through.
 *
 *   session_ended - there is no session, or the route did not accept it.
 *   token_refused - Plaid refused the stored token for this bank; asking again
 *                   cannot help, the bank has to be removed and connected anew.
 *   not_linked    - the user has no connection row for this bank any more.
 *   start_failed  - everything else: worth another try.
 */
export type RelinkNoticeKind =
  | "session_ended"
  | "token_refused"
  | "not_linked"
  | "start_failed";

/** A notice for one bank, shown on that bank's line only. */
export type RelinkNotice = { itemId: string; kind: RelinkNoticeKind };

export type RelinkTokenResult =
  | { ok: true; token: string }
  | { ok: false; kind: RelinkNoticeKind };

/** What the re-link route answered: its status and its parsed body. */
export type RelinkResponse = {
  status: number;
  body: Record<string, unknown>;
};

export type RelinkDeps = PlaidSessionDeps & {
  /**
   * Sends the re-link request with this access token. Resolves with whatever
   * came back; rejects when nothing came back, or nothing readable.
   */
  post: (accessToken: string, itemId: string) => Promise<RelinkResponse>;
};

/**
 * The Plaid codes that mean the stored token no longer names an Item this app
 * can use. Which of them Plaid sends for a removed Item, and with which
 * status, has not been observed here, so both are read the same way and the
 * status is not consulted.
 */
const TOKEN_REFUSED_CODES = ["INVALID_ACCESS_TOKEN", "ITEM_NOT_FOUND"];

function readText(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * What a refusal from the re-link route means.
 *
 * The Plaid code is read first, because the route answers one of those codes
 * with the same 401 it uses for a request it could not authenticate. A 401 is
 * about the session only when the route's Plaid error mapping left no mark on
 * it (`errorType` / `errorCode`).
 */
export function classifyRelinkResponse(
  status: number,
  body: Record<string, unknown>
): RelinkNoticeKind {
  const errorCode = readText(body, "errorCode");
  if (errorCode !== undefined && TOKEN_REFUSED_CODES.indexOf(errorCode) !== -1) {
    return "token_refused";
  }
  if (
    status === 401 &&
    errorCode === undefined &&
    readText(body, "errorType") === undefined
  ) {
    return "session_ended";
  }
  if (status === 404) return "not_linked";
  return "start_failed";
}

/**
 * Asks for a link token to re-link one bank. Never throws: every failure comes
 * back as the kind of notice to show.
 *
 * The session is read until it answers, and the request is made only with its
 * access token. A read that gave no answer is not "the session ended" — a
 * valid session can produce it — so it is a failed start, and nothing is sent.
 */
export async function requestRelinkToken(
  deps: RelinkDeps,
  itemId: string
): Promise<RelinkTokenResult> {
  try {
    const read = await readPlaidSession(deps);
    if (read.status === "none") {
      return { ok: false, kind: "session_ended" };
    }
    // The same gate a new connection's request passes: a token, or nothing
    // is sent. Its sentence is for a new connection and is not used here.
    const session = linkTokenSession(read);
    if (!session.ok) {
      return { ok: false, kind: "start_failed" };
    }

    const response = await deps.post(session.accessToken, itemId);
    if (response.status >= 200 && response.status < 300) {
      const token = readText(response.body, "linkToken");
      return token ? { ok: true, token } : { ok: false, kind: "start_failed" };
    }
    return { ok: false, kind: classifyRelinkResponse(response.status, response.body) };
  } catch {
    return { ok: false, kind: "start_failed" };
  }
}

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
    default:
      return `We couldn't start re-linking ${institutionName}. Please try again in a moment.`;
  }
}
