'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { PageLayout } from '@/components/layout';
import { useTheme } from '@/contexts/ThemeContext';
import {
  generateNotifications,
  getReadNotifications,
  formatReminderDate,
  Notification,
} from '@/lib/notificationsData';

// Financial setup items
interface SetupItem {
  id: string;
  title: string;
  status: 'done' | 'in_progress' | 'upcoming' | 'not_started';
  href: string;
  description?: string;
}

// Journey steps
interface JourneyStep {
  id: string;
  title: string;
  status: 'completed' | 'current' | 'upcoming';
  description: string;
}

// Quick action
interface QuickAction {
  id: string;
  label: string;
  prompt: string;
}

const STORAGE_KEY_SETUP = 'noor_financial_setup';
const STORAGE_KEY_BUDGET = 'noor_budget';

// Default setup items
const DEFAULT_SETUP_ITEMS: SetupItem[] = [
  { id: 'bank', title: 'Bank Account', status: 'not_started', href: '/banking' },
  { id: 'phone', title: 'Phone Plan', status: 'not_started', href: '/guides/phone' },
  { id: 'credit', title: 'Credit Card', status: 'not_started', href: '/funding' },
  { id: 'tax', title: 'Tax Filing', status: 'upcoming', href: '/guides/tax' },
  { id: 'visa', title: 'Visa Renewal', status: 'not_started', href: '/visa' },
];

// Journey steps
const JOURNEY_STEPS: JourneyStep[] = [
  { id: 'arrived', title: 'Arrived', status: 'completed', description: 'Welcome to the US!' },
  { id: 'bank', title: 'Bank Account', status: 'completed', description: 'Financial foundation set' },
  { id: 'housing', title: 'Housing', status: 'completed', description: 'Found your home' },
  { id: 'credit', title: 'Credit Building', status: 'current', description: 'Building your credit score' },
  { id: 'tax', title: 'Tax Ready', status: 'upcoming', description: 'Prepared for tax season' },
];

// Quick AI prompts
const AI_QUICK_ACTIONS: QuickAction[] = [
  { id: 'credit', label: 'How do I build credit?', prompt: 'How do I build credit as an international student?' },
  { id: 'tax', label: 'When is tax season?', prompt: 'When is tax season and what forms do I need as an F-1 student?' },
  { id: 'ssn', label: 'Do I need SSN?', prompt: 'Do I need an SSN for a bank account?' },
  { id: 'opt', label: 'OPT explained', prompt: 'Explain OPT and when should I apply?' },
];

export default function HomePage() {
  const router = useRouter();
  const { theme, useSchoolTheme } = useTheme();
  const [userName, setUserName] = useState('there');
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [setupItems, setSetupItems] = useState<SetupItem[]>(DEFAULT_SETUP_ITEMS);
  const [journeySteps, setJourneySteps] = useState<JourneyStep[]>(JOURNEY_STEPS);
  const [budget, setBudget] = useState({ total: 2000, spent: 1247 });
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [showAIChat, setShowAIChat] = useState(false);
  const [userProfile, setUserProfile] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const userId = localStorage.getItem('noor_user_id');
    if (!userId) {
      router.push('/welcome');
      return;
    }

    // Load user profile
    const profileData = localStorage.getItem('noor_user_profile');
    if (profileData) {
      try {
        const profile = JSON.parse(profileData);
        setUserProfile(profile);
        if (profile.firstName) {
          setUserName(profile.firstName);
        }

        // Update setup items based on profile
        const updatedSetup = [...DEFAULT_SETUP_ITEMS];
        if (profile.has_bank_account) {
          const bankItem = updatedSetup.find(i => i.id === 'bank');
          if (bankItem) bankItem.status = 'done';
        }
        if (profile.has_phone) {
          const phoneItem = updatedSetup.find(i => i.id === 'phone');
          if (phoneItem) phoneItem.status = 'done';
        }
        if (profile.has_credit_card) {
          const creditItem = updatedSetup.find(i => i.id === 'credit');
          if (creditItem) creditItem.status = 'done';
        }
        setSetupItems(updatedSetup);
      } catch (e) {
        // ignore parse errors
      }
    }

    // Load saved setup state
    const savedSetup = localStorage.getItem(STORAGE_KEY_SETUP);
    if (savedSetup) {
      try {
        setSetupItems(JSON.parse(savedSetup));
      } catch (e) {
        // ignore
      }
    }

    // Load budget
    const savedBudget = localStorage.getItem(STORAGE_KEY_BUDGET);
    if (savedBudget) {
      try {
        setBudget(JSON.parse(savedBudget));
      } catch (e) {
        // ignore
      }
    }

    // Load notifications
    const notifs = generateNotifications();
    const read = getReadNotifications();
    setNotifications(notifs);
    setReadNotifications(read);

    setIsLoading(false);
  }, [router]);

  // Save setup items
  useEffect(() => {
    if (setupItems !== DEFAULT_SETUP_ITEMS) {
      localStorage.setItem(STORAGE_KEY_SETUP, JSON.stringify(setupItems));
    }
  }, [setupItems]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  // Calculate financial health percentage
  const healthPercentage = useMemo(() => {
    const completed = setupItems.filter(i => i.status === 'done').length;
    return Math.round((completed / setupItems.length) * 100);
  }, [setupItems]);

  // Get status icon
  const getStatusIcon = (status: SetupItem['status']) => {
    switch (status) {
      case 'done': return '✓';
      case 'in_progress': return '↻';
      case 'upcoming': return '◷';
      default: return '○';
    }
  };

  // Get status color
  const getStatusColor = (status: SetupItem['status']) => {
    switch (status) {
      case 'done': return 'text-green-500 bg-green-50';
      case 'in_progress': return 'text-blue-500 bg-blue-50';
      case 'upcoming': return 'text-amber-500 bg-amber-50';
      default: return 'text-gray-400 bg-gray-50';
    }
  };

  // Toggle setup item status
  const toggleSetupItem = (id: string) => {
    setSetupItems(prev => prev.map(item => {
      if (item.id === id) {
        const nextStatus: Record<SetupItem['status'], SetupItem['status']> = {
          'not_started': 'in_progress',
          'in_progress': 'done',
          'done': 'not_started',
          'upcoming': 'in_progress',
        };
        return { ...item, status: nextStatus[item.status] };
      }
      return item;
    }));
  };

  // Get urgent notifications (Don't Miss)
  const dontMissItems = useMemo(() => {
    return notifications
      .filter(n => !readNotifications.includes(n.id))
      .filter(n => n.severity === 'urgent' || n.severity === 'warning')
      .slice(0, 3);
  }, [notifications, readNotifications]);

  // This week items
  const thisWeekItems = useMemo(() => {
    return notifications
      .filter(n => !readNotifications.includes(n.id))
      .filter(n => n.days_until <= 7 && n.days_until > 0)
      .slice(0, 4);
  }, [notifications, readNotifications]);

  // Budget calculations
  const budgetRemaining = budget.total - budget.spent;
  const budgetPercentUsed = Math.round((budget.spent / budget.total) * 100);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <motion.div
          className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    );
  }

  return (
    <PageLayout userName={userName}>
      {/* Header with greeting and school logo */}
      <header className="mb-6 flex items-center justify-between">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-2xl font-semibold text-black">
            {getGreeting()}, {userName}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Let's check your progress
          </p>
        </motion.div>
        {useSchoolTheme && theme.logo_url && (
          <motion.img
            src={theme.logo_url}
            alt="School"
            className="w-10 h-10 object-contain rounded-lg"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          />
        )}
      </header>

      {/* Financial Health Tracker - Main Card */}
      <motion.section
        className="mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <motion.div
          className="noor-card p-6 cursor-pointer"
          onClick={() => setExpandedCard(expandedCard === 'health' ? null : 'health')}
          whileTap={{ scale: 0.98 }}
          style={{
            background: useSchoolTheme
              ? `linear-gradient(135deg, ${theme.primary_color}10 0%, white 100%)`
              : 'linear-gradient(135deg, #f8f9fa 0%, white 100%)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Your Financial Health
              </h2>
              <p className="text-sm text-gray-600">
                {healthPercentage === 100
                  ? "You're all set! Great job."
                  : `${setupItems.filter(i => i.status === 'done').length} of ${setupItems.length} tasks completed`}
              </p>
            </div>

            {/* Circular Progress */}
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 transform -rotate-90">
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  stroke="#E5E7EB"
                  strokeWidth="6"
                  fill="none"
                />
                <motion.circle
                  cx="40"
                  cy="40"
                  r="34"
                  stroke={useSchoolTheme ? theme.primary_color : '#000000'}
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                  initial={{ strokeDasharray: '0 214' }}
                  animate={{ strokeDasharray: `${(healthPercentage / 100) * 214} 214` }}
                  transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.span
                  className="text-xl font-semibold text-black"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  {healthPercentage}%
                </motion.span>
              </div>
            </div>
          </div>

          {/* Expanded Setup Items */}
          <AnimatePresence>
            {expandedCard === 'health' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-5 pt-5 border-t border-gray-100 overflow-hidden"
              >
                <div className="space-y-3">
                  {setupItems.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSetupItem(item.id);
                          }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium transition-all ${getStatusColor(item.status)}`}
                        >
                          {getStatusIcon(item.status)}
                        </button>
                        <span className={`text-sm ${item.status === 'done' ? 'text-gray-400 line-through' : 'text-black'}`}>
                          {item.title}
                        </span>
                      </div>
                      <Link
                        href={item.href}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-gray-400 hover:text-black transition-colors"
                      >
                        {item.status === 'done' ? 'View' : 'Start'} →
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Expand indicator */}
          <div className="flex justify-center mt-4">
            <motion.div
              animate={{ rotate: expandedCard === 'health' ? 180 : 0 }}
              transition={{ duration: 0.3 }}
            >
              <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </motion.div>
          </div>
        </motion.div>
      </motion.section>

      {/* Quick Glance - Budget Card */}
      <motion.section
        className="mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <motion.div
          className="noor-card p-5 cursor-pointer"
          onClick={() => setExpandedCard(expandedCard === 'budget' ? null : 'budget')}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              This Month's Budget
            </h2>
            <span className="text-xs text-gray-400">
              {new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </span>
          </div>

          <div className="flex items-end justify-between mb-4">
            <div>
              <p className="text-3xl font-semibold text-black">
                ${budgetRemaining.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 mt-1">remaining</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">
                <span className="text-black font-medium">${budget.spent.toLocaleString()}</span> of ${budget.total.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${budgetPercentUsed > 90 ? 'bg-red-500' : budgetPercentUsed > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
              initial={{ width: 0 }}
              animate={{ width: `${budgetPercentUsed}%` }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.4 }}
            />
          </div>

          <AnimatePresence>
            {expandedCard === 'budget' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-4 pt-4 border-t border-gray-100 overflow-hidden"
              >
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-gray-50 rounded-xl">
                    <p className="text-lg font-semibold text-black">${budget.total.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">Budget</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-xl">
                    <p className="text-lg font-semibold text-black">${budget.spent.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">Spent</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-xl">
                    <p className="text-lg font-semibold text-green-600">${budgetRemaining.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">Left</p>
                  </div>
                </div>
                <Link
                  href="/money"
                  className="block w-full mt-4 py-2 text-center text-sm font-medium text-gray-600 hover:text-black transition-colors"
                >
                  Manage Budget →
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.section>

      {/* Don't Miss - Urgent Alerts */}
      <AnimatePresence>
        {dontMissItems.length > 0 && (
          <motion.section
            className="mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
              Don't Miss
            </h2>
            <div className="space-y-2">
              {dontMissItems.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className={`noor-card px-4 py-3 flex items-center justify-between ${
                    item.severity === 'urgent' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      item.severity === 'urgent' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                    }`}>
                      {item.severity === 'urgent' ? 'URGENT' : 'SOON'}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-black">{item.title}</p>
                      <p className="text-xs text-gray-500">{item.message}</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">{item.days_until}d</span>
                </motion.div>
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* This Week Timeline */}
      {thisWeekItems.length > 0 && (
        <motion.section
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            This Week
          </h2>
          <div className="noor-card p-4">
            <div className="space-y-4">
              {thisWeekItems.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  className="flex items-start gap-3"
                >
                  <div className="flex flex-col items-center">
                    <div className={`w-3 h-3 rounded-full ${
                      item.days_until <= 1 ? 'bg-red-500' : item.days_until <= 3 ? 'bg-amber-500' : 'bg-gray-300'
                    }`} />
                    {index < thisWeekItems.length - 1 && (
                      <div className="w-0.5 h-8 bg-gray-200 mt-1" />
                    )}
                  </div>
                  <div className="flex-1 pb-2">
                    <p className="text-sm font-medium text-black">{item.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.days_until === 1 ? 'Tomorrow' : `In ${item.days_until} days`} · {formatReminderDate(item.due_date)}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>
      )}

      {/* Your Journey Progress */}
      <motion.section
        className="mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          Your Journey
        </h2>
        <div className="noor-card p-5">
          <div className="relative">
            {/* Progress line */}
            <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-gray-200" />
            <motion.div
              className="absolute left-[11px] top-3 w-0.5 bg-black"
              initial={{ height: 0 }}
              animate={{ height: `${(journeySteps.filter(s => s.status === 'completed').length / journeySteps.length) * 100}%` }}
              transition={{ duration: 1, delay: 0.6 }}
            />

            {/* Steps */}
            <div className="space-y-5">
              {journeySteps.map((step, index) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + index * 0.1 }}
                  className="flex items-start gap-4 relative"
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                    step.status === 'completed'
                      ? 'bg-black text-white'
                      : step.status === 'current'
                      ? 'bg-blue-500 text-white animate-pulse'
                      : 'bg-gray-200 text-gray-400'
                  }`}>
                    {step.status === 'completed' ? (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : step.status === 'current' ? (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    ) : (
                      <span className="text-xs">{index + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 pt-0.5">
                    <p className={`text-sm font-medium ${
                      step.status === 'completed' ? 'text-black' : step.status === 'current' ? 'text-blue-600' : 'text-gray-400'
                    }`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
                  </div>
                  {step.status === 'completed' && (
                    <span className="text-green-500 text-xs font-medium">✓</span>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.section>

      {/* AI Quick Actions */}
      <motion.section
        className="mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Ask Noor AI
          </h2>
          <Link href="/chat" className="text-xs text-gray-400 hover:text-black transition-colors">
            Open chat →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {AI_QUICK_ACTIONS.map((action, index) => (
            <motion.button
              key={action.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.7 + index * 0.05 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                // Store the prompt and open chat
                localStorage.setItem('noor_quick_prompt', action.prompt);
                router.push('/chat');
              }}
              className="noor-card p-4 text-left hover:shadow-md transition-shadow"
            >
              <span className="text-sm text-black">{action.label}</span>
            </motion.button>
          ))}
        </div>
      </motion.section>

      {/* Bottom reassurance */}
      <motion.div
        className="text-center pb-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        <p className="text-xs text-gray-400">
          You're doing great. One step at a time.
        </p>
      </motion.div>
    </PageLayout>
  );
}
