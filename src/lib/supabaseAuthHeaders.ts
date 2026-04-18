import { supabase } from "@/lib/supabase";

/** String-valued header map — assignable to `fetch` `HeadersInit`. */
export type FetchStringHeaders = Record<string, string>;

/**
 * Forward a browser or upstream `Authorization` header value for internal fetches.
 */
export function extrasFromAuthorizationValue(
  authorization: string | null
): FetchStringHeaders {
  return authorization ? { Authorization: authorization } : {};
}

/**
 * Authorization header for API routes that validate the Supabase access token.
 */
export async function getSupabaseBearerHeaders(): Promise<
  FetchStringHeaders
> {
  if (!supabase) {
    return {};
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token;
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * JSON POST/PUT fetch — explicit string map so `headers` satisfies `HeadersInit`.
 */
export function buildJsonAuthorizedHeaders(
  authExtras: FetchStringHeaders
): FetchStringHeaders {
  const plaidHeaders: FetchStringHeaders = {
    "Content-Type": "application/json",
  };
  if (authExtras.Authorization) {
    plaidHeaders.Authorization = authExtras.Authorization;
  }
  return plaidHeaders;
}

/**
 * GET (or body-less) fetch — only Bearer when present.
 */
export function buildBearerOnlyHeaders(
  authExtras: FetchStringHeaders
): FetchStringHeaders {
  const headers: FetchStringHeaders = {};
  if (authExtras.Authorization) {
    headers.Authorization = authExtras.Authorization;
  }
  return headers;
}
