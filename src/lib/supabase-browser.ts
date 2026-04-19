"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { FetchStringHeaders } from "@/lib/supabaseAuthHeaders";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey)
    : null;

/**
 * Authorization header for API routes that validate the Supabase access token.
 */
export async function getSupabaseBearerHeaders(): Promise<FetchStringHeaders> {
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
