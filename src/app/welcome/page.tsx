'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

export default function WelcomePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            {/* Simple Logo */}
            <div className="mb-12">
              <h1
                className="text-2xl tracking-[0.3em] font-semibold text-black"
                style={{ fontFamily: "'SF Pro Display', 'Helvetica Neue', Inter, sans-serif" }}
              >
                NOOR
              </h1>
            </div>

            {/* Warm Welcome */}
            <div className="mb-12">
              <h2 className="text-2xl font-medium text-black mb-3 leading-snug">
                Welcome to NOOR.
              </h2>
              <p className="text-gray-500 text-base leading-relaxed">
                We're here to help you make sense of your money.
              </p>
            </div>

            {/* Reassurance - not features */}
            <div className="mb-12 space-y-3">
              <p className="text-sm text-gray-400">
                No rush. Take your time.
              </p>
              <p className="text-sm text-gray-400">
                We'll guide you step by step.
              </p>
            </div>

            {/* Single CTA */}
            <button
              onClick={() => router.push('/survey')}
              className="w-full py-4 bg-black text-white font-medium rounded-xl transition-all hover:bg-gray-800"
            >
              Get Started
            </button>

            {/* Existing user link */}
            <button
              onClick={() => router.push('/login')}
              className="w-full mt-4 py-3 text-gray-500 text-sm hover:text-black transition-colors"
            >
              I already have an account
            </button>
          </motion.div>
        </div>
      </main>

      {/* Minimal footer */}
      <footer className="py-6 text-center">
        <p className="text-xs text-gray-300">
          Your data stays private. Always.
        </p>
      </footer>
    </div>
  );
}
