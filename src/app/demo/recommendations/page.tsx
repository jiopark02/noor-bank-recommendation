'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ACCENT, DEMO_RECOMMENDATIONS, DemoCard, DemoShell, useDemoToast } from '../_lib';

export default function DemoRecommendationsPage() {
  const [expanded, setExpanded] = useState<string | null>(DEMO_RECOMMENDATIONS[0]?.name ?? null);
  const { show, Toast } = useDemoToast();

  return (
    <DemoShell>
      {Toast}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Bank Recommendations</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(0,0,0,0.45)' }}>
          Matched to your sample profile — no SSN yet, fee-sensitive, just getting started.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {DEMO_RECOMMENDATIONS.map((bank, i) => {
          const isOpen = expanded === bank.name;
          return (
            <motion.div key={bank.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.06 }}>
              <DemoCard>
                <button className="w-full flex items-center justify-between text-left" onClick={() => setExpanded(isOpen ? null : bank.name)}>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[14px] font-semibold">{bank.name}</span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{ background: 'rgba(91,78,232,0.1)', color: ACCENT }}
                      >
                        {bank.tag}
                      </span>
                    </div>
                    <p className="text-[11.5px]" style={{ color: 'rgba(0,0,0,0.4)' }}>{bank.monthlyFee}</p>
                  </div>
                  <span className="text-[16px] font-semibold tabular-nums" style={{ color: ACCENT }}>{bank.score}%</span>
                </button>

                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 pt-4"
                    style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}
                  >
                    <ul className="space-y-1.5 mb-4">
                      {bank.features.map((f) => (
                        <li key={f} className="text-[12.5px] flex items-start gap-2" style={{ color: 'rgba(0,0,0,0.6)' }}>
                          <span style={{ color: ACCENT }}>✓</span> {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => show('This is a demo — join the waitlist to open a real account.')}
                      className="px-4 py-2 rounded-lg text-[12.5px] font-medium text-white"
                      style={{ background: ACCENT }}
                    >
                      Open account
                    </button>
                  </motion.div>
                )}
              </DemoCard>
            </motion.div>
          );
        })}
      </div>
    </DemoShell>
  );
}
