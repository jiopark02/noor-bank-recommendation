/**
 * Written as first_name when no name is available. Server code writes it to
 * public.users and to Auth user metadata; client code that receives it back
 * shows it as an empty name.
 *
 * Kept in a module of its own so browser code can import it without pulling
 * in server-side modules.
 */
export const DEFAULT_FIRST_NAME = "User";

/**
 * A first name as a response hands it to the client: the placeholder becomes
 * an empty name, so no screen greets the user as "User".
 */
export function firstNameForClient(firstName: string): string {
  return firstName === DEFAULT_FIRST_NAME ? "" : firstName;
}
