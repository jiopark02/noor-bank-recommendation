'use client';

import React from 'react';
import Link from 'next/link';

export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 pb-12">
        <div className="max-w-sm w-full">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1
              className="text-3xl tracking-[0.35em] font-semibold"
              style={{ fontFamily: "'SF Pro Display', 'Helvetica Neue', Inter, sans-serif" }}
            >NOOR</h1>
            <p className="text-gray-400 text-sm italic mt-1">Your money atelier</p>
          </div>

          {/* Separator */}
          <div className="text-center mb-8">
            <span className="text-gray-300">·</span>
          </div>

          {/* Hero */}
          <div className="text-center mb-10">
            <h2
              className="text-4xl font-light tracking-[0.01em] mb-3"
              style={{ fontFamily: "'Cormorant Garamond', 'EB Garamond', Georgia, serif" }}
            >
              Banking, Tailored.
            </h2>
            <p className="text-gray-500 text-base">
              Tell us about you. We'll handle the rest.
            </p>
          </div>

          {/* Features Box */}
          <div className="bg-gray-50 rounded-2xl p-6 mb-10">
            <ul className="space-y-4">
              <li className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <span className="text-gray-700">Your visa. Your rules.</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <span className="text-gray-700">Campus-ready.</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <span className="text-gray-700">No SSN? No Problem.</span>
              </li>
            </ul>
          </div>

          {/* Buttons */}
          <div className="space-y-3 mb-10">
            <Link
              href="/survey"
              className="block w-full py-4 bg-black text-white text-center font-medium rounded-xl transition-all duration-300 hover:bg-gray-800"
            >
              Sign Up
            </Link>
            <Link
              href="/survey"
              className="block w-full py-4 bg-white text-black text-center font-medium rounded-xl border-[1.5px] border-gray-300 transition-all duration-300 hover:border-black"
            >
              Log In
            </Link>
          </div>

          {/* Trust Badge */}
          <p className="text-center text-gray-400 text-sm mb-8">
            Bank-level encryption · Your data stays yours
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center border-t border-gray-100">
        <p className="text-xs text-gray-300 tracking-wide">
          FEATURED IN: <span className="font-medium">FORBES</span> · <span className="font-medium">TECHCRUNCH</span>
        </p>
      </footer>
    </div>
  );
}
