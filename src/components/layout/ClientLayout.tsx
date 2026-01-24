'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { NoorAIChat } from '@/components/chat';

interface ClientLayoutProps {
  children: React.ReactNode;
}

// Pages where the chat button should not appear
const HIDDEN_CHAT_PAGES = ['/welcome', '/survey', '/login'];

export function ClientLayout({ children }: ClientLayoutProps) {
  const pathname = usePathname();
  const [isOnboarded, setIsOnboarded] = useState(false);

  useEffect(() => {
    // Check if user has completed onboarding
    const userId = localStorage.getItem('noor_user_id');
    setIsOnboarded(!!userId);
  }, []);

  const shouldShowChat = isOnboarded && !HIDDEN_CHAT_PAGES.includes(pathname);

  return (
    <>
      {children}
      {shouldShowChat && <NoorAIChat />}
    </>
  );
}
