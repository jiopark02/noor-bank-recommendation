import { sanitizeNameField } from "./validation";
import { toLogSafeError } from "./logSafeError";

/**
 * The decision half of POST /api/auth/sync-profile — every branch, none of the
 * IO. The route verifies the token, builds the real dependencies, calls this,
 * and serializes the result. profileSync.test.ts runs each branch with injected
 * fakes.
 *
 * WHERE EACH VALUE COMES FROM
 * The identity values — id, email, and the auth metadata blob — come from the
 * user the Bearer token was verified against, never from the request body. The
 * body supplies only display names, which are sanitized here. A body id that
 * names a different user is refused; a body email or metadata blob is ignored.
 *
 * A FAILED LOOKUP IS NOT A MISSING ROW
 * The existing-row read decides whether this is a first insert, and a first
 * insert writes created_at and the metadata blob. Treating a read error as "no
 * row" would reset created_at on an existing profile, so a read error stops
 * here and nothing is written.
 *
 * Response bodies are built from literal strings only; no error content
 * reaches them.
 */

const EMAIL_REQUIRED_MESSAGE = "email is required";
const FORBIDDEN_MESSAGE = "Forbidden";
const ADMIN_UNCONFIGURED_MESSAGE = "Supabase admin is not configured";
const SYNC_FAILED_MESSAGE = "Failed to sync user profile";

export type ProfileSyncIdentity = {
  /** user.id of the verified token's user. */
  id: string;
  /** user.email of the verified token's user; may be absent. */
  email: string | undefined;
  /** user.user_metadata of the verified token's user. */
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

  // Read any existing row so a re-login never resets created_at and keeps the
  // stored name when the incoming value is empty.
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

  const now = deps.now();
  const payload: Record<string, unknown> = {
    id: identity.id,
    email,
    first_name: firstName || row?.first_name || "User",
    last_name: lastName ?? row?.last_name ?? null,
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

  return { status: 200, body: { success: true } };
}
