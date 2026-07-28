"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function isPathActive(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    (href !== "/" && pathname.startsWith(`${href}/`))
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const safePathname = pathname ?? "/dashboard";

  const activeColor = "#1A1A1A";
  const inactiveColor = "#A9A4C2";

  const isWalletActive = isPathActive(safePathname, "/dashboard");
  const isAiActive = isPathActive(safePathname, "/chat");

  return (
    <>
      <div className="h-24" />

      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200"
        style={{
          background: "#FFFFFF",
        }}
      >
        <div className="max-w-2xl mx-auto px-6">
          <div className="flex items-center justify-between h-20">
            <Link
              href="/dashboard"
              className="flex flex-col items-center justify-center gap-1.5 px-4 py-2 rounded-xl transition-all duration-300 min-w-[72px]"
              style={{ color: isWalletActive ? activeColor : inactiveColor }}
            >
              <WalletIcon active={isWalletActive} activeColor={activeColor} />
              <span
                className={`text-[10px] tracking-wide ${
                  isWalletActive ? "font-medium" : ""
                }`}
              >
                Wallet
              </span>
            </Link>

            <Link
              href="/chat"
              className="flex flex-col items-center justify-center gap-1.5 px-4 py-2 rounded-xl transition-all duration-300 min-w-[72px]"
              style={{ color: isAiActive ? activeColor : inactiveColor }}
            >
              <AiTabIcon active={isAiActive} activeColor={activeColor} />
              <span
                className={`text-[10px] tracking-wide ${
                  isAiActive ? "font-medium" : ""
                }`}
              >
                AI
              </span>
            </Link>
          </div>
        </div>

        <div className="h-safe-bottom" />
      </nav>
    </>
  );
}

interface IconProps {
  active?: boolean;
  activeColor?: string;
}

function AiTabIcon({ active }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 1.75 : 1.25}
    >
      <path
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WalletIcon({ active }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 1.75 : 1.25}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 6v12M9 9h4.5a1.5 1.5 0 010 3H9h5.5a1.5 1.5 0 110 3H9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
