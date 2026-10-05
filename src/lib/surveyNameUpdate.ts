import { sanitizeNameField } from "./validation";

/**
 * The name columns a signed-in survey submit writes to public.users, or null
 * to leave them alone.
 *
 * The survey form sends a first name only. A first name that is non-empty and
 * differs from the stored one is written together with last_name null, so the
 * row never pairs a new first name with a last name from an earlier source.
 * The stored first name goes through the same sanitizing as the submitted one
 * before they are compared, so a stored value that only differs in what
 * sanitizing removes counts as unchanged. Without a stored row there is
 * nothing to update, and no name is written.
 */

export type StoredNames = {
  first_name: string | null;
  last_name: string | null;
};

export type NameUpdate = { first_name: string; last_name: null };

/**
 * @param stored        The public.users row's names, or null when there is no row.
 * @param bodyFirstName The submitted first name, already sanitized; null when empty.
 */
export function decideNameUpdate(
  stored: StoredNames | null,
  bodyFirstName: string | null
): NameUpdate | null {
  if (!stored || !bodyFirstName) {
    return null;
  }
  if (bodyFirstName === sanitizeNameField(stored.first_name)) {
    return null;
  }
  return { first_name: bodyFirstName, last_name: null };
}
