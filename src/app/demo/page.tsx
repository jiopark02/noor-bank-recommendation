'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { FONT, ACCENT, ACCENT_GRADIENT, ensureDemoSession } from './_lib';

const STEPS = [
  'Creating your demo session…',
  'Loading sample profile…',
  'Generating bank recommendations…',
];

export default function DemoEntryPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    ensureDemoSession();

    const stepTimer = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
    }, 380);

    const redirectTimer = setTimeout(() => {
      router.push('/demo/chat');
    }, 1200);

    return () => {
      clearInterval(stepTimer);
      clearTimeout(redirectTimer);
    };
  }, [router]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-white text-black px-6"
      style={{ fontFamily: FONT }}
    >
      <motion.div
        className="w-12 h-12 rounded-xl mb-8"
        style={{ background: ACCENT_GRADIENT }}
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      />
      <p className="text-[13px]" style={{ color: 'rgba(0,0,0,0.5)' }}>
        {STEPS[stepIndex]}
      </p>
      <div className="mt-6 w-48 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: ACCENT }}
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 1.15, ease: 'easeInOut' }}
        />
      </div>
    </div>
  );
}
