import { createHash, randomBytes } from "crypto";
import { validateEmail } from "./validation";
import {
  HOUSEHOLD_CODES,
  HOUSEHOLD_MESSAGES,
  type HouseholdCode,
} from "./householdCopy";
import type { HouseholdInviteClaimResult, HouseholdInviteLimitMode } from "./householdInviteLimit";

/**
 * What the household routes decide: viewing the caller's household, creating,
 * cancelling, previewing and accepting an invite, and leaving. Every write is
 * one call to a service-role SQL function (migration
 * 20261120120000_household_invites_and_membership_changes.sql; whether it is
 * applied is live state) that takes the caller's user lock and then the
 * household lock; this module holds no client and no SQL. The store it is
 * given does the reads and the calls.
 *
 * Identity comes only from the verified token: the caller's id, their email
 * and whether that email is confirmed. Nothing in a request body names a
 * user or a household; a body carries only the invitee's address (create) or
 * the invite token (preview, accept).
 *
 * The invite token is 32 random bytes, base64url without padding. Only its
 * SHA-256 is sent to the database, and the token itself is answered once, by
 * the create call. Addresses are compared after trim and lowercase, here only;
 * the database compares exactly what it is given.
 *
 * Preview and accept answer one identical 404 for a malformed token, a token
 * that names no invite, an expired invite, an address that does not match,
 * and a household that is gone, so a caller cannot tell them apart. Only a
 * caller whose confirmed address matches learns anything about the invite.
 *
 * Log lines carry the route name, the outcome and an error code only: never a
 * token, a hash, an address, a name or an id.
 */

/** The most active members a household can have; the SQL function holds the same. */
export const HOUSEHOLD_MAX_MEMBERS = 2;

/** How long an invite stays open, in seconds (24 hours). */
export const HOUSEHOLD_INVITE_TTL_SECONDS = 86_400;

/** Largest request body the household routes read. */
export const HOUSEHOLD_BODY_MAX_BYTES = 4096;

const INVITE_TOKEN_BYTES = 32;
/** 32 bytes as base64url without padding is 43 characters. */
const INVITE_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const MAX_EMAIL_LENGTH = 320;

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

export function isInviteTokenShape(value: unknown): value is string {
  return typeof value === "string" && INVITE_TOKEN_SHAPE.test(value);
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Trimmed and lowercased, or null when it is not an email address. */
export function normalizeInviteEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email === "" || email.length > MAX_EMAIL_LENGTH) return null;
  if (!validateEmail(email).isValid) return null;
  return email;
}

export type HouseholdIdentity = {
  id: string;
  /** The verified account's address as the auth server returned it. */
  email: string | null;
  emailConfirmed: boolean;
};

export type HouseholdResult = {
  status: number;
  body: Record<string, unknown>;
};

export type HouseholdRole = "owner" | "member";

export type HouseholdMemberView = {
  self: boolean;
  role: HouseholdRole;
  firstName: string | null;
};

export type HouseholdView = {
  role: HouseholdRole;
  members: HouseholdMemberView[];
  /** The open invite, shown to the owner only. */
  invite: { email: string; expiresAt: string } | null;
};

export type StoreText = { ok: true; value: string } | { ok: false; code: string };

export type PreviewInvite = {
  householdId: string;
  invitedBy: string;
  inviteeEmail: string;
  expiresAt: string;
};

export type HouseholdStore = {
  ensure(userId: string): Promise<boolean>;
  repairOwner(userId: string): Promise<StoreText>;
  /** Deletes every expired invite; answers how many rows it deleted. */
  pruneExpired(): Promise<{ ok: true; deleted: number } | { ok: false; code: string }>;
  readView(userId: string): Promise<{ ok: true; view: HouseholdView } | { ok: false; code: string }>;
  claim(userId: string): Promise<HouseholdInviteClaimResult>;
  createInvite(userId: string, email: string, tokenHash: string, ttlSeconds: number): Promise<StoreText>;
  cancelInvite(userId: string): Promise<StoreText>;
  acceptInvite(userId: string, tokenHash: string, email: string): Promise<StoreText>;
  leave(userId: string): Promise<StoreText>;
  readInviteByHash(tokenHash: string): Promise<{ ok: true; invite: PreviewInvite | null } | { ok: false; code: string }>;
  /** Whether the inviter is still an active member there, and their first name. */
  readInviter(
    invitedBy: string,
    householdId: string
  ): Promise<{ ok: true; active: boolean; firstName: string | null } | { ok: false; code: string }>;
};

export type HouseholdLog = (line: string) => void;

export type RouteName =
  | "view"
  | "invite-create"
  | "invite-cancel"
  | "invite-preview"
  | "invite-accept"
  | "leave"
  | "sharing-view"
  | "sharing-set";

function fail(status: number, code: HouseholdCode): HouseholdResult {
  return { status, body: { error: HOUSEHOLD_MESSAGES[code], code } };
}

const SERVER_ERROR = (): HouseholdResult => fail(500, HOUSEHOLD_CODES.SERVER_ERROR);
const INVITE_UNAVAILABLE = (): HouseholdResult => fail(404, HOUSEHOLD_CODES.INVITE_UNAVAILABLE);

/** An error code in a shape that cannot carry text into a log line. */
export function logSafeCode(code: unknown): string {
  if (typeof code !== "string" || code === "") return "none";
  return /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "invalid";
}

function logLine(log: HouseholdLog, route: RouteName, outcome: string, code?: string): void {
  log(
    `[household] route=${route} outcome=${outcome}` +
      (code === undefined ? "" : ` code=${logSafeCode(code)}`)
  );
}

/** First name for display: trimmed, or null when empty or not a string. */
export function displayFirstName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name === "" ? null : name;
}

// ---------------------------------------------------------------------------
// GET /api/household
// ---------------------------------------------------------------------------

export async function viewHousehold(
  identity: HouseholdIdentity,
  store: HouseholdStore,
  log: HouseholdLog
): Promise<HouseholdResult> {
  if (!(await store.ensure(identity.id))) {
    logLine(log, "view", "ensure_failed");
    return SERVER_ERROR();
  }
  const repaired = await store.repairOwner(identity.id);
  if (!repaired.ok) {
    // Display still works without the repair; the next read tries again.
    logLine(log, "view", "repair_failed", repaired.code);
  }
  // Expired invites are not deleted here (the prune cron route does that);
  // readView asks only for an invite whose expiry is still ahead.
  const read = await store.readView(identity.id);
  if (!read.ok) {
    logLine(log, "view", "read_failed", read.code);
    return SERVER_ERROR();
  }
  return {
    status: 200,
    body: {
      household: {
        role: read.view.role,
        members: read.view.members,
        invite: read.view.invite,
        maxMembers: HOUSEHOLD_MAX_MEMBERS,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/household/invite
// ---------------------------------------------------------------------------

export async function createHouseholdInvite(
  identity: HouseholdIdentity,
  body: unknown,
  store: HouseholdStore,
  log: HouseholdLog,
  options: {
    limitMode: HouseholdInviteLimitMode;
    newToken?: () => string;
    now?: () => number;
  }
): Promise<HouseholdResult> {
  const raw =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).email
      : undefined;
  const email = normalizeInviteEmail(raw);
  if (email === null) {
    logLine(log, "invite-create", "invalid_email");
    return fail(400, HOUSEHOLD_CODES.INVALID_EMAIL);
  }
  const own = normalizeInviteEmail(identity.email);
  if (own !== null && own === email) {
    logLine(log, "invite-create", "self");
    return fail(400, HOUSEHOLD_CODES.INVITE_SELF);
  }

  if (!(await store.ensure(identity.id))) {
    logLine(log, "invite-create", "ensure_failed");
    return SERVER_ERROR();
  }

  if (options.limitMode !== "off") {
    const claim = await store.claim(identity.id);
    if (claim.claim === "held") {
      logLine(log, "invite-create", "limit_reached");
      return fail(429, HOUSEHOLD_CODES.INVITE_LIMIT_REACHED);
    }
    if (claim.claim === "error") {
      logLine(log, "invite-create", "limit_check_failed", claim.cause);
      return fail(503, HOUSEHOLD_CODES.INVITE_CHECK_UNAVAILABLE);
    }
  }

  const token = (options.newToken ?? generateInviteToken)();
  const created = await store.createInvite(
    identity.id,
    email,
    hashInviteToken(token),
    HOUSEHOLD_INVITE_TTL_SECONDS
  );
  if (!created.ok) {
    logLine(log, "invite-create", "call_failed", created.code);
    return SERVER_ERROR();
  }
  switch (created.value) {
    case "created": {
      const now = (options.now ?? Date.now)();
      return {
        status: 201,
        body: {
          token,
          expiresAt: new Date(now + HOUSEHOLD_INVITE_TTL_SECONDS * 1000).toISOString(),
        },
      };
    }
    case "not_owner":
      logLine(log, "invite-create", "not_owner");
      return fail(403, HOUSEHOLD_CODES.NOT_OWNER);
    case "household_full":
      logLine(log, "invite-create", "household_full");
      return fail(409, HOUSEHOLD_CODES.HOUSEHOLD_FULL);
    default:
      logLine(log, "invite-create", "bad_answer");
      return SERVER_ERROR();
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/household/invite
// ---------------------------------------------------------------------------

export async function cancelHouseholdInvite(
  identity: HouseholdIdentity,
  store: HouseholdStore,
  log: HouseholdLog
): Promise<HouseholdResult> {
  const cancelled = await store.cancelInvite(identity.id);
  if (!cancelled.ok) {
    logLine(log, "invite-cancel", "call_failed", cancelled.code);
    return SERVER_ERROR();
  }
  switch (cancelled.value) {
    case "cancelled":
      return { status: 200, body: { cancelled: true } };
    case "none":
      return { status: 200, body: { cancelled: false } };
    case "not_owner":
      logLine(log, "invite-cancel", "not_owner");
      return fail(403, HOUSEHOLD_CODES.NOT_OWNER);
    default:
      logLine(log, "invite-cancel", "bad_answer");
      return SERVER_ERROR();
  }
}

// ---------------------------------------------------------------------------
// POST /api/household/invite/preview and /api/household/invite/accept
// ---------------------------------------------------------------------------

type TokenRead =
  | { kind: "refused" }
  | { kind: "unconfirmed" }
  | { kind: "ok"; tokenHash: string; email: string };

/** The checks preview and accept share, before any database read. */
function readInviteRequest(identity: HouseholdIdentity, body: unknown): TokenRead {
  if (!identity.emailConfirmed) return { kind: "unconfirmed" };
  const token =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).token
      : undefined;
  if (!isInviteTokenShape(token)) return { kind: "refused" };
  const email = normalizeInviteEmail(identity.email);
  if (email === null) return { kind: "refused" };
  return { kind: "ok", tokenHash: hashInviteToken(token), email };
}

export async function previewHouseholdInvite(
  identity: HouseholdIdentity,
  body: unknown,
  store: HouseholdStore,
  log: HouseholdLog,
  now: () => number = Date.now
): Promise<HouseholdResult> {
  const request = readInviteRequest(identity, body);
  if (request.kind === "unconfirmed") {
    logLine(log, "invite-preview", "email_unconfirmed");
    return fail(403, HOUSEHOLD_CODES.EMAIL_UNCONFIRMED);
  }
  if (request.kind === "refused") {
    logLine(log, "invite-preview", "refused");
    return INVITE_UNAVAILABLE();
  }

  const read = await store.readInviteByHash(request.tokenHash);
  if (!read.ok) {
    logLine(log, "invite-preview", "read_failed", read.code);
    return SERVER_ERROR();
  }
  const invite = read.invite;
  if (
    invite === null ||
    !(Date.parse(invite.expiresAt) > now()) ||
    invite.inviteeEmail !== request.email
  ) {
    logLine(log, "invite-preview", "refused");
    return INVITE_UNAVAILABLE();
  }

  // Only now, with the address matched, is anything about the inviter read.
  const inviter = await store.readInviter(invite.invitedBy, invite.householdId);
  if (!inviter.ok) {
    logLine(log, "invite-preview", "read_failed", inviter.code);
    return SERVER_ERROR();
  }
  if (!inviter.active) {
    logLine(log, "invite-preview", "refused");
    return INVITE_UNAVAILABLE();
  }
  return { status: 200, body: { inviterFirstName: inviter.firstName } };
}

export async function acceptHouseholdInvite(
  identity: HouseholdIdentity,
  body: unknown,
  store: HouseholdStore,
  log: HouseholdLog
): Promise<HouseholdResult> {
  const request = readInviteRequest(identity, body);
  if (request.kind === "unconfirmed") {
    logLine(log, "invite-accept", "email_unconfirmed");
    return fail(403, HOUSEHOLD_CODES.EMAIL_UNCONFIRMED);
  }
  if (request.kind === "refused") {
    logLine(log, "invite-accept", "refused");
    return INVITE_UNAVAILABLE();
  }

  const accepted = await store.acceptInvite(identity.id, request.tokenHash, request.email);
  if (!accepted.ok) {
    logLine(log, "invite-accept", "call_failed", accepted.code);
    return SERVER_ERROR();
  }
  switch (accepted.value) {
    case "accepted":
      return { status: 200, body: { joined: true } };
    case "refused":
      logLine(log, "invite-accept", "refused");
      return INVITE_UNAVAILABLE();
    case "must_leave_first":
      logLine(log, "invite-accept", "must_leave_first");
      return fail(409, HOUSEHOLD_CODES.MUST_LEAVE_FIRST);
    case "household_full":
      logLine(log, "invite-accept", "household_full");
      return fail(409, HOUSEHOLD_CODES.HOUSEHOLD_FULL);
    case "already_member":
      logLine(log, "invite-accept", "already_member");
      return fail(409, HOUSEHOLD_CODES.ALREADY_MEMBER);
    case "retry":
      logLine(log, "invite-accept", "retry");
      return fail(409, HOUSEHOLD_CODES.HOUSEHOLD_CHANGED);
    default:
      logLine(log, "invite-accept", "bad_answer");
      return SERVER_ERROR();
  }
}

// ---------------------------------------------------------------------------
// POST /api/household/leave
// ---------------------------------------------------------------------------

export async function leaveHousehold(
  identity: HouseholdIdentity,
  store: HouseholdStore,
  log: HouseholdLog
): Promise<HouseholdResult> {
  const left = await store.leave(identity.id);
  if (!left.ok) {
    logLine(log, "leave", "call_failed", left.code);
    return SERVER_ERROR();
  }
  switch (left.value) {
    case "left":
      return { status: 200, body: { left: true } };
    case "solo":
    case "none":
      logLine(log, "leave", left.value);
      return fail(409, HOUSEHOLD_CODES.LEAVE_SOLO);
    default:
      logLine(log, "leave", "bad_answer");
      return SERVER_ERROR();
  }
}

// ---------------------------------------------------------------------------
// GET /api/cron/prune-household-invites
// ---------------------------------------------------------------------------

/**
 * Deletes every expired invite in one call. A failed call answers 500, so a
 * run that deleted nothing because it failed never reads as a success. The
 * log line carries the outcome and either the deleted count or an error code.
 */
export async function pruneHouseholdInvites(
  store: Pick<HouseholdStore, "pruneExpired">,
  log: HouseholdLog
): Promise<HouseholdResult> {
  const pruned = await store.pruneExpired();
  if (!pruned.ok) {
    log(`[household-prune] outcome=failed code=${logSafeCode(pruned.code)}`);
    return { status: 500, body: { success: false, error: "Prune failed" } };
  }
  log(`[household-prune] outcome=ok deleted=${pruned.deleted}`);
  return { status: 200, body: { success: true, deleted: pruned.deleted } };
}

/** The answer for a body over HOUSEHOLD_BODY_MAX_BYTES. */
export function requestTooLarge(route: RouteName, log: HouseholdLog): HouseholdResult {
  logLine(log, route, "too_large");
  return fail(413, HOUSEHOLD_CODES.REQUEST_TOO_LARGE);
}
