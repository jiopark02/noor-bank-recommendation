'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

// Country options
const COUNTRIES = [
  {
    id: 'US',
    name: 'United States',
    flag: '🇺🇸',
    description: 'Study or work in the USA',
  },
  {
    id: 'UK',
    name: 'United Kingdom',
    flag: '🇬🇧',
    description: 'Study or work in the UK',
  },
  {
    id: 'CA',
    name: 'Canada',
    flag: '🇨🇦',
    description: 'Study or work in Canada',
  },
];

// Country-specific text for dynamic labels
const COUNTRY_NEW_TEXT: Record<string, string> = {
  US: 'New to the States',
  UK: 'New to the UK',
  CA: 'New to Canada',
};

// Bespoke options - tailored experience
const REASONS = [
  {
    id: 'just-arrived',
    label: 'New to the States', // Default, will be overridden dynamically
    description: 'Let us prepare your essentials',
    priority: ['bank', 'phone', 'documents'],
  },
  {
    id: 'already-here',
    label: 'Settling in',
    description: 'Time to refine your finances',
    priority: ['bank', 'credit', 'budget'],
  },
  {
    id: 'need-bank',
    label: 'Banking',
    description: 'We\'ll find your perfect fit',
    priority: ['bank', 'credit'],
  },
  {
    id: 'find-housing',
    label: 'Housing',
    description: 'Curated residences near you',
    priority: ['housing', 'budget'],
  },
  {
    id: 'build-credit',
    label: 'Credit',
    description: 'Begin building your foundation',
    priority: ['credit', 'bank'],
  },
  {
    id: 'just-exploring',
    label: 'Browsing',
    description: 'Take your time, we\'re here',
    priority: [],
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState<'welcome' | 'country' | 'reason'>('welcome');
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  const handleCountrySelect = (countryId: string) => {
    setSelectedCountry(countryId);
    localStorage.setItem('noor_selected_country', countryId);

    // Small delay for animation
    setTimeout(() => {
      setStep('reason');
    }, 300);
  };

  const handleReasonSelect = (reasonId: string) => {
    setSelectedReason(reasonId);

    // Save the reason for personalization
    const reason = REASONS.find(r => r.id === reasonId);
    if (reason) {
      localStorage.setItem('noor_user_intent', reasonId);
      localStorage.setItem('noor_user_priorities', JSON.stringify(reason.priority));
    }

    // Small delay for animation
    setTimeout(() => {
      router.push('/survey');
    }, 300);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full">
          <AnimatePresence mode="wait">
            {step === 'welcome' ? (
              <motion.div
                key="welcome"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
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
                    We're here to help you navigate banking, housing, and everything in between.
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
                  onClick={() => setStep('country')}
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
            ) : step === 'country' ? (
              <motion.div
                key="country"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                {/* Back button */}
                <button
                  onClick={() => setStep('welcome')}
                  className="flex items-center text-gray-400 hover:text-black mb-8 transition-colors"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>

                {/* Question */}
                <div className="mb-8">
                  <h2 className="text-2xl font-medium text-black mb-2">
                    Where are you headed?
                  </h2>
                  <p className="text-gray-500 text-sm">
                    Select your destination country.
                  </p>
                </div>

                {/* Country Options */}
                <div className="space-y-3">
                  {COUNTRIES.map((country, index) => (
                    <motion.button
                      key={country.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => handleCountrySelect(country.id)}
                      className={`w-full p-4 text-left rounded-xl border-2 transition-all ${
                        selectedCountry === country.id
                          ? 'border-black bg-gray-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{country.flag}</span>
                        <div>
                          <span className="font-medium text-black block">
                            {country.name}
                          </span>
                          <span className="text-sm text-gray-500 mt-0.5 block">
                            {country.description}
                          </span>
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="reason"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                {/* Back button */}
                <button
                  onClick={() => setStep('country')}
                  className="flex items-center text-gray-400 hover:text-black mb-8 transition-colors"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>

                {/* Question */}
                <div className="mb-8">
                  <h2 className="text-2xl font-medium text-black mb-2">
                    What brings you in today?
                  </h2>
                  <p className="text-gray-500 text-sm">
                    Allow us to tailor your experience.
                  </p>
                </div>

                {/* Options */}
                <div className="space-y-3">
                  {REASONS.map((reason, index) => (
                    <motion.button
                      key={reason.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => handleReasonSelect(reason.id)}
                      className={`w-full p-4 text-left rounded-xl border-2 transition-all ${
                        selectedReason === reason.id
                          ? 'border-black bg-gray-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="font-medium text-black block">
                        {reason.id === 'just-arrived' && selectedCountry
                          ? COUNTRY_NEW_TEXT[selectedCountry] || reason.label
                          : reason.label}
                      </span>
                      <span className="text-sm text-gray-500 mt-0.5 block">
                        {reason.description}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
