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
