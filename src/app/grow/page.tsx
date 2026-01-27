'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomNav } from '@/components/layout';
import {
  HYSA_ACCOUNTS,
  INVESTMENT_ACCOUNTS,
  ROTH_IRA_ELIGIBILITY_QUESTIONS,
  EMERGENCY_FUND_GUIDE,
  checkRothIRAEligibility,
  calculateHYSAEarnings,
  calculateMonthsToGoal,
  trackReferralClick,
  SavingsGoal,
  EligibilityResult,
  STORAGE_KEY_SAVINGS_GOALS,
  HYSAAccount,
} from '@/lib/savingsData';

type TabType = 'start' | 'levelup' | 'goals';
type UserLevel = 'undergrad' | 'grad' | 'working';

const TABS = [
  { id: 'start', label: 'Start Here' },
  { id: 'levelup', label: 'Level Up' },
  { id: 'goals', label: 'My Goals' },
];

export default function GrowPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('start');
  const [userLevel, setUserLevel] = useState<UserLevel>('undergrad');
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [showEligibilityQuiz, setShowEligibilityQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizResult, setQuizResult] = useState<EligibilityResult | null>(null);
  const [calculatorAmount, setCalculatorAmount] = useState(5000);
  const [showEmergencyGuide, setShowEmergencyGuide] = useState(false);
  const [expandedHYSA, setExpandedHYSA] = useState<string | null>(null);
  const [expandedInvestment, setExpandedInvestment] = useState<string | null>(null);

  useEffect(() => {
    const userId = localStorage.getItem('noor_user_id');
    if (!userId) {
      router.push('/welcome');
      return;
    }

    // Load user profile to determine level
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      try {
        const parsed = JSON.parse(profile);
        if (parsed.academicLevel) {
          if (['Master\'s', 'PhD', 'Postdoc'].includes(parsed.academicLevel)) {
            setUserLevel('grad');
          } else if (parsed.hasJob || parsed.monthlyIncome > 3000) {
            setUserLevel('working');
          }
        }
      } catch (e) {
        // Use default
      }
    }

    // Load savings goals
    const savedGoals = localStorage.getItem(STORAGE_KEY_SAVINGS_GOALS);
    if (savedGoals) {
      setSavingsGoals(JSON.parse(savedGoals));
    } else {
      // Set default emergency fund goal
      setSavingsGoals([
        {
          id: 'emergency_fund',
          name: 'Emergency Fund',
          target_amount: 5000,
          current_amount: 0,
          category: 'emergency',
        },
      ]);
    }
  }, [router]);

  // Save goals when they change
  useEffect(() => {
    if (savingsGoals.length > 0) {
      localStorage.setItem(STORAGE_KEY_SAVINGS_GOALS, JSON.stringify(savingsGoals));
    }
  }, [savingsGoals]);

  // Calculate HYSA earnings
  const hysaEarnings = useMemo(() => {
    const bestRate = Math.max(...HYSA_ACCOUNTS.map(a => a.apy));
    return calculateHYSAEarnings(calculatorAmount, bestRate);
  }, [calculatorAmount]);

  // Handle quiz completion
  const handleQuizComplete = () => {
    const result = checkRothIRAEligibility(quizAnswers);
    setQuizResult(result);
  };

  // Handle referral click
  const handleAccountClick = (account: HYSAAccount | { id: string; link: string }, type: 'hysa' | 'brokerage' | 'ira') => {
    trackReferralClick({
      account_id: account.id,
      account_type: type,
      timestamp: new Date().toISOString(),
      user_id: localStorage.getItem('noor_user_id') || undefined,
    });
    window.open(account.link, '_blank');
  };

  // Update savings goal
  const updateGoalAmount = (goalId: string, newAmount: number) => {
    setSavingsGoals(prev =>
      prev.map(goal =>
        goal.id === goalId ? { ...goal, current_amount: Math.max(0, newAmount) } : goal
      )
    );
  };

  // Add new goal
  const addGoal = () => {
    const newGoal: SavingsGoal = {
      id: `goal_${Date.now()}`,
      name: 'New Goal',
      target_amount: 1000,
      current_amount: 0,
      category: 'other',
    };
    setSavingsGoals(prev => [...prev, newGoal]);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[#E8E6E3]">
        <div className="px-6 py-4">
          <h1 className="text-2xl font-light text-[#1A1A1A] tracking-tight">Grow</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">Savings & Investing for your future</p>
        </div>
      </div>

      {/* Reassurance Message */}
      <div className="px-4 py-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-4 border border-[#E8E6E3]"
        >
          <p className="text-sm text-[#6B6B6B] leading-relaxed">
            Don't worry if this feels new. Everyone starts somewhere. We'll guide you step by step, at your own pace.
          </p>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="px-4 mb-4">
        <div className="flex gap-2 bg-[#F5F4F2] rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-[#1A1A1A] shadow-sm'
                  : 'text-[#6B6B6B]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-4">
        {/* START HERE TAB */}
        {activeTab === 'start' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Emergency Fund Section */}
            <div className="bg-white rounded-2xl p-4 border border-[#E8E6E3]">
              <button
                onClick={() => setShowEmergencyGuide(!showEmergencyGuide)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <span className="text-lg">🛡️</span>
                  </div>
                  <div className="text-left">
                    <h3 className="font-medium text-[#1A1A1A]">Emergency Fund 101</h3>
                    <p className="text-xs text-[#6B6B6B]">Why you need one & how much</p>
                  </div>
                </div>
                <svg
                  className={`w-5 h-5 text-[#6B6B6B] transition-transform ${showEmergencyGuide ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <AnimatePresence>
                {showEmergencyGuide && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-4 pt-4 border-t border-[#E8E6E3] overflow-hidden"
                  >
                    {EMERGENCY_FUND_GUIDE.sections.map((section, idx) => (
                      <div key={idx} className="mb-4 last:mb-0">
                        <h4 className="text-sm font-medium text-[#1A1A1A] mb-1">{section.title}</h4>
                        <p className="text-sm text-[#6B6B6B] leading-relaxed">{section.content}</p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* HYSA Calculator */}
            <div className="bg-gradient-to-br from-emerald-50 to-white rounded-2xl p-5 border border-emerald-100">
              <h3 className="font-medium text-[#1A1A1A] mb-1">Why HYSA matters</h3>
              <p className="text-sm text-[#6B6B6B] mb-4">See how much you could earn vs regular checking</p>

              <div className="mb-4">
                <label className="text-xs text-[#6B6B6B] mb-1 block">If you have this in checking:</label>
                <div className="flex items-center gap-2">
                  <span className="text-lg text-[#1A1A1A]">$</span>
                  <input
                    type="number"
                    value={calculatorAmount}
                    onChange={(e) => setCalculatorAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="flex-1 text-2xl font-light text-[#1A1A1A] bg-transparent border-b-2 border-[#E8E6E3] focus:border-emerald-500 outline-none py-1"
                  />
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 border border-emerald-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[#6B6B6B]">You could earn</span>
                  <span className="text-2xl font-medium text-emerald-600">${hysaEarnings.toFixed(0)}</span>
                </div>
                <p className="text-xs text-[#9B9B9B]">per year at {Math.max(...HYSA_ACCOUNTS.map(a => a.apy))}% APY</p>
              </div>

              <p className="text-xs text-[#9B9B9B] mt-3 text-center">
                That's free money just for moving your savings!
              </p>
            </div>

            {/* HYSA Recommendations */}
            <div>
              <h3 className="text-sm font-medium text-[#1A1A1A] mb-3 px-1">Best High-Yield Savings Accounts</h3>
              <div className="space-y-3">
                {HYSA_ACCOUNTS.map((account, idx) => (
                  <motion.div
                    key={account.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="bg-white rounded-2xl border border-[#E8E6E3] overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedHYSA(expandedHYSA === account.id ? null : account.id)}
                      className="w-full p-4 text-left"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-[#1A1A1A]">{account.name}</h4>
                            {idx === 0 && (
                              <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">
                                Top Pick
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#6B6B6B] mt-0.5">{account.bank}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-medium text-emerald-600">{account.apy}%</p>
                          <p className="text-xs text-[#6B6B6B]">APY</p>
                        </div>
                      </div>
                      <p className="text-xs text-emerald-600 mt-2">{account.best_for}</p>
                    </button>

                    <AnimatePresence>
                      {expandedHYSA === account.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="border-t border-[#E8E6E3] overflow-hidden"
                        >
                          <div className="p-4 space-y-3">
                            <div>
                              <p className="text-xs text-[#6B6B6B] mb-1">Features</p>
                              <div className="flex flex-wrap gap-1">
                                {account.features.map((f, i) => (
                                  <span key={i} className="text-xs px-2 py-1 bg-[#F5F4F2] rounded-full text-[#6B6B6B]">
                                    {f}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-xs text-[#6B6B6B] mb-1">Pros</p>
                                <ul className="text-xs text-[#1A1A1A] space-y-1">
                                  {account.pros.slice(0, 2).map((p, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-emerald-500">+</span>
                                      {p}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <p className="text-xs text-[#6B6B6B] mb-1">Cons</p>
                                <ul className="text-xs text-[#1A1A1A] space-y-1">
                                  {account.cons.slice(0, 2).map((c, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-[#9B9B9B]">-</span>
                                      {c}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            <button
                              onClick={() => handleAccountClick(account, 'hysa')}
                              className="w-full py-3 bg-black text-white rounded-xl text-sm font-medium"
                            >
                              Open Account →
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* LEVEL UP TAB */}
        {activeTab === 'levelup' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Level selector */}
            <div className="flex gap-2">
              {[
                { id: 'undergrad', label: 'Student' },
                { id: 'grad', label: 'Grad/PhD' },
                { id: 'working', label: 'Working' },
              ].map((level) => (
                <button
                  key={level.id}
                  onClick={() => setUserLevel(level.id as UserLevel)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    userLevel === level.id
                      ? 'bg-black text-white'
                      : 'bg-white border border-[#E8E6E3] text-[#6B6B6B]'
                  }`}
                >
                  {level.label}
                </button>
              ))}
            </div>

            {/* Roth IRA Section */}
            <div className="bg-white rounded-2xl border border-[#E8E6E3] overflow-hidden">
              <button
                onClick={() => setExpandedInvestment(expandedInvestment === 'roth_ira' ? null : 'roth_ira')}
                className="w-full p-4 text-left"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                      <span className="text-lg">📈</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-[#1A1A1A]">Roth IRA</h3>
                      <p className="text-xs text-[#6B6B6B]">Tax-free retirement savings</p>
                    </div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-[#6B6B6B] transition-transform ${expandedInvestment === 'roth_ira' ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              <AnimatePresence>
                {expandedInvestment === 'roth_ira' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-[#E8E6E3] overflow-hidden"
                  >
                    <div className="p-4 space-y-4">
                      <div>
                        <h4 className="text-sm font-medium text-[#1A1A1A] mb-2">What is it?</h4>
                        <p className="text-sm text-[#6B6B6B] leading-relaxed">
                          A Roth IRA is a retirement account where you contribute money you've already paid taxes on.
                          The magic? Your money grows tax-free, and you pay zero taxes when you withdraw in retirement.
                        </p>
                      </div>

                      <div className="bg-blue-50 rounded-xl p-3">
                        <p className="text-sm font-medium text-blue-800 mb-1">2024 Contribution Limit</p>
                        <p className="text-2xl font-light text-blue-900">$7,000</p>
                        <p className="text-xs text-blue-700">per year</p>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-[#1A1A1A] mb-2">Can you open one?</h4>
                        <p className="text-sm text-[#6B6B6B] mb-3">
                          F-1 students on OPT, H-1B workers, and permanent residents can usually open one.
                          Take our quick quiz to check.
                        </p>
                        <button
                          onClick={() => setShowEligibilityQuiz(true)}
                          className="w-full py-3 bg-blue-500 text-white rounded-xl text-sm font-medium"
                        >
                          Check My Eligibility
                        </button>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-[#1A1A1A] mb-2">Best Providers</h4>
                        <div className="space-y-2">
                          {INVESTMENT_ACCOUNTS.find(a => a.id === 'roth_ira')?.providers.map((provider) => (
                            <button
                              key={provider.id}
                              onClick={() => handleAccountClick(provider, 'ira')}
                              className="w-full p-3 bg-[#F5F4F2] rounded-xl flex items-center justify-between hover:bg-[#EEEDEB] transition-colors"
                            >
                              <div className="text-left">
                                <p className="text-sm font-medium text-[#1A1A1A]">{provider.name}</p>
                                <p className="text-xs text-[#6B6B6B]">Min: ${provider.min_investment}</p>
                              </div>
                              <span className="text-[#6B6B6B]">→</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 401(k) Section */}
            <div className="bg-white rounded-2xl border border-[#E8E6E3] overflow-hidden">
              <button
                onClick={() => setExpandedInvestment(expandedInvestment === '401k' ? null : '401k')}
                className="w-full p-4 text-left"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                      <span className="text-lg">💼</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-[#1A1A1A]">401(k)</h3>
                      <p className="text-xs text-[#6B6B6B]">Employer retirement plan</p>
                    </div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-[#6B6B6B] transition-transform ${expandedInvestment === '401k' ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              <AnimatePresence>
                {expandedInvestment === '401k' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-[#E8E6E3] overflow-hidden"
                  >
                    <div className="p-4 space-y-4">
                      <div className="bg-purple-50 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">🎁</span>
                          <p className="text-sm font-medium text-purple-800">Employer Match = Free Money</p>
                        </div>
                        <p className="text-sm text-purple-700 leading-relaxed">
                          Many employers match your contributions (e.g., they put in $1 for every $1 you contribute, up to 3-6% of salary).
                          <strong> Always contribute at least enough to get the full match.</strong>
                        </p>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-[#1A1A1A] mb-2">2024 Limit</h4>
                        <p className="text-2xl font-light text-[#1A1A1A]">$23,000</p>
                        <p className="text-xs text-[#6B6B6B]">employee contribution limit</p>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-[#1A1A1A] mb-2">How to start</h4>
                        <ol className="text-sm text-[#6B6B6B] space-y-2">
                          <li className="flex gap-2">
                            <span className="text-[#1A1A1A] font-medium">1.</span>
                            Check if your employer offers a 401(k)
                          </li>
                          <li className="flex gap-2">
                            <span className="text-[#1A1A1A] font-medium">2.</span>
                            Ask HR about the employer match percentage
                          </li>
                          <li className="flex gap-2">
                            <span className="text-[#1A1A1A] font-medium">3.</span>
                            Contribute at least enough to get the full match
                          </li>
                          <li className="flex gap-2">
                            <span className="text-[#1A1A1A] font-medium">4.</span>
                            Choose a target-date fund for easy investing
                          </li>
                        </ol>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* HSA Section */}
            <div className="bg-white rounded-2xl border border-[#E8E6E3] overflow-hidden">
              <button
                onClick={() => setExpandedInvestment(expandedInvestment === 'hsa' ? null : 'hsa')}
                className="w-full p-4 text-left"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <span className="text-lg">🏥</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-[#1A1A1A]">HSA</h3>
                      <p className="text-xs text-[#6B6B6B]">Health Savings Account</p>
                    </div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-[#6B6B6B] transition-transform ${expandedInvestment === 'hsa' ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              <AnimatePresence>
                {expandedInvestment === 'hsa' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-[#E8E6E3] overflow-hidden"
                  >
                    <div className="p-4 space-y-4">
                      <div className="bg-green-50 rounded-xl p-4">
                        <p className="text-sm font-medium text-green-800 mb-2">Triple Tax Advantage</p>
                        <ul className="text-sm text-green-700 space-y-1">
                          <li className="flex items-center gap-2">
                            <span>✓</span> Contributions are tax-deductible
                          </li>
                          <li className="flex items-center gap-2">
                            <span>✓</span> Growth is tax-free
                          </li>
                          <li className="flex items-center gap-2">
                            <span>✓</span> Withdrawals for medical are tax-free
                          </li>
                        </ul>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-[#1A1A1A] mb-2">Requirements</h4>
                        <p className="text-sm text-[#6B6B6B]">
                          You must have a High Deductible Health Plan (HDHP) to open an HSA.
                          Check with your employer or health insurance provider.
                        </p>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-[#1A1A1A] mb-2">2024 Limit</h4>
                        <p className="text-2xl font-light text-[#1A1A1A]">$4,150</p>
                        <p className="text-xs text-[#6B6B6B]">individual coverage</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* GOALS TAB */}
        {activeTab === 'goals' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {savingsGoals.map((goal) => {
              const progress = Math.min(100, (goal.current_amount / goal.target_amount) * 100);
              const remaining = goal.target_amount - goal.current_amount;
              const monthsToGoal = calculateMonthsToGoal(goal.current_amount, goal.target_amount, 200);

              return (
                <motion.div
                  key={goal.id}
                  className="bg-white rounded-2xl p-5 border border-[#E8E6E3]"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-medium text-[#1A1A1A]">{goal.name}</h3>
                      <p className="text-xs text-[#6B6B6B] mt-0.5">
                        {goal.category === 'emergency' ? '🛡️ Safety net' : '🎯 Goal'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-medium text-[#1A1A1A]">
                        ${goal.current_amount.toLocaleString()}
                      </p>
                      <p className="text-xs text-[#6B6B6B]">
                        of ${goal.target_amount.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-3 bg-[#F5F4F2] rounded-full overflow-hidden mb-3">
                    <motion.div
                      className={`h-full rounded-full ${progress >= 100 ? 'bg-emerald-500' : 'bg-black'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#6B6B6B]">
                    <span>{progress.toFixed(0)}% complete</span>
                    <span>${remaining.toLocaleString()} to go</span>
                  </div>

                  {progress < 100 && (
                    <div className="mt-4 pt-4 border-t border-[#E8E6E3]">
                      <p className="text-sm text-[#6B6B6B]">
                        Save <strong className="text-[#1A1A1A]">$200/month</strong> and you'll reach this goal in{' '}
                        <strong className="text-emerald-600">{monthsToGoal} months</strong>
                      </p>
                    </div>
                  )}

                  {progress >= 100 && (
                    <div className="mt-4 pt-4 border-t border-[#E8E6E3]">
                      <p className="text-sm text-emerald-600 font-medium flex items-center gap-2">
                        <span>🎉</span> Goal reached! Great job!
                      </p>
                    </div>
                  )}

                  {/* Quick Update */}
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => updateGoalAmount(goal.id, goal.current_amount + 50)}
                      className="flex-1 py-2 bg-[#F5F4F2] rounded-lg text-sm text-[#1A1A1A] hover:bg-[#EEEDEB] transition-colors"
                    >
                      +$50
                    </button>
                    <button
                      onClick={() => updateGoalAmount(goal.id, goal.current_amount + 100)}
                      className="flex-1 py-2 bg-[#F5F4F2] rounded-lg text-sm text-[#1A1A1A] hover:bg-[#EEEDEB] transition-colors"
                    >
                      +$100
                    </button>
                    <button
                      onClick={() => updateGoalAmount(goal.id, goal.current_amount + 500)}
                      className="flex-1 py-2 bg-[#F5F4F2] rounded-lg text-sm text-[#1A1A1A] hover:bg-[#EEEDEB] transition-colors"
                    >
                      +$500
                    </button>
                  </div>
                </motion.div>
              );
            })}

            {/* Add Goal Button */}
            <button
              onClick={addGoal}
              className="w-full py-4 border-2 border-dashed border-[#E8E6E3] rounded-2xl text-sm text-[#6B6B6B] hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-colors"
            >
              + Add a new savings goal
            </button>
          </motion.div>
        )}
      </div>

      {/* Eligibility Quiz Modal */}
      <AnimatePresence>
        {showEligibilityQuiz && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-white w-full max-w-lg rounded-t-3xl max-h-[85vh] overflow-y-auto"
            >
              <div className="sticky top-0 bg-white pt-3 pb-2 flex justify-center border-b border-[#E8E6E3]">
                <div className="w-10 h-1 bg-gray-300 rounded-full" />
              </div>

              <div className="p-6">
                {!quizResult ? (
                  <>
                    <h2 className="text-xl font-medium text-[#1A1A1A] mb-2">Can I Open a Roth IRA?</h2>
                    <p className="text-sm text-[#6B6B6B] mb-6">Let's check your eligibility. This takes 30 seconds.</p>

                    <div className="space-y-6">
                      {ROTH_IRA_ELIGIBILITY_QUESTIONS.map((q, idx) => (
                        <div key={q.id}>
                          <p className="text-sm font-medium text-[#1A1A1A] mb-3">
                            {idx + 1}. {q.question}
                          </p>
                          <div className="space-y-2">
                            {q.options.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => setQuizAnswers(prev => ({ ...prev, [q.id]: opt.value }))}
                                className={`w-full p-3 rounded-xl border-2 text-left text-sm transition-all ${
                                  quizAnswers[q.id] === opt.value
                                    ? 'border-black bg-black text-white'
                                    : 'border-[#E8E6E3] text-[#1A1A1A] hover:border-[#6B6B6B]'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 mt-8">
                      <button
                        onClick={() => {
                          setShowEligibilityQuiz(false);
                          setQuizAnswers({});
                        }}
                        className="flex-1 py-3 border border-[#E8E6E3] rounded-xl text-sm font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleQuizComplete}
                        disabled={Object.keys(quizAnswers).length < ROTH_IRA_ELIGIBILITY_QUESTIONS.length}
                        className="flex-1 py-3 bg-black text-white rounded-xl text-sm font-medium disabled:opacity-50"
                      >
                        Check Eligibility
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`text-center py-6 ${quizResult.eligible ? 'text-emerald-600' : 'text-amber-600'}`}>
                      <span className="text-5xl">
                        {quizResult.eligible ? '🎉' : '📝'}
                      </span>
                    </div>

                    <h2 className="text-xl font-medium text-[#1A1A1A] mb-2 text-center">
                      {quizResult.eligible ? 'You Can Open a Roth IRA!' : 'Not Yet, But That\'s Okay'}
                    </h2>

                    <p className="text-sm text-[#6B6B6B] mb-6 text-center">{quizResult.reason}</p>

                    <div className="bg-[#F5F4F2] rounded-xl p-4 mb-6">
                      <h3 className="text-sm font-medium text-[#1A1A1A] mb-2">Next Steps</h3>
                      <ul className="space-y-2">
                        {quizResult.nextSteps.map((step, idx) => (
                          <li key={idx} className="text-sm text-[#6B6B6B] flex items-start gap-2">
                            <span className="text-[#1A1A1A]">{idx + 1}.</span>
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {quizResult.alternativeOptions && (
                      <div className="mb-6">
                        <h3 className="text-sm font-medium text-[#1A1A1A] mb-2">In the meantime...</h3>
                        <div className="flex flex-wrap gap-2">
                          {quizResult.alternativeOptions.map((opt, idx) => (
                            <span key={idx} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full">
                              {opt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => {
                        setShowEligibilityQuiz(false);
                        setQuizAnswers({});
                        setQuizResult(null);
                      }}
                      className="w-full py-3 bg-black text-white rounded-xl text-sm font-medium"
                    >
                      Got It
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}
