import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * Why a request's Bearer token did not resolve to a user. Every value is a
 * code-defined constant, so a cause can be written to a log as it is: nothing
 * from the request is part of it.
 *
 *   supabase_unconfigured  the Supabase URL or anon key is missing
 *   no_header              no Authorization header, or an empty one
 *   not_bearer             a header that does not start with "Bearer "
 *   empty_token            the prefix with nothing after it
 *   client_unavailable     the server client could not be built
 *   token_rejected         Supabase Auth answered and did not accept the token,
 *                          or answered without a user
 *   auth_unreachable       Supabase Auth gave no usable answer
 */
export type AuthFailureCause =
  | "supabase_unconfigured"
  | "no_header"
  | "not_bearer"
  | "empty_token"
  | "client_unavailable"
  | "token_rejected"
  | "auth_unreachable";

function readStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Reads the error `auth.getUser(token)` returned in its error field.
 *
 * "auth_unreachable" is every answer that says nothing about the token: a
 * request that failed or met a gateway error (auth-js reports both as a
 * retryable fetch error), an error body that was not JSON (auth-js's unknown
 * error), a 5xx, and a 429. Everything else is "token_rejected".
 *
 * The line is drawn on the error's class and status, never on a specific error
 * code, since which code Supabase Auth sends for a given refusal is not
 * something this repo can read. Both outcomes refuse the request; they differ
 * in the status the caller answers with and in the log label. This is auth-js
 * 2.91.0 as installed: re-check it when upgrading.
 */
export function classifyGetUserFailure(
  error: unknown
): "token_rejected" | "auth_unreachable" {
  if (isAuthRetryableFetchError(error)) return "auth_unreachable";
  if (isAuthError(error) && error.name === "AuthUnknownError") {
    return "auth_unreachable";
  }
  const status = readStatus(error);
  if (status !== undefined && (status >= 500 || status === 429)) {
    return "auth_unreachable";
  }
  return "token_rejected";
}
