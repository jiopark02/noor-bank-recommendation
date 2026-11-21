// =============================================================================
// What the household screens decide. No React, no DOM and no Supabase client:
// the screens supply the session read and the network, so every decision here
// runs in a test without a DOM.
//
// A request goes out only with a session's access token; without one nothing
// is sent. The invite token lives in the accept screen's memory only: it is
// read from the URL fragment, the fragment is removed at once, and the token
// is sent only as the body of a preview or accept request. It is never logged
// or stored.
// =============================================================================

import type { SessionReadResult } from "./supabase-browser";
import {
  HOUSEHOLD_CODES,
  HOUSEHOLD_MESSAGES,
  HOUSEHOLD_UI,
  SERVER_FAULT_MESSAGE,
  householdRoleLabel,
  type HouseholdCode,
} from "./householdCopy";

/** The fragment key the invite link carries its token under. */
export const INVITE_FRAGMENT_KEY = "household_invite";

/** 32 bytes as base64url without padding. */
const INVITE_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const HOUSEHOLD_ACCEPT_PATH = "/settings/household/accept";

export function buildInviteLink(origin: string, token: string): string {
  return `${origin}${HOUSEHOLD_ACCEPT_PATH}#${INVITE_FRAGMENT_KEY}=${token}`;
}

/**
 * The invite token from a URL's fragment, or null. Only a fragment that holds
 * exactly one key, household_invite, with one well-formed value counts; a
 * fragment that also carries anything else (an auth redirect's keys, say) is
 * not an invite. The query string is never read.
 */
export function readInviteFragment(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hash = url.hash.replace(/^#/, "");
  if (hash === "") return null;
  const params = new URLSearchParams(hash);
  const keys: string[] = [];
  params.forEach((_value, key) => {
    keys.push(key);
  });
  if (keys.length !== 1 || keys[0] !== INVITE_FRAGMENT_KEY) return null;
  const token = params.get(INVITE_FRAGMENT_KEY);
  return token !== null && INVITE_TOKEN_SHAPE.test(token) ? token : null;
}

/** The access token to send, or why there is none. */
export function householdRequestSession(
  read: SessionReadResult
): { ok: true; accessToken: string } | { ok: false; reason: "ended" | "unconfirmed" } {
  if (read.status === "none") return { ok: false, reason: "ended" };
  if (read.status !== "session" || !read.session.access_token) {
    return { ok: false, reason: "unconfirmed" };
  }
  return { ok: true, accessToken: read.session.access_token };
}

export type HouseholdHttp = (
  path: string,
  init: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    accessToken: string;
    body?: unknown;
    /** Aborts the request and its body read. */
    signal?: AbortSignal;
  }
) => Promise<{ status: number; json: unknown } | null>;

export type HouseholdOutcome =
  | { kind: "session"; reason: "ended" | "unconfirmed" }
  | { kind: "network" }
  | { kind: "answer"; status: number; body: Record<string, unknown> };

/**
 * One household request. With no access token nothing is sent. A null from
 * the network means it could not be reached.
 */
export async function householdCall(
  read: SessionReadResult,
  http: HouseholdHttp,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
  signal?: AbortSignal
): Promise<HouseholdOutcome> {
  const session = householdRequestSession(read);
  if (!session.ok) return { kind: "session", reason: session.reason };
  const answer = await http(path, { method, accessToken: session.accessToken, body, signal });
  if (answer === null) return { kind: "network" };
  const json = answer.json;
  return {
    kind: "answer",
    status: answer.status,
    body: json !== null && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {},
  };
}

/** fetch, with the token in the Authorization header and the body as JSON. */
export const browserHouseholdHttp: HouseholdHttp = async (path, { method, accessToken, body, signal }) => {
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch {
    return null;
  }
};

function isCode(value: unknown): value is HouseholdCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(HOUSEHOLD_MESSAGES, value);
}

export function outcomeCode(outcome: HouseholdOutcome): HouseholdCode | null {
  return outcome.kind === "answer" && isCode(outcome.body.code) ? outcome.body.code : null;
}

/** The sentence for an outcome that did not succeed. */
export function householdMessage(outcome: HouseholdOutcome): string {
  if (outcome.kind === "session") {
    return outcome.reason === "ended" ? HOUSEHOLD_UI.sessionEnded : HOUSEHOLD_UI.sessionUnconfirmed;
  }
  if (outcome.kind === "network") return HOUSEHOLD_UI.network;
  const code = outcomeCode(outcome);
  if (code !== null) return HOUSEHOLD_MESSAGES[code];
  if (outcome.status === 401) return HOUSEHOLD_UI.sessionEnded;
  return SERVER_FAULT_MESSAGE;
}

export function isOk(outcome: HouseholdOutcome): outcome is { kind: "answer"; status: number; body: Record<string, unknown> } {
  return outcome.kind === "answer" && outcome.status >= 200 && outcome.status < 300;
}

// ---------------------------------------------------------------------------
// The household screen
// ---------------------------------------------------------------------------

export type MemberLine = { self: boolean; role: "owner" | "member"; firstName: string | null };

/** "You · Manager", "Alex · Member", or just "Member" when there is no name. */
export function memberLineText(member: MemberLine): string {
  const role = householdRoleLabel(member.role);
  if (member.self) return `${HOUSEHOLD_UI.you} · ${role}`;
  return member.firstName ? `${member.firstName} · ${role}` : role;
}

export type HouseholdData = {
  role: "owner" | "member";
  members: MemberLine[];
  invite: { email: string; expiresAt: string } | null;
  maxMembers: number;
};

/** The view from GET /api/household, or null when it is not in that shape. */
export function readHouseholdData(body: Record<string, unknown>): HouseholdData | null {
  const h = body.household as Record<string, unknown> | undefined;
  if (!h || (h.role !== "owner" && h.role !== "member") || !Array.isArray(h.members)) return null;
  const members: MemberLine[] = [];
  for (const raw of h.members as Array<Record<string, unknown>>) {
    if (!raw || (raw.role !== "owner" && raw.role !== "member")) continue;
    members.push({
      self: raw.self === true,
      role: raw.role,
      firstName: typeof raw.firstName === "string" && raw.firstName.trim() !== "" ? raw.firstName : null,
    });
  }
  const inv = h.invite as Record<string, unknown> | null | undefined;
  const invite =
    inv && typeof inv.email === "string" && typeof inv.expiresAt === "string"
      ? { email: inv.email, expiresAt: inv.expiresAt }
      : null;
  const maxMembers = typeof h.maxMembers === "number" ? h.maxMembers : 2;
  return { role: h.role, members, invite, maxMembers };
}

/**
 * A list key for a member that does not depend on the order the members came
 * in: "self" for the caller, "other-<n>" for the n-th other member. The view
 * carries no member id, and none is added for this.
 */
export function memberKey(members: MemberLine[], index: number): string {
  if (members[index]?.self) return "self";
  let n = 0;
  for (let i = 0; i < index; i++) {
    if (!members[i].self) n++;
  }
  return `other-${n}`;
}

/**
 * What the household screen draws: its data once there is any, the load
 * error when the first load failed, and a loading line before either.
 */
export function householdLoadView(
  data: HouseholdData | null,
  loadError: string | null
): "loading" | "failed" | "ready" {
  if (data) return "ready";
  if (loadError !== null) return "failed";
  return "loading";
}

// ---------------------------------------------------------------------------
// The dashboard's household card
// ---------------------------------------------------------------------------

/**
 * How long the dashboard's household card waits for its answer, session read
 * included, before it shows that the household could not be loaded.
 * GET /api/household calls the auth server and the database and no other
 * provider, so this is not tied to BANK_SCREEN_FETCH_TIMEOUT_MS, which is
 * sized for Plaid's calls. The card blocks nothing else on the screen; this
 * only bounds how long its placeholder stays.
 */
export const HOUSEHOLD_CARD_FETCH_TIMEOUT_MS = 15_000;

export type HouseholdCardView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      members: MemberLine[];
      /** The open invite; the server sends it to the Manager only. */
      invite: { email: string; expiresAt: string } | null;
      /** A one-person household gets a way to the household screen to invite. */
      showInviteLink: boolean;
    };

/**
 * The card for one GET /api/household outcome. Anything but a 2xx answer in
 * the view's shape is "unavailable", never an empty or one-person household.
 */
export function householdCardView(outcome: HouseholdOutcome): HouseholdCardView {
  if (!isOk(outcome)) return { kind: "unavailable" };
  const data = readHouseholdData(outcome.body);
  if (!data || data.members.length === 0) return { kind: "unavailable" };
  return {
    kind: "ready",
    members: data.members,
    invite: data.invite,
    showInviteLink: data.members.length === 1,
  };
}

/**
 * Reads the session and the household for the card, under one time limit.
 * When the limit passes first, the request is aborted and the answer is
 * "unavailable", whether or not the request honours the abort. Never
 * rejects.
 */
export function loadHouseholdCard(
  read: () => Promise<SessionReadResult>,
  http: HouseholdHttp,
  timeoutMs: number = HOUSEHOLD_CARD_FETCH_TIMEOUT_MS
): Promise<HouseholdCardView> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (view: HouseholdCardView) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(view);
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish({ kind: "unavailable" });
    }, timeoutMs);
    (async () => {
      try {
        const session = await read();
        if (controller.signal.aborted) return;
        const outcome = await householdCall(
          session,
          http,
          "/api/household",
          "GET",
          undefined,
          controller.signal
        );
        finish(householdCardView(outcome));
      } catch {
        finish({ kind: "unavailable" });
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// The accept screen
// ---------------------------------------------------------------------------

export type AcceptView =
  | { kind: "no-link" }
  | { kind: "checking" }
  | { kind: "ready"; inviterFirstName: string | null; notice: string | null }
  | { kind: "joining"; inviterFirstName: string | null }
  | { kind: "joined" }
  | { kind: "join-unconfirmed" }
  | { kind: "must-leave"; inviterFirstName: string | null; error: string | null }
  | { kind: "leaving"; inviterFirstName: string | null }
  | { kind: "failed"; message: string; retry: boolean };

/** The next view, and whether the screen keeps the invite token for it. */
export type AcceptStep = { view: AcceptView; keepToken: boolean };

/**
 * Answers the household gate gives before any database call: the accept
 * that got one cannot have joined anyone.
 */
const GATE_CODES: HouseholdCode[] = [
  HOUSEHOLD_CODES.ADMIN_UNCONFIGURED,
  HOUSEHOLD_CODES.AUTH_UNAVAILABLE,
];

/**
 * Whether an accept that ended this way may have joined the person. The
 * network failing, or a 5xx that is not a gate answer, says nothing about
 * whether the database call committed. Every other answer is definite.
 */
export function acceptOutcomeUnknown(outcome: HouseholdOutcome): boolean {
  if (outcome.kind === "network") return true;
  if (outcome.kind !== "answer" || outcome.status < 500) return false;
  const code = outcomeCode(outcome);
  return code === null || GATE_CODES.indexOf(code) === -1;
}

/**
 * The accept-unknown flag after a preview. A 200 means the invite still
 * exists, so the earlier accept did not commit: cleared. A failure that
 * keeps the token for another try keeps the flag for that try. Anything else
 * ends the flow: cleared.
 */
export function acceptUnknownAfterPreview(outcome: HouseholdOutcome, acceptUnknown: boolean): boolean {
  if (!acceptUnknown) return false;
  const step = afterPreview(outcome, acceptUnknown);
  return step.view.kind === "failed" && step.keepToken;
}

/** "Alex invited you…", or the sentence with no name. */
export function invitedSentence(inviterFirstName: string | null): string {
  return inviterFirstName ? HOUSEHOLD_UI.invitedNamed(inviterFirstName) : HOUSEHOLD_UI.invitedUnnamed;
}

/** A failure that a second try can fix keeps the token; any other drops it. */
function failedStep(outcome: HouseholdOutcome): AcceptStep {
  const code = outcomeCode(outcome);
  const retry =
    outcome.kind === "network" ||
    (outcome.kind === "session" && outcome.reason === "unconfirmed") ||
    code === HOUSEHOLD_CODES.HOUSEHOLD_CHANGED ||
    (outcome.kind === "answer" && outcome.status >= 500);
  return { view: { kind: "failed", message: householdMessage(outcome), retry }, keepToken: retry };
}

/**
 * After a preview. acceptUnknown says an earlier accept on this screen ended
 * without a definite answer. Then a 404 INVITE_UNAVAILABLE is what a
 * committed accept looks like (the invite is deleted when it is used), so the
 * screen says it could not confirm and points to the household, instead of
 * calling the link invalid. A 200 means the invite still exists, so that
 * accept did not commit and the doubt is cleared.
 */
export function afterPreview(outcome: HouseholdOutcome, acceptUnknown = false): AcceptStep {
  if (isOk(outcome)) {
    const name = outcome.body.inviterFirstName;
    return {
      view: {
        kind: "ready",
        inviterFirstName: typeof name === "string" && name.trim() !== "" ? name : null,
        notice: null,
      },
      keepToken: true,
    };
  }
  if (acceptUnknown && outcomeCode(outcome) === HOUSEHOLD_CODES.INVITE_UNAVAILABLE) {
    return { view: { kind: "join-unconfirmed" }, keepToken: false };
  }
  return failedStep(outcome);
}

/**
 * After an accept. Whether a failure may still have joined the person is a
 * separate question, answered by acceptOutcomeUnknown; the screen keeps that
 * answer for the next preview.
 */
export function afterAccept(outcome: HouseholdOutcome, inviterFirstName: string | null): AcceptStep {
  if (isOk(outcome)) return { view: { kind: "joined" }, keepToken: false };
  if (outcomeCode(outcome) === HOUSEHOLD_CODES.MUST_LEAVE_FIRST) {
    return { view: { kind: "must-leave", inviterFirstName, error: null }, keepToken: true };
  }
  return failedStep(outcome);
}

/**
 * After "Leave my current household". Leaving worked: back to the ready view
 * with the same token, so the person can join without opening the link again.
 * The household turned out to have no one else in it: also ready, with no
 * notice, since nothing stands in the way of joining. Anything else: stay on
 * the leave view with that sentence, and keep the token.
 */
export function afterLeave(outcome: HouseholdOutcome, inviterFirstName: string | null): AcceptStep {
  if (isOk(outcome)) {
    return {
      view: { kind: "ready", inviterFirstName, notice: HOUSEHOLD_UI.leftPrevious },
      keepToken: true,
    };
  }
  if (outcomeCode(outcome) === HOUSEHOLD_CODES.LEAVE_SOLO) {
    return { view: { kind: "ready", inviterFirstName, notice: null }, keepToken: true };
  }
  return {
    view: { kind: "must-leave", inviterFirstName, error: householdMessage(outcome) },
    keepToken: true,
  };
}

// ---------------------------------------------------------------------------
// The household screen's buttons while an action runs
// ---------------------------------------------------------------------------

/** The action the household screen is running, if any. */
export type HouseholdBusyAction = "create" | "cancel" | "leave" | null;

/** "Creating…" only while creating; otherwise the button's own label. */
export function createButtonLabel(busy: HouseholdBusyAction, hasInvite: boolean): string {
  if (busy === "create") return HOUSEHOLD_UI.creating;
  return hasInvite ? HOUSEHOLD_UI.newLink : HOUSEHOLD_UI.createButton;
}

export function cancelButtonLabel(busy: HouseholdBusyAction): string {
  return busy === "cancel" ? HOUSEHOLD_UI.cancelling : HOUSEHOLD_UI.cancelInvite;
}

export function leaveConfirmLabel(busy: HouseholdBusyAction): string {
  return busy === "leave" ? HOUSEHOLD_UI.leavingCurrent : HOUSEHOLD_UI.leaveConfirm;
}

// ---------------------------------------------------------------------------
// Sharing a bank connection with the other member
// ---------------------------------------------------------------------------

export type SharingConnection = {
  itemId: string;
  institutionName: string;
  shared: boolean;
  answered: boolean;
};

export type SharingData = {
  eligible: boolean;
  partnerFirstName: string | null;
  connections: SharingConnection[];
};

/** The view from GET /api/household/sharing, or null when it is not in that shape. */
export function readSharingData(body: Record<string, unknown>): SharingData | null {
  const s = body.sharing as Record<string, unknown> | undefined;
  if (!s || typeof s.eligible !== "boolean" || !Array.isArray(s.connections)) return null;
  const connections: SharingConnection[] = [];
  for (const raw of s.connections as Array<Record<string, unknown>>) {
    if (!raw || typeof raw.itemId !== "string" || raw.itemId === "") continue;
    connections.push({
      itemId: raw.itemId,
      institutionName: typeof raw.institutionName === "string" ? raw.institutionName : "",
      shared: raw.shared === true,
      answered: raw.answered === true,
    });
  }
  const name = s.partnerFirstName;
  return {
    eligible: s.eligible,
    partnerFirstName: typeof name === "string" && name.trim() !== "" ? name : null,
    connections,
  };
}

/**
 * Reads the session and GET /api/household/sharing under one time limit, the
 * household card's. Null for anything but a 2xx answer in the view's shape,
 * for a passed limit (the request is aborted) and for a throw. Never rejects:
 * a caller that gets null shows nothing, and nothing else on its screen waits.
 */
export function loadSharing(
  read: () => Promise<SessionReadResult>,
  http: HouseholdHttp,
  timeoutMs: number = HOUSEHOLD_CARD_FETCH_TIMEOUT_MS
): Promise<SharingData | null> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (data: SharingData | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(null);
    }, timeoutMs);
    (async () => {
      try {
        const session = await read();
        if (controller.signal.aborted) return;
        const outcome = await householdCall(
          session,
          http,
          "/api/household/sharing",
          "GET",
          undefined,
          controller.signal
        );
        finish(isOk(outcome) ? readSharingData(outcome.body) : null);
      } catch {
        finish(null);
      }
    })();
  });
}

/**
 * Turns sharing of one of the caller's connections on or off, which also
 * records that the caller answered. Never rejects: a throw is a network
 * outcome.
 */
export async function answerShare(
  read: () => Promise<SessionReadResult>,
  http: HouseholdHttp,
  itemId: string,
  shared: boolean
): Promise<HouseholdOutcome> {
  try {
    const session = await read();
    return await householdCall(session, http, "/api/household/sharing", "PUT", { itemId, shared });
  } catch {
    return { kind: "network" };
  }
}

export type SharePromptView =
  | { kind: "none" }
  | { kind: "ask"; itemId: string; institutionName: string; partnerFirstName: string | null };

/**
 * The one question to show: the first connection not yet answered for the
 * current other member. Nothing when the load failed, when there is no other
 * member, or when every connection is answered.
 */
export function sharePromptView(data: SharingData | null): SharePromptView {
  if (!data || !data.eligible) return { kind: "none" };
  const next = data.connections.find((c) => !c.answered && !c.shared);
  if (!next) return { kind: "none" };
  return {
    kind: "ask",
    itemId: next.itemId,
    institutionName: next.institutionName,
    partnerFirstName: data.partnerFirstName,
  };
}

/**
 * Answers to a share request that another press cannot change: the
 * connection is gone, there is no one to share with, the household changed
 * under the request, or the request itself was refused. The screen reads the
 * view again and shows that answer's own sentence instead of "Try again".
 */
const SHARE_SETTLED_REFUSALS: HouseholdCode[] = [
  HOUSEHOLD_CODES.SHARE_NO_CONNECTION,
  HOUSEHOLD_CODES.SHARE_NO_PARTNER,
  HOUSEHOLD_CODES.HOUSEHOLD_CHANGED,
  HOUSEHOLD_CODES.SHARE_INVALID_REQUEST,
];

export type ShareAnswerStep = { reload: boolean; message: string | null };

/**
 * What a share screen does after an answer: a 2xx reads the view again with
 * no message; a settled refusal (decided by the answer's code, not its
 * status) reads it again and shows the code's sentence; anything else (no
 * network, a 5xx, a gate answer, a session problem) keeps the view and says
 * "Try again".
 */
export function afterShareAnswer(outcome: HouseholdOutcome): ShareAnswerStep {
  if (isOk(outcome)) return { reload: true, message: null };
  const code = outcomeCode(outcome);
  if (code !== null && SHARE_SETTLED_REFUSALS.indexOf(code) !== -1) {
    return { reload: true, message: HOUSEHOLD_MESSAGES[code] };
  }
  return { reload: false, message: HOUSEHOLD_UI.shareFailed };
}

/**
 * Keeps only the answer of the latest request a screen started. begin()
 * marks a new request and returns a check that stays true only while no later
 * request has begun. A screen that reloads when a prop changes applies an
 * answer only while its check is true, so an earlier request that answers
 * late cannot overwrite a later one's result.
 */
export function createLatestOnly(): { begin(): () => boolean } {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      const mine = latest;
      return () => mine === latest;
    },
  };
}
