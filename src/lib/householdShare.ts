import {
  HOUSEHOLD_CODES,
  HOUSEHOLD_MESSAGES,
  type HouseholdCode,
} from "./householdCopy";
import {
  logSafeCode,
  type HouseholdIdentity,
  type HouseholdLog,
  type HouseholdResult,
  type RouteName,
  type StoreText,
} from "./householdInvite";

/**
 * What GET and PUT /api/household/sharing decide: which of the caller's bank
 * connections they share with the other member of their household, and
 * turning that on or off for one connection.
 *
 * Only the caller's own connections are listed, and nothing from another
 * person's connections is read. The other member is named by first name
 * only; their id never leaves the server. Every write is one call to the
 * service-role SQL function household_share_set (migration
 * 20261121120000_household_share_grants.sql; whether it is applied is live
 * state), which takes the caller's user lock and then the household lock and
 * finds the connection by the caller's id and the item id. The request body
 * carries only the item id and the new setting; the user comes from the
 * verified token.
 *
 * Asking whether to share is answered once per connection and person:
 * either answer records it, and a new partner is asked again.
 *
 * Log lines carry the route name, the outcome and an error code only: never
 * an item id, an institution, a name or a user id.
 */

export type SharePartner = {
  userId: string;
  householdId: string;
  firstName: string | null;
};

export type OwnConnection = {
  /** The row id, used only to match grants and answers on the server. */
  id: number;
  itemId: string;
  institutionName: string;
};

export type ShareRow = {
  resourceId: number;
  granteeUserId: string;
  householdId: string;
};

export type ShareRead<T> = { ok: true; value: T } | { ok: false; code: string };

export type HouseholdShareStore = {
  /** The other active member of the caller's household, or null when there is not exactly one. */
  readPartner(userId: string): Promise<ShareRead<SharePartner | null>>;
  /** The caller's own connections. */
  readConnections(userId: string): Promise<ShareRead<OwnConnection[]>>;
  /** The grants the caller gave. */
  readGrants(userId: string): Promise<ShareRead<ShareRow[]>>;
  /** The answers the caller gave. */
  readAnswers(userId: string): Promise<ShareRead<ShareRow[]>>;
  setShare(userId: string, itemId: string, shared: boolean): Promise<StoreText>;
};

export type SharingConnectionView = {
  itemId: string;
  institutionName: string;
  shared: boolean;
  answered: boolean;
};

export type SharingView = {
  eligible: boolean;
  partnerFirstName: string | null;
  connections: SharingConnectionView[];
};

export type ShareRouteName = Extract<RouteName, "sharing-view" | "sharing-set">;

/** Longest item id the set call accepts; Plaid item ids are far shorter. */
const MAX_ITEM_ID_LENGTH = 200;

function fail(status: number, code: HouseholdCode): HouseholdResult {
  return { status, body: { error: HOUSEHOLD_MESSAGES[code], code } };
}

const SERVER_ERROR = (): HouseholdResult => fail(500, HOUSEHOLD_CODES.SERVER_ERROR);

function logLine(log: HouseholdLog, route: ShareRouteName, outcome: string, code?: string): void {
  log(
    `[household] route=${route} outcome=${outcome}` +
      (code === undefined ? "" : ` code=${logSafeCode(code)}`)
  );
}

function matches(row: ShareRow, connection: OwnConnection, partner: SharePartner): boolean {
  return (
    row.resourceId === connection.id &&
    row.granteeUserId === partner.userId &&
    row.householdId === partner.householdId
  );
}

// ---------------------------------------------------------------------------
// GET /api/household/sharing
// ---------------------------------------------------------------------------

export async function viewSharing(
  identity: HouseholdIdentity,
  store: HouseholdShareStore,
  log: HouseholdLog
): Promise<HouseholdResult> {
  const partner = await store.readPartner(identity.id);
  if (!partner.ok) {
    logLine(log, "sharing-view", "read_failed", partner.code);
    return SERVER_ERROR();
  }
  if (partner.value === null) {
    return {
      status: 200,
      body: { sharing: { eligible: false, partnerFirstName: null, connections: [] } },
    };
  }
  const other = partner.value;

  const connections = await store.readConnections(identity.id);
  if (!connections.ok) {
    logLine(log, "sharing-view", "read_failed", connections.code);
    return SERVER_ERROR();
  }
  const grants = await store.readGrants(identity.id);
  if (!grants.ok) {
    logLine(log, "sharing-view", "read_failed", grants.code);
    return SERVER_ERROR();
  }
  const answers = await store.readAnswers(identity.id);
  if (!answers.ok) {
    logLine(log, "sharing-view", "read_failed", answers.code);
    return SERVER_ERROR();
  }

  const view: SharingView = {
    eligible: true,
    partnerFirstName: other.firstName,
    connections: connections.value.map((connection) => ({
      itemId: connection.itemId,
      institutionName: connection.institutionName,
      shared: grants.value.some((row) => matches(row, connection, other)),
      // The question is per person: an answer about someone else does not count.
      answered: answers.value.some(
        (row) => row.resourceId === connection.id && row.granteeUserId === other.userId
      ),
    })),
  };
  return { status: 200, body: { sharing: view } };
}

// ---------------------------------------------------------------------------
// PUT /api/household/sharing
// ---------------------------------------------------------------------------

/** The item id and the new setting, or null when the body is not exactly that shape. */
export function readShareRequest(body: unknown): { itemId: string; shared: boolean } | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const itemId = record.itemId;
  const shared = record.shared;
  if (typeof itemId !== "string" || typeof shared !== "boolean") return null;
  if (itemId === "" || itemId.length > MAX_ITEM_ID_LENGTH || itemId.trim() !== itemId) return null;
  return { itemId, shared };
}

export async function setSharing(
  identity: HouseholdIdentity,
  body: unknown,
  store: HouseholdShareStore,
  log: HouseholdLog
): Promise<HouseholdResult> {
  const request = readShareRequest(body);
  if (request === null) {
    logLine(log, "sharing-set", "invalid_request");
    return fail(400, HOUSEHOLD_CODES.SHARE_INVALID_REQUEST);
  }

  const set = await store.setShare(identity.id, request.itemId, request.shared);
  if (!set.ok) {
    logLine(log, "sharing-set", "call_failed", set.code);
    return SERVER_ERROR();
  }
  switch (set.value) {
    case "shared":
    case "unshared":
      // The one record of turning sharing on or off; the row itself is
      // deleted when it is turned off.
      logLine(log, "sharing-set", set.value);
      return { status: 200, body: { shared: set.value === "shared" } };
    case "none":
    case "solo":
      logLine(log, "sharing-set", set.value);
      return fail(409, HOUSEHOLD_CODES.SHARE_NO_PARTNER);
    case "no_connection":
      logLine(log, "sharing-set", "no_connection");
      return fail(404, HOUSEHOLD_CODES.SHARE_NO_CONNECTION);
    case "refused":
      logLine(log, "sharing-set", "refused");
      return fail(409, HOUSEHOLD_CODES.HOUSEHOLD_CHANGED);
    default:
      logLine(log, "sharing-set", "bad_answer");
      return SERVER_ERROR();
  }
}
