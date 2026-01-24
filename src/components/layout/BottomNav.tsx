'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';

// Main navigation items (shown in bottom bar)
const MAIN_NAV_ITEMS = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/banking', label: 'Banking', icon: BankingIcon },
  { href: '/housing', label: 'Housing', icon: HousingIcon },
  { href: '/visa', label: 'Visa', icon: VisaIcon },
];

// More menu items (shown in slide-up panel)
const MORE_NAV_ITEMS = [
  { href: '/jobs', label: 'Jobs', icon: JobsIcon, description: 'Find part-time jobs' },
  { href: '/funding', label: 'Funding', icon: FundingIcon, description: 'Scholarships & Grants' },
  { href: '/forum', label: 'Forum', icon: ForumIcon, description: 'Community discussions' },
  { href: '/deals', label: 'Deals', icon: DealsIcon, description: 'Student discounts' },
  { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon, description: 'Financial overview' },
  { href: '/transfer', label: 'Transfer', icon: TransferIcon, description: 'CC transfer planning' },
];

export function BottomNav() {
  const pathname = usePathname();
  const { theme, useSchoolTheme } = useTheme();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const activeColor = useSchoolTheme ? theme.primary_color : '#000000';
  const inactiveColor = '#9CA3AF';

  // Check if current path is in the "More" menu
  const isMoreActive = MORE_NAV_ITEMS.some(
    item => pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
  );

  return (
    <>
      {/* Spacer for fixed bottom nav */}
      <div className="h-24" />

      {/* More Menu Overlay */}
      <AnimatePresence>
        {isMoreOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setIsMoreOpen(false)}
            />

            {/* Slide-up Panel */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 pb-24"
            >
              <div className="p-4">
                {/* Handle */}
                <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

                {/* Header */}
                <div className="flex items-center justify-between mb-4 px-2">
                  <h3 className="text-lg font-medium text-gray-900">More</h3>
                  <button
                    onClick={() => setIsMoreOpen(false)}
                    className="p-2 rounded-full hover:bg-gray-100"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                {/* Grid of items */}
                <div className="grid grid-cols-3 gap-3">
                  {MORE_NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href ||
                      (item.href !== '/' && pathname.startsWith(item.href));
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsMoreOpen(false)}
                        className="flex flex-col items-center justify-center p-4 rounded-2xl transition-all"
                        style={{
                          backgroundColor: isActive ? `${activeColor}10` : '#F9FAFB',
                          color: isActive ? activeColor : '#4B5563',
                        }}
                      >
                        <Icon active={isActive} activeColor={activeColor} />
                        <span className={`text-xs mt-2 ${isActive ? 'font-medium' : ''}`}>
                          {item.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Fixed bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 z-50">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center justify-around h-20">
            {MAIN_NAV_ITEMS.map((item) => {
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

            {/* More Button */}
            <button
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              className="flex flex-col items-center justify-center gap-1.5 px-3 py-2 rounded-xl transition-all duration-300"
              style={{ color: isMoreActive || isMoreOpen ? activeColor : inactiveColor }}
            >
              <MoreIcon active={isMoreActive || isMoreOpen} activeColor={activeColor} />
              <span
                className={`text-[10px] tracking-wide ${isMoreActive || isMoreOpen ? 'font-medium' : ''}`}
              >
                More
              </span>
            </button>
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

function HomeIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 22V12h6v10" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function BankingIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function HousingIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="9" r="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function VisaIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <rect x="2" y="4" width="20" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 10h20" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 16h4M14 16h4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function MoreIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function JobsIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <rect x="2" y="7" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function FundingIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 12v5c3 3 9 3 12 0v-5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ForumIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function DealsIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </svg>
  );
}

function DashboardIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <rect x="3" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="14" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="3" y="14" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="14" y="14" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TransferIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.75 : 1.25}>
      <path d="M17 1l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 11V9a4 4 0 014-4h14" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7 23l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M21 13v2a4 4 0 01-4 4H3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
