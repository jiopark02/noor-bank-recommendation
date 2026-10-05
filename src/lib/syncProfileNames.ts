import { DEFAULT_FIRST_NAME } from "./defaultFirstName";

/**
 * The names a successful POST /api/auth/sync-profile reports having written,
 * in the shape the local profile uses (firstName / lastName, with an empty
 * string for a missing last name). Returns null when the response is not a
 * success or does not carry a usable first name, so the caller keeps what it
 * already had. The placeholder first name is returned as empty.
 */
export function namesFromSyncResponse(
  json: unknown
): { firstName: string; lastName: string } | null {
  if (!json || typeof json !== "object") {
    return null;
  }
  const body = json as Record<string, unknown>;
  if (body.success !== true) {
    return null;
  }
  if (typeof body.first_name !== "string" || !body.first_name) {
    return null;
  }
  if (body.last_name !== null && typeof body.last_name !== "string") {
    return null;
  }
  const firstName =
    body.first_name === DEFAULT_FIRST_NAME ? "" : body.first_name;
  return { firstName, lastName: body.last_name ?? "" };
}
