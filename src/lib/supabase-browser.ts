"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { LockFunc, Session } from "@supabase/supabase-js";
import type { FetchStringHeaders } from "@/lib/supabaseAuthHeaders";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// FIX (auth hang): @supabase/auth-js acquires a per-client Web Lock
// ("lock:sb-<ref>-auth-token") with no acquire timeout. When a tab is
// backgrounded/idle and the lock is left orphaned (aborted refresh, suspended
// tab, Strict Mode unmount), every later auth call (getSession, signOut) queues
// behind the never-released lock and hangs forever — the user sees an infinite
// spinner on opening chat or signing out until a full reload recreates the
// client. Known upstream issue, unfixed as of supabase-js 2.91. A no-op lock
// disables the cross-tab serialization; NOOR is used in a single tab/session in
// practice, and the server already reconciles concurrent token refresh via
// refresh-token rotation, so the worst case is one tab re-authenticating
// (handled by getSessionSafe) rather than a deadlock.
const noOpLock: LockFunc = async (_name, _acquireTimeout, fn) => fn();

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey, {
        auth: { lock: noOpLock },
      })
    : null;

// Defense-in-depth safety net: even with the lock removed, any auth read that
// stalls must never freeze the UI. Races getSession() against a 3s timeout and
// falls back to "no session" so every caller can resolve its loading state. The
// warning also serves as a post-deploy diagnostic: if it still fires after the
// no-op lock, another cause is at play.
const GET_SESSION_TIMEOUT_MS = 3000;

export async function getSessionSafe(): Promise<Session | null> {
  if (!supabase) {
    return null;
  }
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), GET_SESSION_TIMEOUT_MS)
      ),
    ]);
    if (result === "timeout") {
      console.warn("[auth] getSession timed out; treating as no session");
      return null;
    }
    return result.data.session;
  } catch (err) {
    console.warn("[auth] getSession failed; treating as no session", err);
    return null;
  }
}

/**
 * Authorization header for API routes that validate the Supabase access token.
 */
export async function getSupabaseBearerHeaders(): Promise<FetchStringHeaders> {
  const session = await getSessionSafe();
  const token = session?.access_token;
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}
