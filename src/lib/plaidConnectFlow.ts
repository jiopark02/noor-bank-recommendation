// =============================================================================
// What the browser does between Plaid Link succeeding and the bank being
// connected. No React, no network and no Supabase client here: the screen
// supplies those, so every decision below runs in a test without a DOM.
//
// Link hands the browser a public token once, and the Item already exists at
// Plaid by then. The token is good for a short time and for one exchange. So
// it is held in memory until the exchange is known to have ended one way or
// the other, and it is only ever sent with a session's access token.
//
// The token never leaves this module except as the body of the exchange
// request: it is not logged, not stored, and not part of any outcome.
// =============================================================================

import type { SessionReadResult } from "@/lib/supabase-browser";
import {
  retryUntilAnswered,
  shouldRetrySessionRead,
  type RetryPlan,
} from "@/lib/sessionFlow";

/**
 * The session reads made before a bank-connection request, about ten seconds
 * in all. Each read keeps the budget a session read has everywhere else: reads
 * queue behind the same token refresh inside auth-js, so a shorter one would
 * only give up on the same work sooner. A refresh can outlast this plan; the
 * held token and the "Try again" button cover that. Unvalidated defaults.
 */
export const PLAID_CONNECT_SESSION_RETRY: RetryPlan = {
  timeoutsMs: [3000, 3000, 3000],
  gapsMs: [500, 500],
};

/**
 * How long a public token is kept. Plaid's own limit is thirty minutes; the
 * margin leaves room for the request that carries it.
 */
export const PUBLIC_TOKEN_MAX_AGE_MS = 25 * 60 * 1000;

export const EXCHANGE_RETRY_MESSAGE =
  "We couldn't finish connecting your bank. Try again.";
export const SESSION_ENDED_MESSAGE =
  "Your session ended. Sign in again, then connect your bank.";
export const CONNECTION_TIMED_OUT_MESSAGE =
  "This connection timed out. Connect your bank again.";
/** For a refusal the server sent no sentence with. */
export const EXCHANGE_FALLBACK_MESSAGE =
  "We couldn't connect your bank. Please try again.";
export const EXCHANGE_IN_PROGRESS_LABEL = "Connecting your bank…";
/** A link token was not asked for, or was refused, over the sign-in. */
export const LINK_SIGN_IN_UNCONFIRMED_MESSAGE =
  "We couldn't confirm your sign-in. Try again.";

export type PlaidSessionDeps = {
  readSession: (timeoutMs: number, attempt: number) => Promise<SessionReadResult>;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Reads the session until it answers ("session" or "none") or the plan runs
 * out. A client that is not configured is not asked again.
 */
export function readPlaidSession(deps: PlaidSessionDeps): Promise<SessionReadResult> {
  return retryUntilAnswered(
    deps.readSession,
    shouldRetrySessionRead,
    PLAID_CONNECT_SESSION_RETRY,
    { sleep: deps.sleep, isCancelled: () => false }
  );
}

/**
 * The access token to send, or the sentence to show instead. Without a token
 * no request is made: a bank-connection request never goes out without an
 * Authorization header.
 */
export function linkTokenSession(
  read: SessionReadResult
): { ok: true; accessToken: string } | { ok: false; message: string } {
  if (read.status === "none") {
    return { ok: false, message: SESSION_ENDED_MESSAGE };
  }
  if (read.status !== "session" || !read.session.access_token) {
    return { ok: false, message: LINK_SIGN_IN_UNCONFIRMED_MESSAGE };
  }
  return { ok: true, accessToken: read.session.access_token };
}

function readText(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Whether a response is the route saying it could not authenticate the
 * request: a 401 that is not a mapped Plaid error (those carry `errorType`),
 * or a 503 that says the auth server could not be reached.
 */
function isAuthRefusal(status: number, body: Record<string, unknown>): boolean {
  if (readText(body, "errorType") !== undefined) return false;
  if (status === 401) return true;
  return status === 503 && readText(body, "code") === "AUTH_UNAVAILABLE";
}

/**
 * The sentence for a link-token refusal that is about the sign-in, so the
 * route's own "Unauthorized" is not what the button shows. null for every
 * other response: the caller keeps the route's sentence.
 */
export function linkTokenRefusalMessage(
  status: number,
  body: Record<string, unknown>
): string | null {
  return isAuthRefusal(status, body) ? LINK_SIGN_IN_UNCONFIRMED_MESSAGE : null;
}

export type ExchangeResponseKind =
  | "connected"
  | "duplicate"
  | "resendable"
  | "plaid_refused"
  | "refused";

/** The 503s the exchange route sends before it authenticates the request. */
const GATE_CODES = ["ADMIN_UNCONFIGURED", "AUTH_UNAVAILABLE"];

/**
 * What the exchange route's answer means for the held token.
 *
 * "resendable" is only an answer sent before the route did anything with the
 * token: a 401 from authentication, or a 503 from one of the checks in front
 * of it (those carry one of two codes, or no code at all when Plaid is not
 * configured). The route also sends 401 for a mapped Plaid error and 503 for
 * failures after the exchange; the first carries `errorType` and the second a
 * code of its own, and neither is resendable.
 *
 * "plaid_refused" is an answer that came through the route's Plaid error
 * mapping, which marks it with `errorType`. Which code and status Plaid uses
 * for a token that was already exchanged is not something this repo can read,
 * so the decision rests on that mark alone.
 */
export function classifyExchangeResponse(
  status: number,
  body: Record<string, unknown>
): ExchangeResponseKind {
  const code = readText(body, "code");
  if (status === 409 || code === "ALREADY_CONNECTED") return "duplicate";
  if (body.success === true) {
    return readText(body, "itemId") ? "connected" : "refused";
  }
  if (readText(body, "errorType") !== undefined) return "plaid_refused";
  if (status === 401) return "resendable";
  if (status === 503 && (code === undefined || GATE_CODES.indexOf(code) !== -1)) {
    return "resendable";
  }
  return "refused";
}

/** What the exchange request came back with. */
export type ExchangeResponse = {
  status: number;
  /** The parsed body, or an empty object when it could not be read. */
  body: Record<string, unknown>;
  /** False when the body did not arrive or was not JSON. */
  bodyRead: boolean;
};

/**
 * Whether a response leaves the exchange's outcome unknown, the same way no
 * response at all does.
 *
 * A success whose body could not be read says nothing usable. A 5xx is the
 * route's own answer only when it carries the route's `error` sentence, which
 * every failure the route writes does. Without it — a body that could not be
 * read, or JSON of another shape — a gateway or the platform is speaking, and
 * the route may have finished the exchange behind it. Such a response must
 * neither end the token nor let it be sent again unchecked.
 *
 * A 4xx stays an answer, with or without a body: the request was turned away,
 * so the usual reading of its status applies.
 */
export function isOutcomeUnknown(response: ExchangeResponse): boolean {
  const { status } = response;
  if (status >= 500) {
    return !response.bodyRead || typeof response.body.error !== "string";
  }
  return !response.bodyRead && status >= 200 && status < 300;
}

export type LinkInstitution = { name: string; institution_id: string };

export type ExchangePayload = {
  publicToken: string;
  institutionId: string;
  institutionName: string;
};

/**
 * The fields of a connection-list row this module reads. Both are fields the
 * list route (GET /api/plaid/connections) sends for every row. The list
 * carries no institution id, so a row is never matched to a bank by one.
 */
export type ConnectionSummary = {
  itemId?: string | null;
  status?: string;
};

/**
 * The rows of a connection-list response body, or null when the body is not a
 * list. This is the only place a list response is read for the exchange, so a
 * test can hand it what the list route really answers.
 */
export function readConnectionList(body: unknown): ConnectionSummary[] | null {
  if (typeof body !== "object" || body === null) return null;
  const rows = (body as Record<string, unknown>).connections;
  if (!Array.isArray(rows)) return null;
  const list: ConnectionSummary[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row: unknown = rows[i];
    const fields: Record<string, unknown> =
      typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
    list.push({
      itemId: typeof fields.itemId === "string" ? fields.itemId : null,
      status: typeof fields.status === "string" ? fields.status : undefined,
    });
  }
  return list;
}

/**
 * The Item ids of the active rows in a connection list. Recorded when a token
 * is held, so a later list read can tell a connection that appeared from the
 * ones that were already there.
 */
export function activeItemIds(
  connections: ReadonlyArray<ConnectionSummary>
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < connections.length; i++) {
    const row = connections[i];
    if (row.status === "active" && typeof row.itemId === "string" && row.itemId) {
      ids.push(row.itemId);
    }
  }
  return ids;
}

export type ExchangeDeps = PlaidSessionDeps & {
  now: () => number;
  /**
   * Sends the exchange request with this access token. Resolves with whatever
   * came back, saying whether its body could be read; rejects when nothing
   * came back at all.
   */
  post: (accessToken: string, payload: ExchangePayload) => Promise<ExchangeResponse>;
  /** The user's connection list; null (or a rejection) when it could not be read. */
  readConnections: (accessToken: string) => Promise<ConnectionSummary[] | null>;
};

export type ExchangeOutcome =
  /** Nothing is held, so nothing was done. */
  | { kind: "idle" }
  /** The token this attempt was sending has been replaced by a newer one. */
  | { kind: "superseded" }
  | { kind: "connected" }
  /** `canRetry` is true exactly when the token is still held. */
  | { kind: "notice"; message: string; canRetry: boolean };

type HeldToken = {
  publicToken: string;
  institution: LinkInstitution;
  /** The user the token belongs to; null until the first session read names one. */
  userId: string | null;
  receivedAt: number;
  /** The Item ids of the connections that were active when the token was received. */
  activeAtHold: string[];
  /** An earlier send of this token ended with no response. */
  noResponse: boolean;
};

export type PublicTokenHolder = {
  /**
   * Keeps a token Link just handed over, replacing any held before it.
   * `userId` is the signed-in user the screen knows, or null when it knows
   * none: the token is then bound to the user of the first session read.
   * `activeAtHold` is the Item ids of the user's active connections as the
   * screen knows them now (activeItemIds of its list); it is copied.
   */
  hold: (
    publicToken: string,
    institution: LinkInstitution,
    userId: string | null,
    activeAtHold: ReadonlyArray<string>
  ) => void;
  /** Sends the held token, or decides it must not be sent. Never throws. */
  send: () => Promise<ExchangeOutcome>;
  hasToken: () => boolean;
  clear: () => void;
};

function retry(): ExchangeOutcome {
  return { kind: "notice", message: EXCHANGE_RETRY_MESSAGE, canRetry: true };
}

function final(message: string): ExchangeOutcome {
  return { kind: "notice", message, canRetry: false };
}

function alreadyConnected(name: string | undefined, held: HeldToken): ExchangeOutcome {
  return final(`${name || held.institution.name || "This bank"} is already connected.`);
}

export function createPublicTokenHolder(deps: ExchangeDeps): PublicTokenHolder {
  let current: HeldToken | null = null;
  let inFlight: Promise<ExchangeOutcome> | null = null;

  // Item ids this holder knows were connected by a token it held: named in a
  // success answer, or found by a list read. The screen's list can lag behind
  // them (its reload may still be running, or may have failed), and such an
  // Item must not be read as the work of a later token.
  const connectedHere: string[] = [];
  const remember = (itemId: string): void => {
    if (connectedHere.indexOf(itemId) === -1) connectedHere.push(itemId);
  };

  /**
   * Whether this token's exchange is known to have connected a bank, judged
   * from the connection list.
   *
   * Yes only when the list now has an active Item that was not active when
   * the token was received and that no other token of this holder connected.
   * Everything else is "not known": a list that cannot be read, a list with
   * nothing new, and a bank that was already connected then. That bank's
   * exchange makes no new row, so the route's own duplicate answer is what
   * ends the token when it is sent again.
   *
   * The comparison is with the screen's list as it was at that moment. Two
   * connections this token did not make would be read as its own, and
   * nothing here can see either: one made elsewhere (another tab or device)
   * after the screen last read its list, and the Item of an earlier token of
   * this holder whose send got no answer and which was replaced by a new Link
   * instead of being sent again, when the server stores that Item only after
   * this token was received and this token's own outcome is unknown too.
   */
  async function sawNewConnection(held: HeldToken, accessToken: string): Promise<boolean> {
    let list: ConnectionSummary[] | null;
    try {
      list = await deps.readConnections(accessToken);
    } catch {
      list = null;
    }
    if (!list) return false;
    const fresh: string[] = [];
    const active = activeItemIds(list);
    for (let i = 0; i < active.length; i++) {
      const itemId = active[i];
      if (held.activeAtHold.indexOf(itemId) === -1 && connectedHere.indexOf(itemId) === -1) {
        fresh.push(itemId);
      }
    }
    // Only for the token still held: one replaced meanwhile claims nothing.
    if (current === held) fresh.forEach(remember);
    return fresh.length > 0;
  }

  async function run(held: HeldToken): Promise<ExchangeOutcome> {
    const drop = (): void => {
      if (current === held) current = null;
    };
    const superseded = (): boolean => current !== held;

    // The age limit comes first and applies to every send, a pressed
    // "Try again" included.
    if (deps.now() - held.receivedAt > PUBLIC_TOKEN_MAX_AGE_MS) {
      drop();
      return final(CONNECTION_TIMED_OUT_MESSAGE);
    }

    const read = await readPlaidSession(deps);
    if (superseded()) return { kind: "superseded" };
    if (read.status === "none") {
      drop();
      return final(SESSION_ENDED_MESSAGE);
    }
    // No session in hand: nothing is sent, and the token stays for a retry.
    if (read.status !== "session" || !read.session.access_token) {
      return retry();
    }

    // The token belongs to the user who went through Link. A different user
    // in the session now (a shared device) must not receive that bank.
    const sessionUserId = read.session.user.id;
    if (held.userId === null) {
      held.userId = sessionUserId;
    } else if (held.userId !== sessionUserId) {
      drop();
      return final(CONNECTION_TIMED_OUT_MESSAGE);
    }
    const accessToken = read.session.access_token;

    // An earlier send got no response, so the server may have finished the
    // exchange. Look before sending the same token again.
    if (held.noResponse) {
      const connected = await sawNewConnection(held, accessToken);
      if (superseded()) return { kind: "superseded" };
      if (connected) {
        drop();
        return { kind: "connected" };
      }
    }

    let response: ExchangeResponse | null;
    try {
      response = await deps.post(accessToken, {
        publicToken: held.publicToken,
        institutionId: held.institution.institution_id,
        institutionName: held.institution.name,
      });
    } catch {
      response = null;
    }
    // An Item the route says it connected is remembered even when its token
    // was replaced while the request ran: it is not a later token's work.
    if (response !== null && response.body.success === true) {
      const itemId = readText(response.body, "itemId");
      if (itemId) remember(itemId);
    }
    if (superseded()) return { kind: "superseded" };

    if (response === null || isOutcomeUnknown(response)) {
      // No response, or one that does not say how the exchange ended. The
      // request is not sent again from here: the server may have completed
      // it. The connection list is what can tell.
      held.noResponse = true;
      const connected = await sawNewConnection(held, accessToken);
      if (superseded()) return { kind: "superseded" };
      if (connected) {
        drop();
        return { kind: "connected" };
      }
      return retry();
    }

    const kind = classifyExchangeResponse(response.status, response.body);

    if (kind === "connected") {
      drop();
      return { kind: "connected" };
    }
    if (kind === "duplicate") {
      drop();
      return alreadyConnected(readText(response.body, "institutionName"), held);
    }
    if (kind === "resendable") {
      // The route's own wording ("Unauthorized") is not shown.
      return retry();
    }
    if (kind === "plaid_refused" && held.noResponse) {
      // Plaid refused a token that an earlier, unanswered request may already
      // have spent. The list decides; Plaid's wording is not shown.
      const connected = await sawNewConnection(held, accessToken);
      if (superseded()) return { kind: "superseded" };
      drop();
      return connected ? { kind: "connected" } : final(CONNECTION_TIMED_OUT_MESSAGE);
    }

    // Every other answer ends this token. The server's sentence is kept: it
    // already tells the connection limit from a failure worth another try.
    drop();
    return final(readText(response.body, "error") || EXCHANGE_FALLBACK_MESSAGE);
  }

  return {
    hold(publicToken, institution, userId, activeAtHold) {
      current = {
        publicToken,
        institution,
        userId,
        receivedAt: deps.now(),
        activeAtHold: activeAtHold.slice(),
        noResponse: false,
      };
      // A send still running belongs to the token this one replaced.
      inFlight = null;
    },

    send() {
      const held = current;
      if (!held) return Promise.resolve<ExchangeOutcome>({ kind: "idle" });
      if (inFlight) return inFlight;

      const attempt: Promise<ExchangeOutcome> = run(held)
        .catch((): ExchangeOutcome =>
          // A dependency broke its contract. Nothing is known about the
          // exchange, so the token stays while it is still the held one.
          current === held ? retry() : { kind: "superseded" }
        )
        .then((outcome) => {
          if (inFlight === attempt) inFlight = null;
          return outcome;
        });
      inFlight = attempt;
      return attempt;
    },

    hasToken: () => current !== null,

    clear() {
      current = null;
      inFlight = null;
    },
  };
}
