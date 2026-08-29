import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Browser client: import from @/lib/supabase-browser (cookie-based session for middleware).

// Next.js 14.2.x patches the global fetch and routes it through the Data Cache.
// This only bites route handlers that export GET/HEAD and nothing else: Next leaves
// the store at `revalidate = false` for them, so outbound fetches are cached (up to a
// year) and the handler can return a stale Supabase response. `export const dynamic =
// "force-dynamic"` does NOT opt those fetches out — it only sets `forceDynamic`
// (vercel/next.js#65170). Routes that also export POST/PATCH/DELETE/OPTIONS are set to
// `revalidate = 0`, which together with the Authorization header supabase-js always
// sends puts them on Next's "auto no cache" path already; there this option is a no-op.
// Forcing `cache: "no-store"` on the client's own fetch is the opt-out that applies in
// both cases. The `init` object is handed on unchanged (method, headers, body, signal);
// the outgoing request is not byte-identical though, because the runtime then adds
// `pragma: no-cache` and `cache-control: no-cache` headers, which PostgREST and GoTrue
// ignore.
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

// Server-side client (uses service role key if available, falls back to anon key)
export function createServerClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase URL and anon key are required");
  }

  const key = supabaseServiceKey || supabaseAnonKey;

  return createClient(supabaseUrl, key, {
    global: { fetch: noStoreFetch },
  });
}

// Server-side admin client (requires service role key)
export function createAdminClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Supabase URL and service role key are required for admin operations"
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    global: { fetch: noStoreFetch },
  });
}

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseServiceKey);
}
