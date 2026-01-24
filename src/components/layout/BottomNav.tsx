'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/contexts/ThemeContext';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/banking', label: 'Banking', icon: BankingIcon },
  { href: '/housing', label: 'Housing', icon: HousingIcon },
  { href: '/funding', label: 'Funding', icon: FundingIcon },
  { href: '/forum', label: 'Forum', icon: ForumIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  const { theme, useSchoolTheme } = useTheme();

  const activeColor = useSchoolTheme ? theme.primary_color : '#000000';
  const inactiveColor = '#9CA3AF';

  return (
    <>
      {/* Spacer for fixed bottom nav */}
      <div className="h-24" />

      {/* Fixed bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 z-50">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center justify-around h-20">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href));
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex flex-col items-center justify-center gap-1.5 px-3 py-2 rounded-xl transition-all duration-300"
                  style={{ color: isActive ? activeColor : inactiveColor }}
                >
                  <Icon active={isActive} activeColor={activeColor} />
                  <span
                    className={`text-[10px] tracking-wide ${isActive ? 'font-medium' : ''}`}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Safe area padding for iOS */}
        <div className="h-safe-bottom bg-white" />
      </nav>
    </>
  );
}

interface IconProps {
  active?: boolean;
  activeColor?: string;
}

function HomeIcon({ active, activeColor }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 22V12h6v10" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function BankingIcon({ active, activeColor }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function HousingIcon({ active, activeColor }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="9" r="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function VisaIcon({ active, activeColor }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <rect x="2" y="4" width="20" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 10h20" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 16h4M14 16h4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function FundingIcon({ active, activeColor }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 12v5c3 3 9 3 12 0v-5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ForumIcon({ active, activeColor }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
