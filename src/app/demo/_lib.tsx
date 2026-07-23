'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

export const FONT = "'SF Pro Display', 'Helvetica Neue', -apple-system, Inter, sans-serif";
export const ACCENT = '#5B4EE8';
export const ACCENT_GRADIENT = 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)';

export const MAX_DEMO_MESSAGES = 3;

// The waitlist stays on the same domain as the demo (no cross-domain jump).
export const WAITLIST_URL = '/waitlist';

const USAGE_KEY = 'noor_demo_messages_used';
const ACTIVE_KEY = 'noor_demo_active';
const USAGE_EVENT = 'noor-demo-usage-changed';

// ── Demo session / usage helpers (sessionStorage only — nothing touches Supabase or the DB) ──

export function ensureDemoSession() {
  if (typeof window === 'undefined') return;
  if (!sessionStorage.getItem(ACTIVE_KEY)) {
    sessionStorage.setItem(ACTIVE_KEY, 'true');
    sessionStorage.setItem(USAGE_KEY, '0');
  }
}

export function getDemoMessagesUsed(): number {
  if (typeof window === 'undefined') return 0;
  return Number(sessionStorage.getItem(USAGE_KEY) || '0');
}

export function incrementDemoMessagesUsed(): number {
  if (typeof window === 'undefined') return 0;
  const next = Math.min(MAX_DEMO_MESSAGES, getDemoMessagesUsed() + 1);
  sessionStorage.setItem(USAGE_KEY, String(next));
  window.dispatchEvent(new Event(USAGE_EVENT));
  return next;
}

export function useDemoMessagesRemaining(): number {
  const [used, setUsed] = useState(0);

  useEffect(() => {
    ensureDemoSession();
    setUsed(getDemoMessagesUsed());
    const onChange = () => setUsed(getDemoMessagesUsed());
    window.addEventListener(USAGE_EVENT, onChange);
    return () => window.removeEventListener(USAGE_EVENT, onChange);
  }, []);

  return Math.max(0, MAX_DEMO_MESSAGES - used);
}

// ── Toast ──────────────────────────────────────────────────────────────────

export function useDemoToast() {
  const [message, setMessage] = useState<string | null>(null);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    window.setTimeout(() => setMessage(null), 2600);
  }, []);

  const Toast = (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.22 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-full text-[13px] shadow-lg"
          style={{ background: '#000', color: '#fff', fontFamily: FONT }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return { show, Toast };
}

// ── Demo data ──────────────────────────────────────────────────────────────

export const DEMO_PROFILE = {
  firstName: 'Jordan',
  hasSsn: false,
  hasItin: false,
  university: null as string | null,
  monthlyIncome: 2400,
  monthlyBudget: 1900,
  preferredLanguage: 'English',
  email: 'demo@noor.financial',
};

export const DEMO_ACCOUNT = {
  name: 'Demo Checking',
  balance: 847.23,
};

export interface DemoTransaction {
  name: string;
  category: string;
  amount: number;
  date: string;
}

export const DEMO_TRANSACTIONS: DemoTransaction[] = [
  { name: 'Rent Payment', category: 'Housing', amount: 950, date: 'Jul 1' },
  { name: 'Trader Joe\'s', category: 'Groceries', amount: 64.12, date: 'Jul 1' },
  { name: 'Netflix', category: 'Subscriptions', amount: 15.49, date: 'Jun 29' },
  { name: 'Spotify', category: 'Subscriptions', amount: 11.99, date: 'Jun 28' },
  { name: 'Whole Foods', category: 'Groceries', amount: 41.87, date: 'Jun 27' },
  { name: 'Uber', category: 'Transport', amount: 18.40, date: 'Jun 26' },
  { name: 'Paycheck Deposit', category: 'Income', amount: -2400, date: 'Jun 25' },
  { name: 'Chipotle', category: 'Dining', amount: 13.75, date: 'Jun 24' },
  { name: 'Amazon', category: 'Shopping', amount: 52.30, date: 'Jun 23' },
  { name: 'Gym Membership', category: 'Subscriptions', amount: 29.99, date: 'Jun 22' },
  { name: 'Trader Joe\'s', category: 'Groceries', amount: 58.20, date: 'Jun 20' },
  { name: 'Electric Bill', category: 'Utilities', amount: 74.65, date: 'Jun 18' },
  { name: 'Starbucks', category: 'Dining', amount: 6.75, date: 'Jun 17' },
  { name: 'Hulu', category: 'Subscriptions', amount: 7.99, date: 'Jun 15' },
  { name: 'Target', category: 'Shopping', amount: 38.42, date: 'Jun 12' },
];

export interface DemoRecommendation {
  name: string;
  score: number;
  tag: string;
  monthlyFee: string;
  features: string[];
}

export const DEMO_RECOMMENDATIONS: DemoRecommendation[] = [
  {
    name: 'Capital One 360 Checking',
    score: 96,
    tag: 'Best for Beginners',
    monthlyFee: '$0 / mo',
    features: ['No SSN history required', 'No monthly fees', 'No minimum balance'],
  },
  {
    name: 'Chase Secure Banking',
    score: 89,
    tag: 'Fee-Sensitive Pick',
    monthlyFee: '$4.95 / mo (waivable)',
    features: ['Easy fee waiver with direct deposit', 'Zelle built in', 'Large branch network'],
  },
  {
    name: 'Varo Bank',
    score: 84,
    tag: 'Fully Digital',
    monthlyFee: '$0 / mo',
    features: ['No physical branches needed', 'Early paycheck access', 'Automatic savings tools'],
  },
];

const CANNED_ANSWERS: Array<{ keywords: string[]; answer: string }> = [
  {
    keywords: ['budget'],
    answer: "Based on your $2,400 monthly income, try the 50/30/20 rule: about $1,200 for needs, $720 for wants, and $480 for savings. Your current spending on subscriptions ($65/mo) is a good first place to trim if you want extra breathing room.",
  },
  {
    keywords: ['credit', 'score'],
    answer: "Since you don't have an SSN-linked credit history yet, start with a secured card or a bank that reports rent payments — Capital One 360 and Chase Secure Banking both work well for building credit from zero.",
  },
  {
    keywords: ['save', 'saving', 'emergency'],
    answer: "With $847 in checking and no emergency fund yet, aim for a small first milestone — $500 — before anything else. At $100/month that's 5 months, faster if you pause one subscription.",
  },
  {
    keywords: ['bank', 'account'],
    answer: "Given you don't have an SSN yet, Capital One 360 is your strongest match — no SSN history required, zero monthly fees, and no minimum balance. It's the top pick in your Recommendations tab.",
  },
  {
    keywords: ['subscription', 'spending'],
    answer: "You're spending about $65/month across Netflix, Spotify, Hulu, and your gym membership. Cutting even one frees up real room in your budget without changing your lifestyle much.",
  },
];

const DEFAULT_ANSWER =
  "Good question. In the full version, I'd pull your real transaction history and survey answers to give you a precise, personalized answer — but this demo runs on sample data. Try asking about budgeting, credit, saving, or banking.";

export function getCannedAnswer(question: string): string {
  const lower = question.toLowerCase();
  const match = CANNED_ANSWERS.find((entry) => entry.keywords.some((k) => lower.includes(k)));
  return match ? match.answer : DEFAULT_ANSWER;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

// ── Shared shell: banner + nav ──────────────────────────────────────────────

const NAV_ITEMS = [
  { href: '/demo/chat', label: 'Noor AI' },
  { href: '/demo/banking', label: 'Wallet' },
];

function GearIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <path d="M18.2 12h2.2M3.6 12h2.2M12 5.8V3.6M12 18.2v2.2M16.38 7.62l1.56-1.56M6.06 17.94l1.56-1.56M16.38 16.38l1.56 1.56M6.06 6.06l1.56 1.56" />
    </svg>
  );
}

export function DemoBanner() {
  const remaining = useDemoMessagesRemaining();
  return (
    <div
      className="w-full px-4 py-2.5 flex flex-wrap items-center justify-center gap-2 text-center"
      style={{ background: '#000', color: '#fff', fontFamily: FONT }}
    >
      <span className="text-[12.5px]">
        🔒 You&rsquo;re exploring a demo &nbsp;·&nbsp; {remaining} AI message{remaining === 1 ? '' : 's'} remaining
      </span>
      <Link
        href={WAITLIST_URL}
        className="text-[12.5px] font-medium underline underline-offset-2"
        style={{ color: '#B9AEFF' }}
      >
        Join waitlist →
      </Link>
    </div>
  );
}

export function DemoShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();

  useEffect(() => {
    ensureDemoSession();
  }, []);

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: FONT }}>
      <DemoBanner />

      <nav
        className="sticky top-0 z-40 flex items-center justify-between px-5 py-3 backdrop-blur-sm"
        style={{ background: 'rgba(255,255,255,0.92)', borderBottom: '1px solid rgba(0,0,0,0.07)' }}
      >
        <button onClick={() => router.push('/demo/chat')} className="flex items-center gap-2.5">
          <div className="w-[24px] h-[24px] rounded flex items-center justify-center" style={{ background: ACCENT_GRADIENT }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M6 0.5L11.5 6L6 11.5L0.5 6L6 0.5Z" fill="white" />
            </svg>
          </div>
          <span style={{ letterSpacing: '0.22em', fontSize: '12px', fontWeight: 600 }}>NOOR</span>
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-medium uppercase"
            style={{ letterSpacing: '0.08em', background: 'rgba(91,78,232,0.1)', color: ACCENT }}
          >
            Demo
          </span>
        </button>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-lg text-[12.5px] transition-colors"
                  style={{ color: active ? ACCENT : 'rgba(0,0,0,0.5)', background: active ? 'rgba(91,78,232,0.08)' : 'transparent' }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <span
            className="hidden sm:block w-px h-[15px]"
            style={{ background: 'rgba(0,0,0,0.1)' }}
            aria-hidden="true"
          />

          <Link
            href="/demo/settings"
            aria-label="Settings"
            className="flex items-center justify-center w-7 h-7 rounded-full transition-colors"
            style={{
              color: pathname === '/demo/settings' ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(0,0,0,0.1)',
              background: pathname === '/demo/settings'
                ? 'rgba(0,0,0,0.05)'
                : 'rgba(255,255,255,0.6)',
            }}
          >
            <GearIcon />
          </Link>
        </div>
      </nav>

      {/* Mobile nav */}
      <div className="sm:hidden flex items-center gap-1 overflow-x-auto px-3 py-2" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 rounded-lg text-[12px] whitespace-nowrap"
              style={{ color: active ? ACCENT : 'rgba(0,0,0,0.5)', background: active ? 'rgba(91,78,232,0.08)' : 'rgba(0,0,0,0.03)' }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <main className="max-w-2xl mx-auto px-5 py-8">{children}</main>
    </div>
  );
}

export function DemoCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{ border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.02)' }}
    >
      {children}
    </div>
  );
}
