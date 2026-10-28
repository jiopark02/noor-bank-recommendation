'use client';

import React from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';

interface PageLayoutProps {
  children: React.ReactNode;
  userName?: string;
}

export function PageLayout({ children, userName }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-white">
      <Header userName={userName} />
      <main className="max-w-2xl mx-auto px-6 py-8">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
