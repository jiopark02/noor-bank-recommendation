'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { FONT, GRADIENT, SURFACE, INK, LINE, ensureDemoSession } from './_lib';

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
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ fontFamily: FONT, background: '#FFFFFF', color: INK.primary }}
    >
      <motion.div
        className="w-12 h-12 rounded-xl mb-8"
        style={{ background: GRADIENT.mark }}
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      />
      <p className="text-[13px]" style={{ color: INK.secondary }}>
        {STEPS[stepIndex]}
      </p>
      <div className="mt-6 w-48 h-1 rounded-full overflow-hidden" style={{ background: LINE.default }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: SURFACE.solid }}
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 1.15, ease: 'easeInOut' }}
        />
      </div>
    </div>
  );
}
