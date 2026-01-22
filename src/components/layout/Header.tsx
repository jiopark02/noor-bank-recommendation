'use client';

import React from 'react';
import Link from 'next/link';

interface HeaderProps {
  userName?: string;
}

export function Header({ userName = 'there' }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="text-base tracking-[0.25em] font-medium text-black transition-opacity duration-300 hover:opacity-60"
        >
          NOOR
        </Link>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button className="p-2.5 hover:bg-gray-50 rounded-xl transition-all duration-300">
            <SearchIcon />
          </button>
          <button className="p-2.5 hover:bg-gray-50 rounded-xl transition-all duration-300">
            <NotificationIcon />
          </button>
        </div>
      </div>
    </header>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
