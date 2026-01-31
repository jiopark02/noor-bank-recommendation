'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  getSavingsAccountsByCountry,
  getInvestmentAccountsByCountry,
  UK_SAVINGS_ACCOUNTS,
  UK_INVESTMENT_ACCOUNTS,
  CA_SAVINGS_ACCOUNTS,
  CA_INVESTMENT_ACCOUNTS,
  Country,
} from '@/lib/savingsData';
import {
  UserLevel,
  getUserFinanceLevel,
  getSmartMessage,
  calculateProgressSteps,
  FinanceProgress,
  CATEGORY_INFO,
  getTipsByCategoryAndLevel,
  TipCategory,
  calculateEmergencyFund,
} from '@/lib/financeProTips';

type TabType = 'start' | 'levelup' | 'goals';

const TABS = [
  { id: 'start', label: 'Start Here' },
  { id: 'levelup', label: 'Level Up' },
  { id: 'goals', label: 'My Goals' },
];

const STORAGE_KEY_FINANCE_PROGRESS = 'noor_finance_progress';

export default function GrowPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('start');
  const [userLevel, setUserLevel] = useState<UserLevel>('beginner');
  const [userProfile, setUserProfile] = useState<{
    academicLevel?: string;
    year?: number;
    visaStatus?: string;
    studentLevel?: string;
  }>({});
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [showEligibilityQuiz, setShowEligibilityQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizResult, setQuizResult] = useState<EligibilityResult | null>(null);
  const [calculatorAmount, setCalculatorAmount] = useState(5000);
  const [showEmergencyGuide, setShowEmergencyGuide] = useState(false);
  const [expandedHYSA, setExpandedHYSA] = useState<string | null>(null);
  const [expandedInvestment, setExpandedInvestment] = useState<string | null>(null);
  const [financeProgress, setFinanceProgress] = useState<FinanceProgress>({
    hasEmergencyFund: false,
    hasHYSA: false,
    hasCreditCard: false,
    noHighInterestDebt: true,
    has401kMatch: false,
    hasRothIRA: false,
    fullEmergencyFund: false,
    hasHSA: false,
    max401k: false,
    hasTaxableBrokerage: false,
  });
  const [monthlyExpenses, setMonthlyExpenses] = useState(2000);
  const [showProgressEditor, setShowProgressEditor] = useState(false);
  const [userCountry, setUserCountry] = useState<Country>('US');

  useEffect(() => {
    const userId = localStorage.getItem('noor_user_id');
    if (!userId) {
      router.push('/welcome');
      return;
    }

    // Load country
    const savedCountry = localStorage.getItem('noor_selected_country');
    if (savedCountry && (savedCountry === 'US' || savedCountry === 'UK' || savedCountry === 'CA')) {
      setUserCountry(savedCountry as Country);
    }

    // Load user profile to determine level
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      try {
        const parsed = JSON.parse(profile);
        setUserProfile(parsed);

        // Calculate user level based on profile
        const level = getUserFinanceLevel({
          studentLevel: parsed.studentLevel,
          academicLevel: parsed.academicLevel,
          year: parsed.graduationYear ? new Date().getFullYear() - (parseInt(parsed.graduationYear) - 4) : undefined,
          visaStatus: parsed.visaStatus,
        });
        setUserLevel(level);
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

    // Load finance progress
    const savedProgress = localStorage.getItem(STORAGE_KEY_FINANCE_PROGRESS);
    if (savedProgress) {
      setFinanceProgress(JSON.parse(savedProgress));
    }
  }, [router]);

  // Save goals when they change
  useEffect(() => {
    if (savingsGoals.length > 0) {
      localStorage.setItem(STORAGE_KEY_SAVINGS_GOALS, JSON.stringify(savingsGoals));
    }
  }, [savingsGoals]);

  // Save progress when it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_FINANCE_PROGRESS, JSON.stringify(financeProgress));
  }, [financeProgress]);

  // Get smart message based on user profile
  const smartMessage = useMemo(() => {
    // Calculate year in school from graduation year
    let year: number | undefined;
    if (userProfile.academicLevel === "Bachelor's") {
      const gradYear = parseInt(localStorage.getItem('noor_graduation_year') || '0');
      if (gradYear) {
        year = 4 - (gradYear - new Date().getFullYear());
      }
    }

    return getSmartMessage({
      ...userProfile,
      year,
    });
  }, [userProfile]);

  // Calculate progress
  const progressInfo = useMemo(() => {
    return calculateProgressSteps(financeProgress, userLevel);
  }, [financeProgress, userLevel]);

  // Get country-specific accounts
  const savingsAccounts = useMemo(() => {
    return getSavingsAccountsByCountry(userCountry);
  }, [userCountry]);

  const investmentAccounts = useMemo(() => {
    return getInvestmentAccountsByCountry(userCountry);
  }, [userCountry]);

  // Currency symbol based on country
  const currencySymbol = useMemo(() => {
    switch (userCountry) {
      case 'UK': return '£';
      case 'CA': return 'C$';
      default: return '$';
    }
  }, [userCountry]);

  // Get the best rate from available accounts
  const bestSavingsRate = useMemo(() => {
    if (userCountry === 'UK') {
      return Math.max(...UK_SAVINGS_ACCOUNTS.map(a => a.aer));
    } else if (userCountry === 'CA') {
      return Math.max(...CA_SAVINGS_ACCOUNTS.map(a => a.interest_rate));
    }
    return Math.max(...HYSA_ACCOUNTS.map(a => a.apy));
  }, [userCountry]);

  // Calculate HYSA earnings
  const hysaEarnings = useMemo(() => {
    return calculateHYSAEarnings(calculatorAmount, bestSavingsRate);
  }, [calculatorAmount, bestSavingsRate]);

  // Emergency fund recommendation
  const emergencyFundTarget = useMemo(() => {
    return calculateEmergencyFund(monthlyExpenses, true);
  }, [monthlyExpenses]);

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

  // Toggle progress item
  const toggleProgress = (key: keyof FinanceProgress) => {
    setFinanceProgress(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Get categories available for user level
  const availableCategories = useMemo(() => {
    const levelOrder: UserLevel[] = ['beginner', 'intermediate', 'advanced'];
    const userLevelIndex = levelOrder.indexOf(userLevel);

    return Object.entries(CATEGORY_INFO).filter(([_, info]) => {
      const minLevelIndex = levelOrder.indexOf(info.minLevel);
      return minLevelIndex <= userLevelIndex;
    });
  }, [userLevel]);

  // Get locked categories (teaser for beginners)
  const lockedCategories = useMemo(() => {
    const levelOrder: UserLevel[] = ['beginner', 'intermediate', 'advanced'];
    const userLevelIndex = levelOrder.indexOf(userLevel);

    return Object.entries(CATEGORY_INFO).filter(([_, info]) => {
      const minLevelIndex = levelOrder.indexOf(info.minLevel);
      return minLevelIndex > userLevelIndex;
    });
  }, [userLevel]);

  return (
    <div className="min-h-screen bg-[#FAF9F7] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[#E8E6E3]">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-light text-[#1A1A1A] tracking-tight">Grow</h1>
              <p className="text-sm text-[#6B6B6B] mt-1">Savings & Investing</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded-full ${
                userLevel === 'beginner' ? 'bg-green-100 text-green-700' :
                userLevel === 'intermediate' ? 'bg-blue-100 text-blue-700' :
                'bg-purple-100 text-purple-700'
              }`}>
                {userLevel === 'beginner' ? 'Foundations' :
                 userLevel === 'intermediate' ? 'Building' : 'Optimizing'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Smart Message & Progress */}
      <div className="px-4 py-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-4 border border-[#E8E6E3]"
        >
          <h2 className="text-lg font-medium text-[#1A1A1A]">{smartMessage.title}</h2>
          <p className="text-sm text-[#6B6B6B] mt-1 leading-relaxed">{smartMessage.subtitle}</p>

          {/* Progress Bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-[#6B6B6B]">Your progress</span>
              <span className="text-[#1A1A1A] font-medium">{progressInfo.completed}/{progressInfo.total} steps</span>
            </div>
            <div className="h-2 bg-[#F5F4F2] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(progressInfo.completed / progressInfo.total) * 100}%` }}
                transition={{ duration: 0.8 }}
              />
            </div>
            <p className="text-xs text-emerald-600 mt-2">Next: {progressInfo.nextStep}</p>
          </div>

          {/* Edit Progress Button */}
          <button
            onClick={() => setShowProgressEditor(!showProgressEditor)}
            className="mt-3 text-xs text-[#6B6B6B] underline"
          >
            {showProgressEditor ? 'Hide checklist' : 'Update my progress'}
          </button>

          <AnimatePresence>
            {showProgressEditor && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-3 pt-3 border-t border-[#E8E6E3] overflow-hidden"
              >
                <div className="space-y-2">
                  {[
                    { key: 'hasEmergencyFund', label: 'Started emergency fund' },
                    { key: 'hasHYSA', label: 'Opened a HYSA' },
                    { key: 'hasCreditCard', label: 'Have a credit card' },
                    { key: 'noHighInterestDebt', label: 'No credit card debt' },
                    ...(userLevel !== 'beginner' ? [
                      { key: 'has401kMatch', label: 'Getting 401(k) match' },
                      { key: 'hasRothIRA', label: 'Opened Roth IRA' },
                      { key: 'fullEmergencyFund', label: '6 months emergency fund' },
                    ] : []),
                    ...(userLevel === 'advanced' ? [
                      { key: 'hasHSA', label: 'Using HSA' },
                      { key: 'max401k', label: 'Maxing 401(k)' },
                      { key: 'hasTaxableBrokerage', label: 'Taxable investing' },
                    ] : []),
                  ].map((item) => (
                    <button
                      key={item.key}
                      onClick={() => toggleProgress(item.key as keyof FinanceProgress)}
                      className="flex items-center gap-3 w-full text-left"
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                        financeProgress[item.key as keyof FinanceProgress]
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'border-gray-300'
                      }`}>
                        {financeProgress[item.key as keyof FinanceProgress] && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className="text-sm text-[#1A1A1A]">{item.label}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Pro Tips Banner */}
        <Link href="/grow/tips">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-3 bg-gradient-to-r from-black to-gray-800 rounded-2xl p-4 text-white"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">Pro Tips Library</h3>
                <p className="text-xs text-gray-300 mt-0.5">
                  {userLevel === 'beginner' ? '50+ tips for getting started' :
                   userLevel === 'intermediate' ? '70+ tips for leveling up' :
                   '80+ tips for optimization'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-1 bg-white/20 rounded-full">Personalized</span>
                <span className="text-xl">→</span>
              </div>
            </div>
          </motion.div>
        </Link>
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
                    <p className="text-xs text-[#6B6B6B]">Your financial safety net</p>
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

                    {/* Emergency Fund Calculator */}
                    <div className="mt-4 p-4 bg-emerald-50 rounded-xl">
                      <h4 className="text-sm font-medium text-emerald-800 mb-2">How much do YOU need?</h4>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm text-emerald-700">Monthly expenses: $</span>
                        <input
                          type="number"
                          value={monthlyExpenses}
                          onChange={(e) => setMonthlyExpenses(parseInt(e.target.value) || 0)}
                          className="w-20 px-2 py-1 border border-emerald-200 rounded text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-emerald-600">Minimum (3 months): ${emergencyFundTarget.minimum.toLocaleString()}</p>
                        <p className="text-sm text-emerald-800 font-medium">Recommended (6 months): ${emergencyFundTarget.recommended.toLocaleString()}</p>
                        <p className="text-xs text-emerald-600">With flight buffer: ${emergencyFundTarget.withFlightBuffer.toLocaleString()}</p>
                      </div>
                    </div>
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
            {/* Level indicator */}
            <div className="flex gap-2 mb-2">
              {[
                { id: 'beginner', label: 'Foundations', color: 'green' },
                { id: 'intermediate', label: 'Building', color: 'blue' },
                { id: 'advanced', label: 'Optimizing', color: 'purple' },
              ].map((level) => (
                <div
                  key={level.id}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium text-center ${
                    userLevel === level.id
                      ? level.color === 'green' ? 'bg-green-100 text-green-700 border-2 border-green-300' :
                        level.color === 'blue' ? 'bg-blue-100 text-blue-700 border-2 border-blue-300' :
                        'bg-purple-100 text-purple-700 border-2 border-purple-300'
                      : 'bg-gray-50 text-gray-400'
                  }`}
                >
                  {level.label}
                  {userLevel === level.id && ' ✓'}
                </div>
              ))}
            </div>

            {/* Beginner Lock Message */}
            {userLevel === 'beginner' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm text-amber-800">
                  <span className="font-medium">Retirement accounts unlock later.</span> Focus on building your emergency fund and credit first. You're on the right track!
                </p>
              </div>
            )}

            {/* Available Categories */}
            {userLevel !== 'beginner' && (
              <>
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
                              F-1 students on OPT (after 5 years), H-1B workers, and permanent residents can usually open one.
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
                              Many employers match your contributions. If they match 50% up to 6% of salary,
                              <strong> always contribute at least 6%</strong> to get the full match.
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
              </>
            )}

            {/* HSA Section - Advanced only */}
            {userLevel === 'advanced' && (
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
                        <p className="text-xs text-[#6B6B6B]">Health Savings Account - Triple tax advantage</p>
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
                          <p className="text-xs text-[#6B6B6B]">individual coverage ($8,300 family)</p>
                        </div>

                        <div className="bg-amber-50 rounded-xl p-3">
                          <p className="text-xs text-amber-800">
                            <span className="font-medium">Pro Tip:</span> Pay medical expenses out of pocket, keep receipts, invest HSA, and reimburse yourself years later for maximum tax-free growth.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Locked Categories Preview */}
            {lockedCategories.length > 0 && (
              <div className="mt-6">
                <h4 className="text-xs text-[#6B6B6B] mb-3 px-1">Coming up next...</h4>
                <div className="space-y-2">
                  {lockedCategories.slice(0, 3).map(([key, info]) => (
                    <div
                      key={key}
                      className="bg-gray-50 rounded-xl p-3 flex items-center justify-between opacity-60"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg grayscale">{info.icon}</span>
                        <div>
                          <p className="text-sm text-gray-500">{info.label}</p>
                          <p className="text-xs text-gray-400">{info.description}</p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">🔒</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
