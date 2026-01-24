'use client';

import React from 'react';
import { NoorAIChat } from '@/components/chat';

interface ClientLayoutProps {
  children: React.ReactNode;
}

export function ClientLayout({ children }: ClientLayoutProps) {
  return (
    <>
      {children}
      <NoorAIChat />
    </>
  );
}
