"use client";

import React, { useEffect } from "react";
import { supabase } from "@/lib/supabase-browser";
import {
  clearPlaidLocalState,
  handleAuthEventForLocalState,
} from "@/lib/validation";

interface ClientLayoutProps {
  children: React.ReactNode;
}

/**
 * Renders its children and nothing of its own. Its only job is the two
 * browser-storage hygiene steps below, which run on every page because this
 * component sits in the root layout — /demo included, whenever the Supabase
 * browser client is configured.
 */
export function ClientLayout({ children }: ClientLayoutProps) {
  useEffect(() => {
    // SECURITY: one-time cleanup of the legacy plaintext chat mirror. The app no
    // longer writes noor_chat_history; this removes any residue left on disk for
    // users who were active before this change (and never logged out).
    localStorage.removeItem("noor_chat_history");
    // Same for bank data: the app no longer writes the Plaid keys, so drop what
    // earlier builds left, on every page and not only the dashboard.
    clearPlaidLocalState();

    // SECURITY: purge local chat/profile state on sign-out so a shared device
    // doesn't retain a prior user's plaintext financial chats. Covers other-tab
    // logout and a sign-out the auth library performs itself, which the
    // in-page logout handlers alone miss.
    const { data: authListener } = supabase?.auth.onAuthStateChange(
      (event) => {
        handleAuthEventForLocalState(event);
      }
    ) || { data: { subscription: null } };

    return () => {
      authListener.subscription?.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}
