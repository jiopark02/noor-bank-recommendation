'use client';

import React, { useState } from 'react';
import { Manrope } from 'next/font/google';
import { motion, AnimatePresence } from 'framer-motion';
import { validateEmail } from '@/lib/validation';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

type Status = 'idle' | 'loading' | 'success' | 'error' | 'duplicate';

const FEATURE_CARDS = [
  {
    title: 'Start with a goal',
    desc: '"Save for AirPods next month" beats any jargon-filled budget app.',
    icon: (
      <svg className="w-6 h-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    ),
  },
  {
    title: 'Just chat',
    desc: 'No charts to read, no terms to memorize. Ask a question, get an answer.',
    icon: (
      <svg className="w-6 h-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    ),
  },
  {
    title: 'Bank-grade security',
    desc: 'Read-only access. Encrypted end-to-end. Never sold, never shared.',
    icon: (
      <svg className="w-6 h-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    ),
  },
];

export default function WaitlistPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateEmail(email);
    if (!validation.isValid) {
      setStatus('error');
      setErrorMessage(validation.error ?? 'Please enter a valid email address');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (res.ok) {
        setStatus('success');
        return;
      }

      if (res.status === 409) {
        setStatus('duplicate');
        setErrorMessage("You're already on the list!");
        return;
      }

      const data = await res.json().catch(() => ({}));
      setStatus('error');
      setErrorMessage(data.message || 'Something went wrong. Please try again.');
    } catch {
      setStatus('error');
      setErrorMessage('Network error. Please check your connection and try again.');
    }
  };

  const isLoading = status === 'loading';
  const hasError = status === 'error' || status === 'duplicate';

  return (
    <div className={`${manrope.className} bg-white text-[#1a1a1a] min-h-screen`}>
      {/* Nav */}
      <nav className="flex justify-between items-center max-w-[1100px] mx-auto px-6 py-8 h-20">
        <button
          onClick={() => window.location.href = '/landing'}
          className="text-2xl font-extrabold tracking-tight hover:opacity-70 transition-opacity"
        >
          Noor
        </button>
      </nav>

      {/* Main */}
      <main className="px-6 py-4 md:py-6">
        <div className="max-w-[1100px] mx-auto">

          {/* Hero card */}
          <motion.section
            className="rounded-[2rem] p-8 md:p-16 text-center mb-6"
            style={{ backgroundColor: '#f3f1ee' }}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-white/60 border border-black/5 rounded-full px-4 py-1.5 mb-8">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              <span className="text-xs font-semibold text-[#6b6a68] uppercase tracking-wider">
                Closed alpha · invites rolling out
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6">
              Money, finally on your side.
            </h1>

            {/* Description */}
            <p className="text-lg md:text-xl text-[#6b6a68] max-w-2xl mx-auto mb-10 leading-relaxed">
              Noor is an AI financial assistant for the rest of us — the ones who don&apos;t know
              where to start. Tell us what you&apos;re saving for. We&apos;ll handle the rest.
            </p>

            {/* Form / success swap */}
            <AnimatePresence mode="wait">
              {status === 'success' ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center gap-2 py-4 mb-4"
                >
                  <svg className="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                    <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                  <p className="text-lg font-bold">You&apos;re on the list!</p>
                  <p className="text-[#6b6a68]">We&apos;ll email you when it&apos;s your turn.</p>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <form
                    className="flex flex-col md:flex-row items-center justify-center gap-3 mb-4"
                    onSubmit={handleSubmit}
                    noValidate
                  >
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (hasError) { setStatus('idle'); setErrorMessage(''); }
                      }}
                      placeholder="you@email.com"
                      disabled={isLoading}
                      className="w-full md:w-72 px-5 py-4 rounded-xl border-none focus:ring-2 focus:ring-black/20 text-[#1a1a1a] shadow-sm bg-white outline-none disabled:opacity-60"
                      style={hasError ? { outline: '2px solid #EF4444' } : {}}
                    />
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full md:w-auto px-8 py-4 bg-[#1a1a1a] text-white font-bold rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-lg disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {isLoading ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Joining…
                        </>
                      ) : (
                        'Join waitlist'
                      )}
                    </button>
                  </form>

                  {/* Inline error */}
                  <AnimatePresence>
                    {hasError && errorMessage && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2 }}
                        className="text-sm text-center mb-2"
                        style={{ color: status === 'duplicate' ? '#059669' : '#EF4444' }}
                      >
                        {errorMessage}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Social proof */}
            {status !== 'success' && (
              <p className="text-sm text-[#6b6a68]/60">
                <span className="font-semibold text-[#6b6a68]">2,847</span> people ahead of you · no spam, ever
              </p>
            )}
          </motion.section>

          {/* Feature cards */}
          <motion.section
            className="grid grid-cols-1 gap-4"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          >
            {FEATURE_CARDS.map((card) => (
              <div
                key={card.title}
                className="p-8 rounded-2xl flex flex-col gap-4 bg-white transition-all duration-200"
                style={{ border: '1px solid #e5e4e2' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#d1d0ce')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#e5e4e2')}
              >
                <div className="w-10 h-10 flex items-center justify-center bg-stone-100 rounded-lg flex-shrink-0">
                  {card.icon}
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">{card.title}</h3>
                  <p className="text-[#6b6a68] leading-relaxed">{card.desc}</p>
                </div>
              </div>
            ))}
          </motion.section>

        </div>
      </main>
    </div>
  );
}
