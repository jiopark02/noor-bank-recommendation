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
  init: { method: "GET" | "POST" | "DELETE"; accessToken: string; body?: unknown }
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
  method: "GET" | "POST" | "DELETE",
  body?: unknown
): Promise<HouseholdOutcome> {
  const session = householdRequestSession(read);
  if (!session.ok) return { kind: "session", reason: session.reason };
  const answer = await http(path, { method, accessToken: session.accessToken, body });
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
export const browserHouseholdHttp: HouseholdHttp = async (path, { method, accessToken, body }) => {
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
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
