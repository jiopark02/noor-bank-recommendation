'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { PageLayout } from '@/components/layout';
import {
  generateNotifications,
  getReadNotifications,
  formatReminderDate,
  Notification,
} from '@/lib/notificationsData';

// This week's priorities based on user's situation
interface WeeklyPriority {
  id: string;
  title: string;
  description: string;
  action: string;
  href: string;
  completed?: boolean;
}

// Helper to get week-specific priorities based on arrival week
function getThisWeekPriorities(weekNumber: number, userProfile: Record<string, unknown> | null): WeeklyPriority[] {
  const hasBankAccount = userProfile?.has_bank_account === true;
  const hasSSN = userProfile?.has_ssn === true;

  if (weekNumber <= 1) {
    return [
      {
        id: 'phone',
        title: 'Get a US phone number',
        description: 'You\'ll need this for everything - banking, housing, and staying connected.',
        action: 'See options',
        href: '/guides/phone',
      },
      {
        id: 'bank',
        title: 'Open a bank account',
        description: 'Most banks don\'t need SSN. We\'ll help you pick the right one.',
        action: 'Find a bank',
        href: '/banking',
        completed: hasBankAccount,
      },
      {
        id: 'documents',
        title: 'Collect your I-20',
        description: 'Visit your international student office to get your documents.',
        action: 'Learn more',
        href: '/guides/documents',
      },
    ];
  } else if (weekNumber <= 4) {
    return [
      {
        id: 'ssn',
        title: 'Apply for SSN (if working)',
        description: 'If you have a job offer, you can apply now. Otherwise, wait until you have one.',
        action: 'Learn how',
        href: '/guides/ssn',
        completed: hasSSN,
      },
      {
        id: 'credit',
        title: 'Start building credit',
        description: 'A secured credit card is the easiest first step.',
        action: 'See cards',
        href: '/funding',
      },
      {
        id: 'health',
        title: 'Set up health insurance',
        description: 'Make sure you know how to use your school\'s insurance.',
        action: 'Check coverage',
        href: '/guides/insurance',
      },
    ];
  } else {
    return [
      {
        id: 'budget',
        title: 'Review your budget',
        description: 'You\'ve been here a month. Let\'s see how you\'re doing.',
        action: 'Open budget',
        href: '/budget',
      },
      {
        id: 'credit-check',
        title: 'Check your credit score',
        description: 'If you got a credit card, your score should be building.',
        action: 'Learn more',
        href: '/guides/credit',
      },
      {
        id: 'jobs',
        title: 'Explore job opportunities',
        description: 'On-campus jobs can help with expenses and experience.',
        action: 'Find jobs',
        href: '/jobs',
      },
    ];
  }
}

// Calculate which week since arrival
function getWeeksSinceArrival(arrivalDate: string | undefined): number {
  if (!arrivalDate) return 1;
  const arrival = new Date(arrivalDate);
  const today = new Date();
  const diffTime = today.getTime() - arrival.getTime();
  const diffWeeks = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7));
  return Math.max(1, diffWeeks);
}

const STORAGE_KEY_COMPLETED_PRIORITIES = 'noor_completed_priorities';

export default function HomePage() {
  const router = useRouter();
  const [userName, setUserName] = useState('there');
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [userProfile, setUserProfile] = useState<Record<string, unknown> | null>(null);
  const [completedPriorities, setCompletedPriorities] = useState<Set<string>>(new Set());
  const [weekNumber, setWeekNumber] = useState(1);

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
        // Calculate weeks since arrival
        const weeks = getWeeksSinceArrival(profile.arrival_date);
        setWeekNumber(weeks);
      } catch (e) {
        // ignore parse errors
      }
    }

    // Load completed priorities
    const savedCompleted = localStorage.getItem(STORAGE_KEY_COMPLETED_PRIORITIES);
    if (savedCompleted) {
      try {
        setCompletedPriorities(new Set(JSON.parse(savedCompleted)));
      } catch (e) {
        // ignore parse errors
      }
    }

    // Load notifications
    const notifs = generateNotifications();
    const read = getReadNotifications();
    setNotifications(notifs);
    setReadNotifications(read);

    setIsLoading(false);
  }, [router]);

  // Save completed priorities
  useEffect(() => {
    if (completedPriorities.size > 0) {
      localStorage.setItem(STORAGE_KEY_COMPLETED_PRIORITIES, JSON.stringify(Array.from(completedPriorities)));
    }
  }, [completedPriorities]);

  const togglePriority = (id: string) => {
    setCompletedPriorities(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  // Get this week's priorities
  const thisWeekPriorities = useMemo(() => {
    return getThisWeekPriorities(weekNumber, userProfile);
  }, [weekNumber, userProfile]);

  // Find next uncompleted priority
  const nextStep = useMemo(() => {
    return thisWeekPriorities.find(p => !completedPriorities.has(p.id) && !p.completed);
  }, [thisWeekPriorities, completedPriorities]);

  // Get urgent notifications (Don't Miss)
  const dontMissItems = useMemo(() => {
    return notifications
      .filter(n => !readNotifications.includes(n.id))
      .filter(n => n.severity === 'urgent' || n.severity === 'warning')
      .slice(0, 3)
      .map(n => ({
        id: n.id,
        title: n.title,
        date: formatReminderDate(n.due_date),
        severity: n.severity,
        message: n.message,
      }));
  }, [notifications, readNotifications]);

  // Calculate progress for "You're on track"
  const progressStats = useMemo(() => {
    const completedCount = thisWeekPriorities.filter(
      p => completedPriorities.has(p.id) || p.completed
    ).length;
    const totalCount = thisWeekPriorities.length;
    const percentage = Math.round((completedCount / totalCount) * 100);

    return { completedCount, totalCount, percentage };
  }, [thisWeekPriorities, completedPriorities]);

  // Get encouraging message based on progress
  const getEncouragingMessage = () => {
    const { percentage } = progressStats;
    if (percentage === 100) {
      return "You're all caught up! Take a breather.";
    } else if (percentage >= 66) {
      return "You're doing great. Almost there!";
    } else if (percentage >= 33) {
      return "Good progress! Keep going at your own pace.";
    } else {
      return "One step at a time. You've got this.";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PageLayout userName={userName}>
      {/* Greeting - Calm and personal */}
      <header className="mb-8 animate-fade-in">
        <h1 className="text-2xl font-medium text-black mb-1">
          {getGreeting()}, {userName}.
        </h1>
        <p className="text-gray-500 text-sm">
          Week {weekNumber} in the US
        </p>
      </header>

      {/* Your Next Step - Single focused action */}
      {nextStep && (
        <motion.section
          className="mb-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            Your Next Step
          </h2>
          <Link href={nextStep.href}>
            <div className="noor-card p-5 bg-gradient-to-br from-gray-50 to-white border-l-4 border-l-black hover:shadow-md transition-shadow">
              <h3 className="font-medium text-black text-lg mb-2">{nextStep.title}</h3>
              <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                {nextStep.description}
              </p>
              <span className="inline-flex items-center text-sm font-medium text-black">
                {nextStep.action}
                <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>
        </motion.section>
      )}

      {/* Don't Miss - Urgent items only */}
      <AnimatePresence>
        {dontMissItems.length > 0 && (
          <motion.section
            className="mb-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
              Don't Miss
            </h2>
            <div className="space-y-2">
              {dontMissItems.map((item) => (
                <div
                  key={item.id}
                  className={`noor-card px-4 py-3 flex items-start gap-3 ${
                    item.severity === 'urgent' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'
                  }`}
                >
                  <span className="text-lg flex-shrink-0 mt-0.5">
                    {item.severity === 'urgent' ? '!' : ''}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-black">{item.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.date}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* This Week - Checkable priorities */}
      <motion.section
        className="mb-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          This Week
        </h2>
        <div className="noor-card overflow-hidden">
          {thisWeekPriorities.map((priority, index) => {
            const isCompleted = completedPriorities.has(priority.id) || priority.completed;
            return (
              <div
                key={priority.id}
                className={`flex items-center gap-4 px-5 py-4 ${
                  index !== thisWeekPriorities.length - 1 ? 'border-b border-gray-100' : ''
                } ${isCompleted ? 'bg-gray-50' : ''}`}
              >
                <button
                  onClick={() => togglePriority(priority.id)}
                  className="flex-shrink-0"
                >
                  <motion.div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      isCompleted
                        ? 'bg-black border-black'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    whileTap={{ scale: 0.9 }}
                  >
                    {isCompleted && (
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </motion.div>
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm ${isCompleted ? 'text-gray-400 line-through' : 'text-black'}`}>
                    {priority.title}
                  </p>
                </div>
                <Link
                  href={priority.href}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                    isCompleted
                      ? 'text-gray-400 bg-gray-100'
                      : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  {isCompleted ? 'Done' : priority.action}
                </Link>
              </div>
            );
          })}
        </div>
      </motion.section>

      {/* You're on Track - Reassurance */}
      <motion.section
        className="mb-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          You're on Track
        </h2>
        <div className="noor-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">{getEncouragingMessage()}</span>
            <span className="text-sm font-medium text-black">
              {progressStats.completedCount}/{progressStats.totalCount}
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-green-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progressStats.percentage}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          {progressStats.percentage === 100 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-600 mb-2">Ready for more?</p>
              <Link
                href="/guides"
                className="text-sm font-medium text-black hover:underline"
              >
                Explore all guides
              </Link>
            </div>
          )}
        </div>
      </motion.section>

      {/* Quick Help - Contextual, not feature list */}
      <motion.section
        className="mb-8"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          Need Help?
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/chat" className="noor-card p-4 hover:shadow-md transition-shadow">
            <span className="text-2xl mb-2 block">💬</span>
            <p className="font-medium text-sm text-black">Ask Noor AI</p>
            <p className="text-xs text-gray-500 mt-1">Get instant answers</p>
          </Link>
          <Link href="/guides" className="noor-card p-4 hover:shadow-md transition-shadow">
            <span className="text-2xl mb-2 block">📚</span>
            <p className="font-medium text-sm text-black">Browse Guides</p>
            <p className="text-xs text-gray-500 mt-1">Step-by-step help</p>
          </Link>
        </div>
      </motion.section>

      {/* Reassuring footer message */}
      <div className="text-center pb-8">
        <p className="text-xs text-gray-400">
          Take your time. There's no rush.
        </p>
      </div>
    </PageLayout>
  );
}
