import type { PlaidEnvironmentName } from "./plaid";
import type {
  ItemConnectionsLookup,
  ItemOwnedConnection,
} from "./plaidApiUtils";
import {
  logField,
  writeLogLine,
  type ConnectionRevocationOutcome,
  type LogLevel,
} from "./plaidRevocation";

/**
 * What a VERIFIED Plaid webhook does.
 *
 * v1 acts on exactly one webhook: ITEM / USER_PERMISSION_REVOKED, by revoking
 * the Item and deleting its row through revokeAndDeleteConnection — the same
 * revoke-before-delete pairing /api/plaid/disconnect and account deletion use,
 * unchanged. Every other webhook is logged and acknowledged.
 *
 * Why revoke at all when the user already revoked: Plaid's docs allow the Item
 * to be recovered through update mode, so it cannot be assumed gone, and the
 * row holds the only copy of the token. Deleting the row without itemRemove
 * would leave an Item nobody can revoke. If it is already gone, the
 * ITEM_NOT_FOUND fold in plaidRevocation.ts makes that a success.
 *
 * ⚠️ THE userId HANDED TO revoke IS THE ROW'S user_id, NOT A VERIFIED TOKEN'S.
 * There is no user session on this path. The chain of trust is: Plaid's
 * signature -> the payload's item_id -> the row -> that row's user_id. It is the
 * byte-identical value the token was encrypted under, which is what the AAD
 * check needs. This is a deliberate exception to "ids come from the verified
 * token", confined to this module.
 *
 * Status codes are what Plaid sees: 2xx ends the delivery, 4xx (bar 408/425/429)
 * is not retried, and 5xx is retried for up to 24 hours. Every 5xx below names a
 * state where a retry can succeed and both halves of the operation are
 * idempotent.
 *
 * Dependencies are injected so every branch is executed in
 * plaidWebhook.test.ts; the route wires the live ones.
 */

export const REVOCATION_CODES: readonly string[] = ["USER_PERMISSION_REVOKED"];

/**
 * ITEM webhooks that say the user's bank connection needs attention. They are
 * logged, not acted on, and that line is the only record of them, so it is a
 * warning rather than routine info.
 *
 *   ERROR                 - the Item has an error; the user fixes it through
 *                           update mode.
 *   PENDING_DISCONNECT    - a US/CA Item will be disconnected in 7 days unless
 *                           the user goes through update mode.
 *   PENDING_EXPIRATION    - the EU/UK equivalent; not expected here, still a
 *                           warning if it arrives.
 *   USER_ACCOUNT_REVOKED  - the user revoked access to one account at the
 *                           institution. Not treated as a revocation here:
 *                           only REVOCATION_CODES revoke an Item.
 *
 * Kept by hand: the Plaid SDK types webhook codes as plain strings, so nothing
 * flags a code that is added or renamed.
 */
const ITEM_ATTENTION_CODES: readonly string[] = [
  "ERROR",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "USER_ACCOUNT_REVOKED",
];

export type WebhookOutcome =
  | "malformed"
  | "env_mismatch"
  | "logged"
  | "admin_unconfigured"
  | "lookup_failed"
  | "unknown_item"
  | "ambiguous_item"
  | "revoked"
  | "revoke_failed";

export type WebhookDecision = {
  status: 200 | 500 | 503;
  outcome: WebhookOutcome;
};

export type WebhookDeps = {
  plaidEnvironment: PlaidEnvironmentName;
  isAdminConfigured: () => boolean;
  lookupByItemId: (itemId: string) => Promise<ItemConnectionsLookup>;
  revoke: (
    userId: string,
    connection: ItemOwnedConnection
  ) => Promise<ConnectionRevocationOutcome>;
  /**
   * Defaults to console.error, console.warn or console.info by the outcome's
   * level (OUTCOME_LEVEL). Injected so tests can read the lines; an injected
   * log gets the line only.
   */
  log?: (line: string) => void;
};

/**
 * The level each outcome's line is written at when no log is injected.
 *
 * `error` needs someone: a configuration fault, a failed read or revocation,
 * or an Item with more than one owner that nothing will retry. `warn` is a
 * verified delivery we did not expect: a body of the wrong shape, or a
 * webhook for the other environment. `info` is an outcome that is done.
 *
 * One exception, made in `decide`: a `logged` webhook that says the user's
 * connection needs attention — a code in ITEM_ATTENTION_CODES, or any webhook
 * carrying an `error` — is a warning, with the same line.
 */
const OUTCOME_LEVEL: Record<WebhookOutcome, LogLevel> = {
  malformed: "warn",
  env_mismatch: "warn",
  logged: "info",
  admin_unconfigured: "error",
  lookup_failed: "error",
  unknown_item: "info",
  ambiguous_item: "error",
  revoked: "info",
  revoke_failed: "error",
};

/**
 * An identifier from a signed payload or our own table. Logged whole when it
 * has an identifier's shape, so it can be matched against a `[plaid-revoke]`
 * line (logField alone caps at 32 and a Plaid item_id or a UUID is longer).
 * Anything else goes through logField.
 */
function idField(value: unknown): string {
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    return value;
  }
  return logField(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * @param payload The parsed body of a webhook whose signature has verified.
 *                Still untyped: verification proves who sent it, not its shape.
 */
export async function handlePlaidWebhook(
  payload: unknown,
  deps: WebhookDeps
): Promise<WebhookDecision> {
  const body = asRecord(payload);
  const type = body?.webhook_type;
  const code = body?.webhook_code;
  const itemId = body?.item_id;
  const environment = body?.environment;
  const errorCode = asRecord(body?.error)?.error_code;
  // Any webhook can carry `error`; a present one is a signal whatever its
  // shape, though the line names its code only when that is a string.
  const needsAttention =
    (type === "ITEM" &&
      typeof code === "string" &&
      ITEM_ATTENTION_CODES.indexOf(code) !== -1) ||
    (body?.error !== undefined && body?.error !== null);

  // Never the payload's URLs (new_webhook_url), never an amount: only these
  // fields, each bounded.
  const base =
    `[plaid-webhook] type=${logField(type)} code=${logField(code)} ` +
    `item_id=${idField(itemId)} env=${logField(environment)}`;
  const errorSuffix =
    typeof errorCode === "string" ? ` error_code=${logField(errorCode)}` : "";

  const decide = (
    status: WebhookDecision["status"],
    outcome: WebhookOutcome,
    extra = ""
  ): WebhookDecision => {
    const line = `${base} outcome=${outcome}${extra}${errorSuffix}`;
    if (deps.log) {
      deps.log(line);
    } else {
      writeLogLine(
        line,
        outcome === "logged" && needsAttention ? "warn" : OUTCOME_LEVEL[outcome]
      );
    }
    return { status, outcome };
  };

  // Retrying a body that does not parse into this shape gives the same body.
  if (!body || typeof type !== "string" || typeof code !== "string") {
    return decide(200, "malformed");
  }

  // A webhook for the other environment is about an Item this deployment does
  // not own. A missing environment counts as a mismatch: no action is the safe
  // reading.
  if (environment !== deps.plaidEnvironment) {
    return decide(200, "env_mismatch");
  }

  const isRevocation =
    type === "ITEM" && REVOCATION_CODES.indexOf(code) !== -1;
  if (!isRevocation) {
    return decide(200, "logged");
  }

  if (typeof itemId !== "string" || itemId === "") {
    return decide(200, "malformed");
  }

  if (!deps.isAdminConfigured()) {
    return decide(503, "admin_unconfigured");
  }

  const lookup = await deps.lookupByItemId(itemId);
  if (!lookup.ok) {
    return decide(500, "lookup_failed");
  }

  // Zero rows: an Item we never stored, or a duplicate delivery after the
  // first one already removed the row. Both are done.
  if (lookup.rows.length === 0) {
    return decide(200, "unknown_item");
  }

  // More than one owner for one Item: we cannot tell whose it is, so nothing
  // is touched. Not retried — a retry would read the same rows.
  if (lookup.rows.length > 1) {
    return decide(200, "ambiguous_item");
  }

  const row = lookup.rows[0];
  const ownerSuffix = ` user_id=${idField(row.user_id)}`;
  const outcome = await deps.revoke(row.user_id, row);
  if (outcome.ok) {
    return decide(200, "revoked", ownerSuffix);
  }
  return decide(
    500,
    "revoke_failed",
    `${ownerSuffix} failure=${logField(outcome.failure)}`
  );
}
