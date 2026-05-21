"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ComponentType<IconProps>;
}

const INTL_VISA_PATTERNS = ["F-1", "F1", "J-1", "J1", "M-1", "M1", "F-2", "J-2"];

function resolveVisaTypeFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("noor_user_profile");
    if (!raw) return null;
    const profile = JSON.parse(raw) as Record<string, unknown>;
    const candidate =
      profile.visaType ??
      profile.visa_type ??
      profile.visa_status ??
      profile.visaStatus;
    return typeof candidate === "string" && candidate.trim()
      ? candidate.trim()
      : null;
  } catch {
    return null;
  }
}

function isInternationalVisa(visaType: string | null): boolean {
  if (!visaType) return false;
  const upper = visaType.toUpperCase();
  return INTL_VISA_PATTERNS.some(
    (pattern) =>
      upper.includes(pattern.toUpperCase()) ||
      upper.replace(/\s/g, "").includes(pattern.replace(/-/g, "").toUpperCase())
  );
}

function buildMoreMenuGroups(showIntlOnly: boolean): {
  title: string;
  items: NavItem[];
}[] {
  const finance: NavItem[] = [
    { href: "/banking", labelKey: "nav.banking", icon: BankingIcon },
    { href: "/grow", labelKey: "nav.grow", icon: GrowIcon },
    ...(showIntlOnly
      ? [{ href: "/visa", labelKey: "nav.visa", icon: VisaIcon }]
      : []),
    { href: "/money", labelKey: "nav.money", icon: MoneyIcon },
  ];

  const life: NavItem[] = [
    { href: "/housing", labelKey: "nav.housing", icon: HousingIcon },
    { href: "/jobs", labelKey: "nav.jobs", icon: JobsIcon },
    { href: "/funding", labelKey: "nav.funding", icon: FundingIcon },
    { href: "/deals", labelKey: "nav.deals", icon: DealsIcon },
    ...(showIntlOnly
      ? [{ href: "/guides", labelKey: "nav.guides", icon: GuidesIcon }]
      : []),
  ];

  const settings: NavItem[] = [
    { href: "/settings", labelKey: "common.settings", icon: SettingsIcon },
  ];

  return [
    { title: "Finance", items: finance },
    { title: "Life", items: life },
    { title: "Settings", items: settings },
  ];
}

function isPathActive(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    (href !== "/" && pathname.startsWith(`${href}/`))
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const safePathname = pathname ?? "/";
  const { theme, useSchoolTheme } = useTheme();
  const { t } = useLanguage();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [visaType, setVisaType] = useState<string | null>(null);

  useEffect(() => {
    setVisaType(resolveVisaTypeFromStorage());
  }, [safePathname, isMoreOpen]);

  const showIntlMenu = isInternationalVisa(visaType);
  const moreMenuGroups = useMemo(
    () => buildMoreMenuGroups(showIntlMenu),
    [showIntlMenu]
  );

  const allMoreItems = useMemo(
    () => moreMenuGroups.flatMap((g) => g.items),
    [moreMenuGroups]
  );

  const activeColor = useSchoolTheme ? theme.primary_color : "#000000";
  const inactiveColor = "#9CA3AF";

  const isMoreActive =
    allMoreItems.some((item) => isPathActive(safePathname, item.href)) ||
    isMoreOpen;

  const isHomeActive = isPathActive(safePathname, "/");

  return (
    <>
      <div className="h-24" />

      <AnimatePresence>
        {isMoreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setIsMoreOpen(false)}
            />

            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 pb-24 max-h-[85vh] overflow-y-auto"
            >
              <div className="p-4">
                <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

                <div className="flex items-center justify-between mb-4 px-2">
                  <h3 className="text-lg font-medium text-gray-900">More</h3>
                  <button
                    type="button"
                    onClick={() => setIsMoreOpen(false)}
                    className="p-2 rounded-full hover:bg-gray-100"
                    aria-label="Close menu"
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#6B7280"
                      strokeWidth="2"
                    >
                      <path
                        d="M18 6L6 18M6 6l12 12"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>

                <div className="space-y-6">
                  {moreMenuGroups.map((group) => (
                    <div key={group.title}>
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider px-2 mb-2">
                        {group.title}
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        {group.items.map((item) => {
                          const isActive = isPathActive(safePathname, item.href);
                          const Icon = item.icon;

                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => setIsMoreOpen(false)}
                              className="flex flex-col items-center justify-center p-4 rounded-2xl transition-all"
                              style={{
                                backgroundColor: isActive
                                  ? `${activeColor}10`
                                  : "#F9FAFB",
                                color: isActive ? activeColor : "#4B5563",
                              }}
                            >
                              <Icon
                                active={isActive}
                                activeColor={activeColor}
                              />
                              <span
                                className={`text-xs mt-2 text-center ${
                                  isActive ? "font-medium" : ""
                                }`}
                              >
                                {t(item.labelKey)}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 z-50">
        <div className="max-w-2xl mx-auto px-6">
          <div className="flex items-center justify-between h-20">
            <Link
              href="/"
              className="flex flex-col items-center justify-center gap-1.5 px-4 py-2 rounded-xl transition-all duration-300 min-w-[72px]"
              style={{ color: isHomeActive ? activeColor : inactiveColor }}
            >
              <HomeIcon active={isHomeActive} activeColor={activeColor} />
              <span
                className={`text-[10px] tracking-wide ${
                  isHomeActive ? "font-medium" : ""
                }`}
              >
                {t("nav.home")}
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              className="flex flex-col items-center justify-center gap-1.5 px-4 py-2 rounded-xl transition-all duration-300 min-w-[72px]"
              style={{
                color: isMoreActive ? activeColor : inactiveColor,
              }}
              aria-expanded={isMoreOpen}
              aria-label="Open more menu"
            >
              <MoreIcon
                active={isMoreActive}
                activeColor={activeColor}
              />
              <span
                className={`text-[10px] tracking-wide ${
                  isMoreActive ? "font-medium" : ""
                }`}
              >
                More
              </span>
            </button>
          </div>
        </div>

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
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 1.75 : 1.25}
    >
      <path
        d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 22V12h6v10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BankingIcon({ active }: IconProps) {
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
        d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HousingIcon({ active }: IconProps) {
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
        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="9"
        r="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VisaIcon({ active }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 1.75 : 1.25}
    >
      <rect
        x="2"
        y="4"
        width="20"
        height="16"
        rx="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M2 10h20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 16h4M14 16h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GrowIcon({ active }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 1.75 : 1.25}
    >
      <path d="M12 20V10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 20V4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 20v-4" strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx="12"
        cy="6"
        r="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 8c-1.5.5-3 2-3 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 8c1.5.5 3 2 3 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon({ active }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 1.75 : 1.25}
    >
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function JobsIcon({ active }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 1.75 : 1.25}
    >
      <rect
        x="2"
        y="7"
        width="20"
        height="14"
        rx="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FundingIcon({ active }: IconProps) {
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
        d="M22 10v6M2 10l10-5 10 5-10 5-10-5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 12v5c3 3 9 3 12 0v-5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DealsIcon({ active }: IconProps) {
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
        d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </svg>
  );
}

function SettingsIcon({ active }: IconProps) {
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
        r="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoneyIcon({ active }: IconProps) {
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

function GuidesIcon({ active }: IconProps) {
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
        d="M4 19.5A2.5 2.5 0 016.5 17H20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 7h8M8 11h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
