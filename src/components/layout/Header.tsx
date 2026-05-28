'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { getSchoolTheme, hasCustomTheme } from '@/lib/schoolThemes';
import { SearchModal } from '@/components/search';

interface HeaderProps {
  userName?: string;
}

export function Header({ userName = 'there' }: HeaderProps) {
  const { theme, useSchoolTheme } = useTheme();
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      const parsed = JSON.parse(profile);
      if (parsed.institutionId) {
        setInstitutionId(parsed.institutionId);
      }
    }
  }, []);

  const schoolTheme = institutionId ? getSchoolTheme(institutionId) : null;
  const showSchoolBranding = useSchoolTheme && schoolTheme && hasCustomTheme(institutionId || '');

  return (
    <>
      <header
        className="sticky top-0 z-40 backdrop-blur-sm border-b"
        style={{
          backgroundColor: showSchoolBranding
            ? `${theme.primary_color}F5`
            : 'rgba(255, 255, 255, 0.95)',
          borderColor: showSchoolBranding
            ? `${theme.secondary_color}40`
            : 'rgb(243, 244, 246)',
        }}
      >
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
          {/* Logo Section */}
          <Link href="/" className="flex flex-col items-start">
            <span
              className="text-base tracking-[0.25em] font-medium transition-opacity duration-300 hover:opacity-60"
              style={{
                color: showSchoolBranding
                  ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000')
                  : '#000000',
              }}
            >
              NOOR
            </span>
            {showSchoolBranding && schoolTheme && (
              <div className="flex items-center gap-1.5 mt-0.5">
                {schoolTheme.logo_url && schoolTheme.logo_url.startsWith('http') ? (
                  <img
                    src={schoolTheme.logo_url}
                    alt={schoolTheme.short_name}
                    className="w-4 h-4 rounded-full object-contain"
                    style={{ backgroundColor: theme.secondary_color }}
                    onError={(e) => {
                      // Fallback to letter if image fails
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className="w-4 h-4 rounded-full items-center justify-center text-[8px] font-bold"
                  style={{
                    backgroundColor: theme.secondary_color,
                    color: theme.primary_color,
                    display: schoolTheme.logo_url && schoolTheme.logo_url.startsWith('http') ? 'none' : 'flex',
                  }}
                >
                  {schoolTheme.short_name.charAt(0)}
                </div>
                <span
                  className="text-[10px] tracking-wide"
                  style={{
                    color: showSchoolBranding
                      ? (theme.text_on_primary === 'white' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)')
                      : '#6B7280',
                  }}
                >
                  {schoolTheme.short_name}
                </span>
              </div>
            )}
          </Link>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsSearchOpen(true)}
              className="p-2.5 rounded-xl transition-all duration-300 hover:bg-black/5"
              style={{
                color: showSchoolBranding
                  ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000')
                  : '#000000',
              }}
            >
              <SearchIcon />
            </button>
            <button
              className="p-2.5 rounded-xl transition-all duration-300 hover:bg-black/5"
              style={{
                color: showSchoolBranding
                  ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000')
                  : '#000000',
              }}
            >
              <NotificationIcon />
            </button>
            <Link
              href="/settings"
              className="p-2.5 rounded-xl transition-all duration-300 hover:bg-black/5"
              style={{
                color: showSchoolBranding
                  ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000')
                  : '#000000',
              }}
            >
              <SettingsIcon />
            </Link>
          </div>
        </div>
      </header>

      {/* Search Modal */}
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </>
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

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
