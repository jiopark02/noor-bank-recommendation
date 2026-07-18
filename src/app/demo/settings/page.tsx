'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ACCENT, DEMO_PROFILE, DemoCard, DemoShell, useDemoToast } from '../_lib';

export default function DemoSettingsPage() {
  const { show, Toast } = useDemoToast();
  const [firstName, setFirstName] = useState(DEMO_PROFILE.firstName);
  const [income, setIncome] = useState(String(DEMO_PROFILE.monthlyIncome));
  const [budget, setBudget] = useState(String(DEMO_PROFILE.monthlyBudget));

  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label className="block text-[11.5px] mb-1.5" style={{ color: 'rgba(0,0,0,0.45)' }}>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black"
      />
    </div>
  );

  return (
    <DemoShell>
      {Toast}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(0,0,0,0.45)' }}>
          Viewable in demo mode — changes aren&rsquo;t saved anywhere.
        </p>
      </header>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <DemoCard className="flex flex-col gap-4 mb-6">
          {field('First name', firstName, setFirstName)}
          {field('Monthly income', income, setIncome)}
          {field('Monthly budget', budget, setBudget)}

          <div>
            <label className="block text-[11.5px] mb-1.5" style={{ color: 'rgba(0,0,0,0.45)' }}>Email</label>
            <input
              value={DEMO_PROFILE.email}
              disabled
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-gray-400"
            />
          </div>

          <div className="flex items-center justify-between text-[12.5px] pt-2" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ color: 'rgba(0,0,0,0.45)' }}>SSN on file</span>
            <span className="font-medium">{DEMO_PROFILE.hasSsn ? 'Yes' : 'Not yet'}</span>
          </div>

          <button
            onClick={() => show('Saved (demo only — nothing was actually persisted)')}
            className="mt-2 px-5 py-2.5 rounded-xl text-[13px] font-medium text-white self-start"
            style={{ background: ACCENT }}
          >
            Save changes
          </button>
        </DemoCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
        <DemoCard className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium">Ready for the real thing?</p>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'rgba(0,0,0,0.4)' }}>
              Join the waitlist to save your real profile and data.
            </p>
          </div>
          <Link
            href="/waitlist"
            className="px-4 py-2 rounded-lg text-[12.5px] font-medium text-white whitespace-nowrap"
            style={{ background: ACCENT }}
          >
            Join waitlist
          </Link>
        </DemoCard>
      </motion.div>
    </DemoShell>
  );
}
