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
