import { NextRequest } from "next/server";
import { createServerClient, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Resolve the authenticated Supabase user id from a Bearer access token.
 * Do not trust client-supplied userId in body or query string.
 */
export async function getAuthenticatedUserIdFromRequest(
  request: NextRequest
): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    return null;
  }

  try {
    const supabase = createServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    return user.id;
  } catch {
    return null;
  }
}
