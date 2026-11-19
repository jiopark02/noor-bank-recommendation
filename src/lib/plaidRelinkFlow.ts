// =============================================================================
// What the browser does when the user asks to re-link a bank: whether the
// request for an update-mode link token is sent, which kind of notice a
// refusal becomes, and what is kept when Link closes. No React, no network and
// no Supabase client here: the hook and the Link button supply those, so every
// decision below runs in a test without a DOM.
//
// The request goes out only with a session's access token. Without one nothing
// is sent, so the route never sees a re-link request without an Authorization
// header.
//
// Nothing the server says is shown. Its status and its `errorType` /
// `errorCode` fields are compared with fixed values to choose a kind of
// notice; the sentence for each kind is in relinkNotice.ts.
// =============================================================================

import {
  linkTokenSession,
  readPlaidSession,
  type PlaidSessionDeps,
} from "@/lib/plaidConnectFlow";
import type { RelinkNoticeKind } from "@/lib/relinkNotice";

// The kinds of notice and their sentences live in relinkNotice.ts, which
// imports nothing; the types are passed on here for the callers of this flow.
export type { RelinkNotice, RelinkNoticeKind } from "@/lib/relinkNotice";

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
 * The one Plaid code read as "remove this bank and connect it again". Its
 * status is not consulted: which status Plaid sends with it on this call has
 * not been observed here.
 */
const TOKEN_REFUSED_CODE = "ITEM_NOT_FOUND";

function readText(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * What a refusal from the re-link route means.
 *
 * The Plaid code is read first, because the route answers some Plaid codes
 * with the same 401 it uses for a request it could not authenticate.
 *
 * token_refused tells the user to remove the bank and connect it again, so it
 * is given only for a code the removal can get past. Removing a bank revokes
 * its Item at Plaid first and keeps the bank when that fails; the one Plaid
 * rejection the removal accepts as "already gone" is ITEM_NOT_FOUND. A token
 * Plaid rejects as INVALID_ACCESS_TOKEN would be rejected by the removal too
 * and the bank would stay, so that code is not sent down that road: it is a
 * failed start like any other Plaid refusal. If the removal comes to accept
 * another code, that code can be read as token_refused here, and not before.
 * (The removal looks at more than the code, which the browser cannot see, so
 * even after this notice it can still answer "try again".)
 *
 * A 401 the route's Plaid error mapping left no mark on (`errorType` /
 * `errorCode`) is the route saying it did not authenticate the request. That
 * is not read as an ended session: the route answers the same way when the
 * auth server gave it no usable answer, and this request went out only after
 * the browser read a session. Only that read, in requestRelinkToken, says a
 * session has ended.
 *
 * A 404 is the bank no longer linked only when it carries no mark either: the
 * route's own 404 is the absent row, while a marked one is Plaid's status
 * passed through.
 */
export function classifyRelinkResponse(
  status: number,
  body: Record<string, unknown>
): RelinkNoticeKind {
  const errorCode = readText(body, "errorCode");
  if (errorCode === TOKEN_REFUSED_CODE) {
    return "token_refused";
  }
  // Anything else the Plaid error mapping marked is Plaid's refusal, under
  // whatever status it came (the mapping passes some of Plaid's own statuses
  // through). The two statuses read below are the route's own answers only.
  if (errorCode !== undefined || readText(body, "errorType") !== undefined) {
    return "start_failed";
  }
  if (status === 401) return "sign_in_unconfirmed";
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
 * "The session ended" is said here and nowhere else, and only for a read that
 * answered that there is none.
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

/**
 * Whether Link closed reporting an error, from the first argument of its exit
 * callback: an error object, or null when the user closed it.
 *
 * This is all that is kept of that callback's arguments. The value is compared
 * with null and no property of it is read, so nothing Link says about the
 * error, the bank or the session can reach a log, storage or a request from
 * here on: the rest of the app sees a boolean.
 */
export function linkExitedWithError(error: unknown): boolean {
  return error !== null && error !== undefined;
}
