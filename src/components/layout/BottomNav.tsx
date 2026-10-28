"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/chat", label: "AI", icon: ChatIcon },
  { href: "/money", label: "Money", icon: WalletIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

// Bar geometry: it floats BAR_GAP above the bottom safe area and is BAR_HEIGHT
// tall. Anything pinned above it, and the spacer that keeps page content
// clear of it, use BOTTOM_NAV_CLEARANCE (gap + bar + 16px breathing room).
const BAR_GAP = "0.75rem";
const BAR_HEIGHT = "4rem";
export const BOTTOM_NAV_CLEARANCE = "calc(5.75rem + env(safe-area-inset-bottom))";

// Brand colour for the active tab, grey for the rest. The bar is white at 85%
// opacity over a blur. Composited over a pure black backdrop (the worst case)
// that keeps the inactive grey at 5.35:1 and the active black at 14.88:1,
// above the WCAG AA 4.5:1 for text; 0.78 is the lowest opacity that still
// clears 4.5:1 for the grey. Without backdrop-filter support the bar is opaque
// white instead.
const ACTIVE_COLOR = "#000000";
const INACTIVE_COLOR = "#4B5563";
// Written out in full: Tailwind only generates classes it finds as literal text.
const BAR_SURFACE =
  "bg-white " +
  "supports-[(backdrop-filter:blur(0px))_or_(-webkit-backdrop-filter:blur(0px))]:bg-white/85 " +
  "supports-[(backdrop-filter:blur(0px))_or_(-webkit-backdrop-filter:blur(0px))]:backdrop-blur-lg";

function isPathActive(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    (href !== "/" && pathname.startsWith(`${href}/`))
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const safePathname = pathname ?? "/dashboard";

  return (
    <>
      <div aria-hidden="true" style={{ height: BOTTOM_NAV_CLEARANCE }} />

      <nav
        aria-label="Main"
        className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none"
        style={{ bottom: `calc(${BAR_GAP} + env(safe-area-inset-bottom))` }}
      >
        <div
          className={`pointer-events-auto w-full max-w-md grid grid-cols-4 rounded-full border border-black/[0.06] shadow-[0_8px_24px_rgba(0,0,0,0.12)] ${BAR_SURFACE}`}
          style={{ height: BAR_HEIGHT }}
        >
          {NAV_ITEMS.map((item) => {
            const isActive = isPathActive(safePathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className="flex flex-col items-center justify-center gap-1 rounded-full transition-colors duration-200"
                style={{ color: isActive ? ACTIVE_COLOR : INACTIVE_COLOR }}
              >
                <Icon />
                <span
                  className={`text-[11px] leading-none tracking-wide ${
                    isActive ? "font-semibold" : "font-medium"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l9.5 8.1V21a1 1 0 01-1 1h-6v-6.5h-5V22h-6a1 1 0 01-1-1V10.6L12 2.5z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3C6.75 3 2.5 6.58 2.5 11c0 2.2 1.05 4.2 2.76 5.65L4.5 21l4.53-2.27c.95.25 1.94.37 2.97.37 5.25 0 9.5-3.58 9.5-8S17.25 3 12 3z" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 001.5 8v10A2.5 2.5 0 004 20.5h16a2.5 2.5 0 002.5-2.5v-2.5H17a3.5 3.5 0 010-7h5.5V8A2.5 2.5 0 0020 5.5H4z" />
      <path d="M17 10.5a1.5 1.5 0 000 3h5.5v-3H17z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1zM15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}
