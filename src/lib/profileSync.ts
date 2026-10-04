import { sanitizeNameField } from "./validation";
import { toLogSafeError } from "./logSafeError";

/**
 * The decision half of POST /api/auth/sync-profile — every branch, none of the
 * IO. The route verifies the token, builds the real dependencies, calls this,
 * and serializes the result. profileSync.test.ts runs each branch with injected
 * fakes.
 *
 * WHERE EACH VALUE COMES FROM
 * id and email are the values Supabase Auth returns for the user the Bearer
 * token was verified against; neither is read from the request body. A body id
 * that names a different user is refused, and a body email is ignored.
 *
 * The metadata blob is also taken from that user, but it is NOT an identity
 * value: user_metadata is writable by the user through the Auth API
 * (auth.updateUser). It is stored as profile data on first insert, and nothing
 * should authorize on it.
 *
 * NAMES
 * First and last name are written as a pair from one source, never mixed.
 * The body supplies a candidate pair, sanitized here.
 *   - An existing row with a stored name keeps its stored pair as it is, even
 *     when its last name is empty. A stored first name counts as a name when it
 *     is non-empty and not DEFAULT_FIRST_NAME, the placeholder this function
 *     writes when it has no name.
 *   - Otherwise the body's pair is written: its first name, or
 *     DEFAULT_FIRST_NAME, and its last name, or null.
 *   - Except that when the body carries no name at all, an existing row keeps
 *     its stored pair, with DEFAULT_FIRST_NAME in place of an empty first name.
 * The success response reports the pair that was written.
 *
 * A FAILED LOOKUP IS NOT A MISSING ROW
 * The existing-row read decides whether this is a first insert, and a first
 * insert writes created_at and the metadata blob. Treating a read error as "no
 * row" would reset created_at on an existing profile, so a read error stops
 * here and nothing is written.
 *
 * Failure bodies are built from literal strings only; no error content reaches
 * them.
 */

const EMAIL_REQUIRED_MESSAGE = "email is required";
const FORBIDDEN_MESSAGE = "Forbidden";
const ADMIN_UNCONFIGURED_MESSAGE = "Supabase admin is not configured";
const SYNC_FAILED_MESSAGE = "Failed to sync user profile";

/** Written as first_name when no name is available; see NAMES above. */
export const DEFAULT_FIRST_NAME = "User";

export type ProfileSyncIdentity = {
  /** user.id of the verified token's user. */
  id: string;
  /** user.email of the verified token's user; may be absent. */
  email: string | undefined;
  /**
   * user.user_metadata of the verified token's user. User-writable through the
   * Auth API, so profile data only — not an identity value.
   */
  userMetadata: unknown;
};

export type ExistingProfileRow = {
  first_name: string | null;
  last_name: string | null;
};

export type ProfileSyncDeps = {
  /** The service-role key needed for the read and the write is present. */
  isAdminConfigured: () => boolean;
  /** row null with error null means there is no row for this id. */
  findExisting: (
    userId: string
  ) => Promise<{ row: ExistingProfileRow | null; error: unknown }>;
  upsertProfile: (
    payload: Record<string, unknown>
  ) => Promise<{ error: unknown }>;
  /** ISO timestamp used for created_at and updated_at. */
  now: () => string;
  /** Defaults to console.error. Injected so tests stay quiet. */
  log?: (line: string) => void;
};

export type ProfileSyncResult = {
  status: number;
  body: Record<string, unknown>;
};

function emit(deps: ProfileSyncDeps, line: string): void {
  if (deps.log) {
    deps.log(line);
    return;
  }
  console.error(line);
}

function failure(status: number, message: string): ProfileSyncResult {
  return { status, body: { success: false, message } };
}

export async function syncProfileForUser(
  identity: ProfileSyncIdentity,
  body: unknown,
  deps: ProfileSyncDeps
): Promise<ProfileSyncResult> {
  const input = (body ?? {}) as Record<string, unknown>;

  const email =
    typeof identity.email === "string"
      ? identity.email.toLowerCase().trim()
      : "";
  if (!email) {
    return failure(400, EMAIL_REQUIRED_MESSAGE);
  }

  const bodyId = input.id;
  if (bodyId && bodyId !== identity.id) {
    return failure(403, FORBIDDEN_MESSAGE);
  }

  if (!deps.isAdminConfigured()) {
    return failure(500, ADMIN_UNCONFIGURED_MESSAGE);
  }

  const firstName = sanitizeNameField(input.first_name) || null;
  const lastName = sanitizeNameField(input.last_name) || null;

  // Read any existing row so a re-login never resets created_at and keeps
  // stored names as NAMES above describes.
  const existing = await deps.findExisting(identity.id);
  if (existing.error) {
    emit(
      deps,
      "[sync-profile] existing-row lookup failed; not writing: code=" +
        (toLogSafeError(existing.error).code ?? "none")
    );
    return failure(500, SYNC_FAILED_MESSAGE);
  }
  const row = existing.row;

  // The name pair comes from one source; see NAMES above.
  const hasStoredName =
    !!row && !!row.first_name && row.first_name !== DEFAULT_FIRST_NAME;
  const bodyHasName = !!firstName || !!lastName;
  let names: { first_name: string; last_name: string | null };
  if (row && hasStoredName) {
    names = {
      first_name: row.first_name as string,
      last_name: row.last_name ?? null,
    };
  } else if (bodyHasName || !row) {
    names = { first_name: firstName || DEFAULT_FIRST_NAME, last_name: lastName };
  } else {
    names = {
      first_name: row.first_name || DEFAULT_FIRST_NAME,
      last_name: row.last_name ?? null,
    };
  }

  const now = deps.now();
  const payload: Record<string, unknown> = {
    id: identity.id,
    email,
    first_name: names.first_name,
    last_name: names.last_name,
    updated_at: now,
  };

  // created_at and the metadata blob are written only on first insert, so a
  // routine re-login neither resets the signup date nor rewrites the blob.
  if (!row) {
    payload.created_at = now;
    payload.raw_user_meta_data = identity.userMetadata ?? null;
  }

  const { error } = await deps.upsertProfile(payload);
  if (error) {
    return failure(500, SYNC_FAILED_MESSAGE);
  }

  return { status: 200, body: { success: true, ...names } };
}
