'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ACCENT,
  DEMO_ACCOUNT,
  DEMO_PROFILE,
  DEMO_TRANSACTIONS,
  DemoCard,
  DemoShell,
  formatMoney,
} from '../_lib';

const QUICK_PROMPTS = ['How much can I spend this week?', 'Am I on track this month?'];

export default function DemoDashboardPage() {
  const router = useRouter();
  const [promptDraft, setPromptDraft] = useState('');

  const metrics = useMemo(() => {
    const spending = DEMO_TRANSACTIONS.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const income = DEMO_TRANSACTIONS.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const subscriptions = DEMO_TRANSACTIONS.filter((t) => t.category === 'Subscriptions').reduce(
      (sum, t) => sum + t.amount,
      0
    );
    return { spending, income, subscriptions };
  }, []);

  const goToChat = (prompt?: string) => {
    if (prompt) sessionStorage.setItem('noor_demo_quick_prompt', prompt);
    router.push('/demo/chat');
  };

  return (
    <DemoShell>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {DEMO_PROFILE.firstName}</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(0,0,0,0.45)' }}>
          Here&rsquo;s your money overview — sample data for the demo.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <DemoCard>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold">AI Assistant</h2>
              <button
                onClick={() => goToChat()}
                className="text-[12px] px-3 py-1.5 rounded-lg"
                style={{ color: ACCENT, background: 'rgba(91,78,232,0.08)' }}
              >
                Open full chat
              </button>
            </div>
            <div className="space-y-3 mb-5">
              <div className="rounded-2xl bg-gray-100 px-4 py-3 max-w-[92%]">
                <p className="text-sm text-gray-700 leading-relaxed">
                  Good day, {DEMO_PROFILE.firstName}. Based on your $2,400 income and $1,900 budget, you&rsquo;re on
                  track this month — try keeping a $150+ buffer for savings.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => goToChat(prompt)}
                  className="px-4 py-2 rounded-full text-xs border border-gray-200 text-gray-700 hover:border-gray-300 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') goToChat(promptDraft || undefined);
                }}
                placeholder="Ask about your money..."
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black"
              />
              <button
                onClick={() => goToChat(promptDraft || undefined)}
                className="w-11 h-11 rounded-xl text-white flex items-center justify-center"
                style={{ background: ACCENT }}
                aria-label="Open chat"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </button>
            </div>
          </DemoCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
          <DemoCard>
            <p className="text-sm" style={{ color: 'rgba(0,0,0,0.45)' }}>{DEMO_ACCOUNT.name} balance</p>
            <p className="text-4xl font-semibold mb-4">{formatMoney(DEMO_ACCOUNT.balance)}</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs" style={{ color: 'rgba(0,0,0,0.4)' }}>Income (30d)</p>
                <p className="text-lg font-medium" style={{ color: ACCENT }}>+{formatMoney(metrics.income)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'rgba(0,0,0,0.4)' }}>Spending (30d)</p>
                <p className="text-lg font-medium text-red-600">-{formatMoney(metrics.spending)}</p>
              </div>
            </div>
          </DemoCard>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          {[
            { href: '/demo/banking', label: 'Banking', desc: 'Account & transactions' },
            { href: '/demo/recommendations', label: 'Recommendations', desc: 'Your top bank matches' },
            { href: '/demo/settings', label: 'Settings', desc: 'Profile & preferences' },
          ].map((item) => (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className="text-left rounded-2xl p-4 transition-colors hover:border-black"
              style={{ border: '1px solid rgba(0,0,0,0.08)' }}
            >
              <div className="text-[13px] font-medium">{item.label}</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(0,0,0,0.4)' }}>{item.desc}</div>
            </button>
          ))}
        </motion.div>
      </div>
    </DemoShell>
  );
}
