'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  WAITLIST_URL,
  DEMO_PROFILE,
  DemoCard,
  DemoShell,
  DemoButton,
  DEMO_BUTTON_CLASS,
  demoButtonStyle,
  INK,
  LINE,
  SURFACE,
  useDemoToast,
} from '../_lib';

export default function DemoSettingsPage() {
  const { show, Toast } = useDemoToast();
  const [firstName, setFirstName] = useState(DEMO_PROFILE.firstName);
  const [income, setIncome] = useState(String(DEMO_PROFILE.monthlyIncome));
  const [budget, setBudget] = useState(String(DEMO_PROFILE.monthlyBudget));

  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label className="block text-[11.5px] mb-1.5" style={{ color: INK.muted }}>{label}</label>
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
        <p className="text-sm mt-1" style={{ color: INK.muted }}>
          Viewable in demo mode — changes aren&rsquo;t saved anywhere.
        </p>
      </header>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <DemoCard className="flex flex-col gap-4 mb-6">
          {field('First name', firstName, setFirstName)}
          {field('Monthly income', income, setIncome)}
          {field('Monthly budget', budget, setBudget)}

          <div>
            <label className="block text-[11.5px] mb-1.5" style={{ color: INK.muted }}>Email</label>
            <input
              value={DEMO_PROFILE.email}
              disabled
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm"
              style={{ background: SURFACE.subtle, color: INK.muted }}
            />
          </div>

          <div className="flex items-center justify-between text-[12.5px] pt-2" style={{ borderTop: `1px solid ${LINE.hairline}` }}>
            <span style={{ color: INK.muted }}>SSN on file</span>
            <span className="font-medium">{DEMO_PROFILE.hasSsn ? 'Yes' : 'Not yet'}</span>
          </div>

          <DemoButton
            variant="solid"
            onClick={() => show('Saved (demo only — nothing was actually persisted)')}
            className="mt-2 self-start"
          >
            Save changes
          </DemoButton>
        </DemoCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
        <DemoCard className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium">Ready for the real thing?</p>
            <p className="text-[11.5px] mt-0.5" style={{ color: INK.muted }}>
              Join the waitlist to save your real profile and data.
            </p>
          </div>
          <a
            href={WAITLIST_URL}
            className={`${DEMO_BUTTON_CLASS} whitespace-nowrap`}
            style={demoButtonStyle('glass')}
          >
            Join waitlist
          </a>
        </DemoCard>
      </motion.div>
    </DemoShell>
  );
}
