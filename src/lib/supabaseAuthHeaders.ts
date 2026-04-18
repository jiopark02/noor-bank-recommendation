import { supabase } from "@/lib/supabase";

/**
 * Authorization header for API routes that validate the Supabase access token.
 */
export async function getSupabaseBearerHeaders(): Promise<
  Record<string, string>
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
 * JSON POST/PUT fetch — explicit Record so `headers` satisfies HeadersInit.
 */
export function buildJsonAuthorizedHeaders(
  authExtras: Record<string, string>
): Record<string, string> {
  const plaidHeaders: Record<string, string> = {
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
  authExtras: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (authExtras.Authorization) {
    headers.Authorization = authExtras.Authorization;
  }
  return headers;
}
