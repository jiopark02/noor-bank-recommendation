'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { BottomNav } from '@/components/layout';
import {
  ALL_TIPS,
  CATEGORY_INFO,
  TipCategory,
  ProTip,
  HYSA_TIPS,
  ROTH_IRA_TIPS,
  FOUR01K_TIPS,
  HSA_TIPS,
  CREDIT_CARD_TIPS,
  TAX_TIPS,
  INVESTING_TIPS,
  EMERGENCY_FUND_TIPS,
  ORDER_OF_OPERATIONS,
  WARNINGS,
  TAX_TREATIES,
  calculate401kMatchLoss,
  calculateRothGrowth,
  calculateHYSABenefit,
  calculateTaxTreatySavings,
  calculateInvestmentGrowth,
  getVisaRelevantTips,
  searchTips,
} from '@/lib/financeProTips';

type ViewMode = 'categories' | 'flowchart' | 'calculators' | 'search';

const CATEGORIES: TipCategory[] = [
  'order_of_operations',
  'hysa',
  'roth_ira',
  '401k',
  'hsa',
  'credit_cards',
  'tax',
  'investing',
  'emergency_fund',
  'warnings',
];

export default function ProTipsPage() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('categories');
  const [expandedCategory, setExpandedCategory] = useState<TipCategory | null>(null);
  const [expandedTip, setExpandedTip] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showVisaOnly, setShowVisaOnly] = useState(false);

  // Calculator states
  const [calc401k, setCalc401k] = useState({ salary: 80000, match: 50, maxMatch: 6, current: 3 });
  const [calcRoth, setCalcRoth] = useState({ contribution: 7000, age: 25 });
  const [calcHYSA, setCalcHYSA] = useState({ balance: 10000 });
  const [calcTreaty, setCalcTreaty] = useState({ country: 'China', income: 30000 });

  useEffect(() => {
    const userId = localStorage.getItem('noor_user_id');
    if (!userId) {
      router.push('/welcome');
    }
  }, [router]);

  const getTipsForCategory = (category: TipCategory): ProTip[] => {
    const categoryMap: Record<TipCategory, ProTip[]> = {
      hysa: HYSA_TIPS,
      roth_ira: ROTH_IRA_TIPS,
      '401k': FOUR01K_TIPS,
      hsa: HSA_TIPS,
      credit_cards: CREDIT_CARD_TIPS,
      tax: TAX_TIPS,
      investing: INVESTING_TIPS,
      emergency_fund: EMERGENCY_FUND_TIPS,
      order_of_operations: ORDER_OF_OPERATIONS,
      warnings: WARNINGS,
    };
    let tips = categoryMap[category] || [];
    if (showVisaOnly) {
      tips = tips.filter(t => t.visaRelevant);
    }
    return tips;
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchTips(searchQuery);
  }, [searchQuery]);

  // Calculator results
  const matchLoss = calculate401kMatchLoss(calc401k.salary, calc401k.match, calc401k.maxMatch, calc401k.current);
  const rothGrowth = calculateRothGrowth(calcRoth.contribution, calcRoth.age);
  const hysaBenefit = calculateHYSABenefit(calcHYSA.balance);
  const treatySavings = calculateTaxTreatySavings(calcTreaty.country, calcTreaty.income);

  return (
    <div className="min-h-screen bg-[#FAF9F7] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[#E8E6E3]">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/grow" className="text-[#6B6B6B]">
              ← Back
            </Link>
          </div>
          <h1 className="text-2xl font-light text-[#1A1A1A] tracking-tight">Pro Tips</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            The definitive guide to international student finance
          </p>
        </div>
      </div>

      {/* Intro Message */}
      <div className="px-4 py-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-blue-50 to-white rounded-2xl p-4 border border-blue-100"
        >
          <p className="text-sm text-[#6B6B6B] leading-relaxed">
            Hey! Think of this as advice from a friend who's been through it all.
            I figured this stuff out the hard way - you don't have to.
            Start with the Order of Operations, then explore what interests you.
          </p>
        </motion.div>
      </div>

      {/* View Mode Tabs */}
      <div className="px-4 mb-4">
        <div className="flex gap-2 bg-[#F5F4F2] rounded-xl p-1">
          {[
            { id: 'categories', label: 'Topics' },
            { id: 'flowchart', label: 'Flowchart' },
            { id: 'calculators', label: 'Calculators' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id as ViewMode)}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                viewMode === tab.id
                  ? 'bg-white text-[#1A1A1A] shadow-sm'
                  : 'text-[#6B6B6B]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="px-4 mb-4">
        <div className="relative">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search all tips..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) setViewMode('search');
              else setViewMode('categories');
            }}
            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </div>
      </div>

      {/* Visa-only filter */}
      <div className="px-4 mb-4">
        <button
          onClick={() => setShowVisaOnly(!showVisaOnly)}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
            showVisaOnly
              ? 'bg-blue-500 text-white'
              : 'bg-white border border-gray-200 text-gray-600'
          }`}
        >
          {showVisaOnly ? '✓ Visa-specific only' : 'Show visa-specific tips'}
        </button>
      </div>

      {/* Content */}
      <div className="px-4">
        {/* SEARCH RESULTS */}
        {viewMode === 'search' && searchQuery && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <p className="text-sm text-[#6B6B6B] mb-4">
              {searchResults.length} results for "{searchQuery}"
            </p>
            {searchResults.map((tip) => (
              <TipCard key={tip.id} tip={tip} expanded={expandedTip === tip.id} onToggle={() => setExpandedTip(expandedTip === tip.id ? null : tip.id)} />
            ))}
            {searchResults.length === 0 && (
              <p className="text-center text-[#6B6B6B] py-8">No tips found. Try different keywords.</p>
            )}
          </motion.div>
        )}

        {/* CATEGORIES VIEW */}
        {viewMode === 'categories' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            {CATEGORIES.map((category, idx) => {
              const info = CATEGORY_INFO[category];
              const tips = getTipsForCategory(category);
              const isExpanded = expandedCategory === category;

              if (showVisaOnly && tips.length === 0) return null;

              return (
                <motion.div
                  key={category}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`bg-white rounded-2xl border overflow-hidden ${
                    category === 'warnings' ? 'border-red-200' : 'border-[#E8E6E3]'
                  }`}
                >
                  <button
                    onClick={() => setExpandedCategory(isExpanded ? null : category)}
                    className="w-full p-4 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{info.icon}</span>
                        <div>
                          <h3 className={`font-medium ${category === 'warnings' ? 'text-red-600' : 'text-[#1A1A1A]'}`}>
                            {info.label}
                          </h3>
                          <p className="text-xs text-[#6B6B6B]">{tips.length} tips</p>
                        </div>
                      </div>
                      <svg
                        className={`w-5 h-5 text-[#6B6B6B] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-[#E8E6E3] overflow-hidden"
                      >
                        <div className="p-4 space-y-3">
                          {tips.map((tip) => (
                            <TipCard
                              key={tip.id}
                              tip={tip}
                              expanded={expandedTip === tip.id}
                              onToggle={() => setExpandedTip(expandedTip === tip.id ? null : tip.id)}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* FLOWCHART VIEW */}
        {viewMode === 'flowchart' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-[#E8E6E3]">
              <h2 className="text-lg font-medium text-[#1A1A1A] mb-2">The Money Flowchart</h2>
              <p className="text-sm text-[#6B6B6B] mb-6">
                Follow this order. Don't skip steps. It's optimized for tax efficiency and financial security.
              </p>

              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-[#E8E6E3]" />

                <div className="space-y-4">
                  {ORDER_OF_OPERATIONS.map((step, idx) => (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="relative flex gap-4"
                    >
                      <div className="relative z-10 w-10 h-10 rounded-full bg-black text-white flex items-center justify-center text-sm font-medium">
                        {idx + 1}
                      </div>
                      <div className="flex-1 pb-4">
                        <h3 className="font-medium text-[#1A1A1A]">{step.headline.replace(`Step ${idx + 1}: `, '')}</h3>
                        <p className="text-sm text-[#6B6B6B] mt-1">{step.explanation}</p>
                        <p className="text-xs text-blue-600 mt-2 italic">{step.whyItMatters}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Decision Tree */}
            <div className="bg-gradient-to-br from-amber-50 to-white rounded-2xl p-5 border border-amber-200">
              <h3 className="font-medium text-[#1A1A1A] mb-3">Quick Decision: "I have extra $500"</h3>
              <div className="space-y-2 text-sm">
                <p className="text-[#6B6B6B]">
                  <span className="font-medium text-[#1A1A1A]">Credit card debt?</span> → Pay it off first
                </p>
                <p className="text-[#6B6B6B]">
                  <span className="font-medium text-[#1A1A1A]">No emergency fund?</span> → Put it in HYSA
                </p>
                <p className="text-[#6B6B6B]">
                  <span className="font-medium text-[#1A1A1A]">401(k) match available?</span> → Increase contribution
                </p>
                <p className="text-[#6B6B6B]">
                  <span className="font-medium text-[#1A1A1A]">Roth IRA not maxed?</span> → Contribute to Roth
                </p>
                <p className="text-[#6B6B6B]">
                  <span className="font-medium text-[#1A1A1A]">All the above done?</span> → Taxable brokerage
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* CALCULATORS VIEW */}
        {viewMode === 'calculators' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            {/* 401(k) Match Calculator */}
            <div className="bg-white rounded-2xl p-5 border border-[#E8E6E3]">
              <h3 className="font-medium text-[#1A1A1A] mb-1">401(k) Match Calculator</h3>
              <p className="text-xs text-[#6B6B6B] mb-4">See how much you're leaving on the table</p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[#6B6B6B]">Annual Salary</label>
                  <input
                    type="number"
                    value={calc401k.salary}
                    onChange={(e) => setCalc401k({ ...calc401k, salary: parseInt(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#6B6B6B]">Match % (e.g., 50)</label>
                    <input
                      type="number"
                      value={calc401k.match}
                      onChange={(e) => setCalc401k({ ...calc401k, match: parseInt(e.target.value) || 0 })}
                      className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#6B6B6B]">Up to % of salary</label>
                    <input
                      type="number"
                      value={calc401k.maxMatch}
                      onChange={(e) => setCalc401k({ ...calc401k, maxMatch: parseInt(e.target.value) || 0 })}
                      className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#6B6B6B]">Your current contribution %</label>
                  <input
                    type="number"
                    value={calc401k.current}
                    onChange={(e) => setCalc401k({ ...calc401k, current: parseInt(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="mt-4 p-4 bg-red-50 rounded-xl">
                <p className="text-sm text-red-800">
                  You're losing <span className="font-bold">${matchLoss.annualLoss.toLocaleString()}</span> per year in free money
                </p>
                <p className="text-xs text-red-600 mt-1">
                  Over 30 years with growth: <span className="font-bold">${matchLoss.withGrowth.toLocaleString()}</span> lost
                </p>
              </div>
            </div>

            {/* Roth IRA Growth Calculator */}
            <div className="bg-white rounded-2xl p-5 border border-[#E8E6E3]">
              <h3 className="font-medium text-[#1A1A1A] mb-1">Roth IRA Growth Calculator</h3>
              <p className="text-xs text-[#6B6B6B] mb-4">See the power of tax-free compounding</p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[#6B6B6B]">Annual Contribution</label>
                  <input
                    type="number"
                    value={calcRoth.contribution}
                    onChange={(e) => setCalcRoth({ ...calcRoth, contribution: parseInt(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#6B6B6B]">Current Age</label>
                  <input
                    type="number"
                    value={calcRoth.age}
                    onChange={(e) => setCalcRoth({ ...calcRoth, age: parseInt(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="mt-4 p-4 bg-emerald-50 rounded-xl">
                <p className="text-sm text-emerald-800">
                  At 65, you'll have <span className="font-bold">${rothGrowth.finalBalance.toLocaleString()}</span>
                </p>
                <p className="text-xs text-emerald-600 mt-1">
                  You contributed: ${rothGrowth.totalContributed.toLocaleString()} |
                  Growth: <span className="font-bold">${rothGrowth.totalGrowth.toLocaleString()}</span> (all tax-free!)
                </p>
              </div>
            </div>

            {/* HYSA Calculator */}
            <div className="bg-white rounded-2xl p-5 border border-[#E8E6E3]">
              <h3 className="font-medium text-[#1A1A1A] mb-1">HYSA vs Checking</h3>
              <p className="text-xs text-[#6B6B6B] mb-4">Stop leaving money on the table</p>

              <div>
                <label className="text-xs text-[#6B6B6B]">Savings Balance</label>
                <input
                  type="number"
                  value={calcHYSA.balance}
                  onChange={(e) => setCalcHYSA({ balance: parseInt(e.target.value) || 0 })}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="p-3 bg-gray-50 rounded-xl text-center">
                  <p className="text-lg font-medium text-gray-400">${hysaBenefit.checkingEarnings.toFixed(2)}</p>
                  <p className="text-xs text-gray-400">Checking (0.01%)</p>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl text-center">
                  <p className="text-lg font-medium text-emerald-600">${hysaBenefit.hysaEarnings.toFixed(2)}</p>
                  <p className="text-xs text-emerald-600">HYSA (4.5%)</p>
                </div>
              </div>
              <p className="text-center text-sm text-[#1A1A1A] mt-3">
                Difference: <span className="font-bold text-emerald-600">${hysaBenefit.difference.toFixed(2)}</span>/year
              </p>
            </div>

            {/* Tax Treaty Calculator */}
            <div className="bg-white rounded-2xl p-5 border border-[#E8E6E3]">
              <h3 className="font-medium text-[#1A1A1A] mb-1">Tax Treaty Savings</h3>
              <p className="text-xs text-[#6B6B6B] mb-4">Check your country's student tax benefit</p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[#6B6B6B]">Home Country</label>
                  <select
                    value={calcTreaty.country}
                    onChange={(e) => setCalcTreaty({ ...calcTreaty, country: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  >
                    {TAX_TREATIES.map((t) => (
                      <option key={t.country} value={t.country}>{t.country}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#6B6B6B]">Annual Income (USD)</label>
                  <input
                    type="number"
                    value={calcTreaty.income}
                    onChange={(e) => setCalcTreaty({ ...calcTreaty, income: parseInt(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className={`mt-4 p-4 rounded-xl ${treatySavings.exemption > 0 ? 'bg-blue-50' : 'bg-gray-50'}`}>
                {treatySavings.exemption > 0 ? (
                  <>
                    <p className="text-sm text-blue-800">
                      Exemption: <span className="font-bold">${treatySavings.exemption.toLocaleString()}</span>
                    </p>
                    <p className="text-xs text-blue-600 mt-1">
                      Estimated tax savings: <span className="font-bold">${treatySavings.savings}</span>
                    </p>
                    {treatySavings.treaty && (
                      <p className="text-xs text-blue-500 mt-1">Article: {treatySavings.treaty.article}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-600">
                    No student-specific tax treaty benefit for {calcTreaty.country}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

// Tip Card Component
function TipCard({ tip, expanded, onToggle }: { tip: ProTip; expanded: boolean; onToggle: () => void }) {
  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        tip.isWarning ? 'border-red-200 bg-red-50' : 'border-[#E8E6E3] bg-[#F9FAFB]'
      }`}
    >
      <button onClick={onToggle} className="w-full p-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className={`font-medium text-sm ${tip.isWarning ? 'text-red-700' : 'text-[#1A1A1A]'}`}>
                {tip.headline}
              </h4>
              {tip.visaRelevant && (
                <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">visa</span>
              )}
              {tip.difficulty === 'advanced' && (
                <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded">advanced</span>
              )}
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-[#6B6B6B] flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              <p className="text-sm text-[#6B6B6B] leading-relaxed">{tip.explanation}</p>
              <div className="p-2 bg-white rounded-lg border border-[#E8E6E3]">
                <p className="text-xs text-blue-600 italic">
                  <span className="font-medium">Why it matters:</span> {tip.whyItMatters}
                </p>
              </div>
              {tip.actionLabel && (
                <button className="w-full py-2 bg-black text-white rounded-lg text-sm font-medium">
                  {tip.actionLabel} →
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
