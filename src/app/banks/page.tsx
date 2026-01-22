'use client';

import React from 'react';
import { BankRecommendationList } from '@/components/bank';

// TODO: Replace with authenticated user ID
const MOCK_USER_ID = 'demo-user-id';

export default function BanksPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <button className="p-2 -ml-2 hover:bg-gray-100 rounded-lg">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-lg font-semibold text-gray-900">Bank Recommendations</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Info Banner */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-5 mb-6 text-white">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold mb-1">Personalized for You</h2>
              <p className="text-sm text-white/80">
                These banks are recommended based on your SSN status, transfer needs, and preferences.
                Your fit score shows how well each bank matches your situation.
              </p>
            </div>
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 -mx-4 px-4">
          <FilterChip label="All" active />
          <FilterChip label="No SSN Required" />
          <FilterChip label="Free Transfers" />
          <FilterChip label="Student Accounts" />
          <FilterChip label="Online Only" />
        </div>

        {/* Recommendations */}
        <BankRecommendationList userId={MOCK_USER_ID} limit={5} />

        {/* Help Section */}
        <div className="mt-8 bg-white rounded-2xl p-6 border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-2">Need help choosing?</h3>
          <p className="text-sm text-gray-500 mb-4">
            Our experts can help you find the perfect bank account for your situation.
          </p>
          <button className="w-full py-3 px-4 border border-indigo-600 text-indigo-600 rounded-xl font-medium hover:bg-indigo-50 transition-colors">
            Chat with an Advisor
          </button>
        </div>
      </main>
    </div>
  );
}

function FilterChip({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
        active
          ? 'bg-indigo-600 text-white'
          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}
