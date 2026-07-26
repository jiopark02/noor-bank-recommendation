'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Manrope } from 'next/font/google';
import { motion, AnimatePresence } from 'framer-motion';
import { validateEmail } from '@/lib/validation';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

type Status = 'idle' | 'loading' | 'success' | 'error' | 'duplicate';

export default function WaitlistPage() {
  const router = useRouter();
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
    <div className={`${manrope.className} text-[#1a1a1a] min-h-screen`}>
      {/* Nav */}
      <nav className="flex justify-between items-center max-w-[1100px] mx-auto px-6 py-8 h-20">
        <button
          onClick={() => window.location.href = '/landing'}
          className="text-2xl font-extrabold tracking-tight hover:opacity-70 transition-opacity"
        >
          noor
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
                  <button
                    type="button"
                    onClick={() => router.push('/demo')}
                    className="w-full md:w-auto mt-4 px-8 py-4 bg-white text-[#1a1a1a] font-bold rounded-xl border border-[#d1d0ce] hover:border-[#1a1a1a] active:scale-95 transition-all"
                  >
                    Try demo
                  </button>
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
                    <button
                      type="button"
                      onClick={() => router.push('/demo')}
                      disabled={isLoading}
                      className="w-full md:w-auto px-8 py-4 bg-white text-[#1a1a1a] font-bold rounded-xl border border-[#d1d0ce] hover:border-[#1a1a1a] active:scale-95 transition-all disabled:opacity-60"
                    >
                      Try demo
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

            {/* Secondary: learn more on the landing page (subtle, not a CTA) */}
            <button
              type="button"
              onClick={() => router.push('/landing')}
              className="text-xs text-[#6b6a68]/70 underline underline-offset-2 hover:text-[#6b6a68] transition-colors mb-4"
            >
              for more information
            </button>
          </motion.section>

        </div>
      </main>
    </div>
  );
}
