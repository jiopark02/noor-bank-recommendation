'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ACCENT, DEMO_ACCOUNT, DEMO_TRANSACTIONS, DemoCard, DemoShell, formatMoney, useDemoToast } from '../_lib';

const CATEGORY_ICON: Record<string, string> = {
  Housing: '🏠',
  Groceries: '🛒',
  Subscriptions: '📺',
  Transport: '🚗',
  Income: '💰',
  Dining: '🍽️',
  Shopping: '🛍️',
  Utilities: '💡',
};

export default function DemoBankingPage() {
  const { show, Toast } = useDemoToast();

  return (
    <DemoShell>
      {Toast}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Banking</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(0,0,0,0.45)' }}>
          Sample account &amp; recent transactions.
        </p>
      </header>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mb-6">
        <DemoCard className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium">{DEMO_ACCOUNT.name}</p>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'rgba(0,0,0,0.4)' }}>Checking · •••• 4821</p>
          </div>
          <p className="text-2xl font-semibold">{formatMoney(DEMO_ACCOUNT.balance)}</p>
        </DemoCard>
      </motion.div>

      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        onClick={() => show('This is a demo — join the waitlist to connect a real bank account.')}
        className="w-full mb-8 px-4 py-3 rounded-xl text-[13px] font-medium"
        style={{ border: `1.5px solid ${ACCENT}`, color: ACCENT }}
      >
        + Connect another bank
      </motion.button>

      <h2 className="text-[13px] font-medium uppercase tracking-wide mb-3" style={{ color: 'rgba(0,0,0,0.4)' }}>
        Recent Transactions
      </h2>

      <motion.div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid rgba(0,0,0,0.08)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        {DEMO_TRANSACTIONS.map((txn, i) => (
          <div
            key={`${txn.name}-${i}`}
            className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.06)' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-[15px]"
                style={{ background: 'rgba(0,0,0,0.04)' }}
              >
                {CATEGORY_ICON[txn.category] || '💳'}
              </div>
              <div>
                <p className="text-[13px] font-medium">{txn.name}</p>
                <p className="text-[11px]" style={{ color: 'rgba(0,0,0,0.4)' }}>{txn.category} · {txn.date}</p>
              </div>
            </div>
            <p className={`text-[13px] font-medium ${txn.amount < 0 ? '' : 'text-gray-900'}`} style={txn.amount < 0 ? { color: ACCENT } : undefined}>
              {txn.amount < 0 ? '+' : '-'}{formatMoney(Math.abs(txn.amount))}
            </p>
          </div>
        ))}
      </motion.div>
    </DemoShell>
  );
}
