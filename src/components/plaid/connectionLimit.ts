// =============================================================================
// The bank connection limit as the browser shows it, before anything is
// pressed. Display only: the server holds the limit, both when a link token is
// asked for and before a token is exchanged, and neither check is changed by
// what is drawn here.
//
// The limit is defined in @/lib/plaidExchange, a server module a client
// component cannot import as a value. Only its type is imported here: the
// constant below is typed as that module's value, so a limit changed there
// fails to compile here until this one is changed to match. A test also holds
// the two numbers, and the sentence, equal to the server's.
// =============================================================================

import type { CONNECTION_LIMIT } from "@/lib/plaidExchange";

/** The most banks one user may connect. Equal to the server's limit by type. */
export const BANK_CONNECTION_LIMIT: typeof CONNECTION_LIMIT = 5;

/** The sentence the server answers a refused attempt with, word for word. */
export const CONNECTION_LIMIT_NOTICE = `You can connect up to ${BANK_CONNECTION_LIMIT} banks. Remove one to add another.`;

/**
 * Whether the listed connections have reached the limit. The count is every
 * listed connection whatever its status, which is what the server counts.
 */
export function isAtConnectionLimit(connectionCount: number): boolean {
  return connectionCount >= BANK_CONNECTION_LIMIT;
}
