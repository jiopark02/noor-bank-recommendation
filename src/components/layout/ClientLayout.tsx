"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { NoorAIChat } from "@/components/chat";
import { supabase } from "@/lib/supabase-browser";
import { clearLocalAuthState } from "@/lib/validation";

interface ClientLayoutProps {
  children: React.ReactNode;
}

// Pages where the chat button should not appear
const HIDDEN_CHAT_PAGES = [
  "/landing",
  "/welcome",
  "/survey",
  "/login",
  "/chat",
  "/forgot-password",
  "/auth/callback",
];

export function ClientLayout({ children }: ClientLayoutProps) {
  const pathname = usePathname();
  const safePathname = pathname ?? "";
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasLocalSession, setHasLocalSession] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const syncSession = async () => {
      if (!supabase) {
        if (isMounted) {
          setIsAuthenticated(false);
          setIsAuthReady(true);
        }
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (isMounted) {
        setIsAuthenticated(Boolean(session?.user));
        setIsAuthReady(true);
      }
    };

    setHasLocalSession(Boolean(localStorage.getItem("noor_user_id")));
    // SECURITY: one-time cleanup of the legacy plaintext chat mirror. The app no
    // longer writes noor_chat_history; this removes any residue left on disk for
    // users who were active before this change (and never logged out).
    localStorage.removeItem("noor_chat_history");
    syncSession();

    const { data: authListener } = supabase?.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        setIsAuthenticated(Boolean(session?.user));
        setIsAuthReady(true);
        // SECURITY: purge local chat/profile state on sign-out so a shared
        // device doesn't retain a prior user's plaintext financial chats.
        // Covers other-tab logout and token expiry, which settings'
        // handleLogout alone misses.
        if (event === "SIGNED_OUT") {
          clearLocalAuthState();
        }
      }
    ) || { data: { subscription: null } };

    return () => {
      isMounted = false;
      authListener.subscription?.unsubscribe();
    };
  }, []);

  const shouldShowChat =
    isAuthReady &&
    isAuthenticated &&
    hasLocalSession &&
    !HIDDEN_CHAT_PAGES.includes(safePathname);

  return (
    <>
      {children}
      {shouldShowChat && <NoorAIChat />}
    </>
  );
}
