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

// ---------------------------------------------------------------------------
// The accept screen
// ---------------------------------------------------------------------------

export type AcceptView =
  | { kind: "no-link" }
  | { kind: "checking" }
  | { kind: "ready"; inviterFirstName: string | null; notice: string | null }
  | { kind: "joining"; inviterFirstName: string | null }
  | { kind: "joined" }
  | { kind: "must-leave"; inviterFirstName: string | null; error: string | null }
  | { kind: "leaving"; inviterFirstName: string | null }
  | { kind: "failed"; message: string; retry: boolean };

/** The next view, and whether the screen keeps the invite token for it. */
export type AcceptStep = { view: AcceptView; keepToken: boolean };

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

export function afterPreview(outcome: HouseholdOutcome): AcceptStep {
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
  return failedStep(outcome);
}

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
