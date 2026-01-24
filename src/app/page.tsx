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

const CHECKLIST_SECTIONS = [
  {
    id: 'arrival',
    title: 'Arrival',
    items: [
      'Arrive safely and check into accommodation',
      'Notify family of safe arrival',
      'Get US phone number or activate international plan',
      'Purchase essentials (food, toiletries, bedding)',
      'Rest and recover from travel',
    ],
  },
  {
    id: 'documents',
    title: 'Documents',
    items: [
      'Collect I-20 from international office',
      'Get student ID card',
      'Set up university email',
      'Register for classes',
    ],
  },
  {
    id: 'banking',
    title: 'Banking',
    items: [
      'Open a US bank account',
      'Set up direct deposit (if applicable)',
      'Get a debit card',
      'Download mobile banking app',
    ],
  },
  {
    id: 'insurance',
    title: 'Insurance',
    items: [
      'Verify health insurance coverage',
      'Get insurance card',
      'Find nearby healthcare providers',
    ],
  },
];

const QUICK_ACTIONS = [
  { icon: '🏦', label: 'Banking', href: '/banking', color: '#E8F5E9' },
  { icon: '🏠', label: 'Housing', href: '/housing', color: '#E3F2FD' },
  { icon: '💰', label: 'Funding', href: '/funding', color: '#FFF3E0' },
  { icon: '💼', label: 'Jobs', href: '/jobs', color: '#F3E5F5' },
];

const STORAGE_KEY_CHECKLIST = 'noor_checklist_items';
const STORAGE_KEY_CHECKLIST_COMPLETED = 'noor_checklist_completed';

export default function HomePage() {
  const router = useRouter();
  const [expandedSection, setExpandedSection] = useState<string | null>('arrival');
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const [userName, setUserName] = useState('there');
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [checklistCompleted, setChecklistCompleted] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [userProfile, setUserProfile] = useState<Record<string, unknown> | null>(null);

  // Calculate total items
  const totalItems = useMemo(() => {
    return CHECKLIST_SECTIONS.reduce((acc, section) => acc + section.items.length, 0);
  }, []);

  // Check if all items are completed
  const allCompleted = useMemo(() => {
    return completedItems.size >= totalItems;
  }, [completedItems.size, totalItems]);

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
      } catch (e) {
        // ignore parse errors
      }
    }

    // Load checklist completion state
    const savedCompleted = localStorage.getItem(STORAGE_KEY_CHECKLIST_COMPLETED);
    if (savedCompleted === 'true') {
      setChecklistCompleted(true);
    }

    // Load saved checklist items
    const savedItems = localStorage.getItem(STORAGE_KEY_CHECKLIST);
    if (savedItems) {
      try {
        const parsed = JSON.parse(savedItems);
        setCompletedItems(new Set(parsed));
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

  // Watch for all items completed
  useEffect(() => {
    if (allCompleted && !checklistCompleted && completedItems.size > 0) {
      // Show celebration
      setShowCelebration(true);

      // Save completion state
      localStorage.setItem(STORAGE_KEY_CHECKLIST_COMPLETED, 'true');

      // Update user profile
      const profile = localStorage.getItem('noor_user_profile');
      if (profile) {
        const parsed = JSON.parse(profile);
        parsed.onboarding_checklist_completed = true;
        parsed.checklist_completed_at = new Date().toISOString();
        localStorage.setItem('noor_user_profile', JSON.stringify(parsed));
      }

      // Hide celebration after 3 seconds and show dashboard
      setTimeout(() => {
        setShowCelebration(false);
        setChecklistCompleted(true);
      }, 3000);
    }
  }, [allCompleted, checklistCompleted, completedItems.size]);

  // Save checklist items to localStorage
  useEffect(() => {
    if (completedItems.size > 0) {
      localStorage.setItem(STORAGE_KEY_CHECKLIST, JSON.stringify(Array.from(completedItems)));
    }
  }, [completedItems]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Morning';
    if (hour < 18) return 'Afternoon';
    return 'Evening';
  };

  const toggleItem = (sectionId: string, itemIndex: number) => {
    const key = `${sectionId}-${itemIndex}`;
    setCompletedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSection((prev) => (prev === sectionId ? null : sectionId));
  };

  const getSectionProgress = (sectionId: string, totalSectionItems: number) => {
    let completed = 0;
    for (let i = 0; i < totalSectionItems; i++) {
      if (completedItems.has(`${sectionId}-${i}`)) {
        completed++;
      }
    }
    return completed;
  };

  // Calculate visa days remaining
  const getVisaDaysRemaining = () => {
    // For demo, assume visa expires in 3 years from now
    const today = new Date();
    const expiryDate = new Date(today.getFullYear() + 3, today.getMonth(), today.getDate());
    const diffTime = expiryDate.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Get upcoming deadlines
  const upcomingDeadlines = useMemo(() => {
    return notifications
      .filter(n => !readNotifications.includes(n.id))
      .slice(0, 3)
      .map(n => ({
        title: n.title,
        date: formatReminderDate(n.due_date),
        severity: n.severity,
      }));
  }, [notifications, readNotifications]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PageLayout userName={userName}>
      {/* Celebration Modal */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="bg-white rounded-3xl p-8 mx-4 text-center max-w-sm"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 0.5, repeat: 2 }}
                className="text-6xl mb-4"
              >
                🎉
              </motion.div>
              <h2 className="text-2xl font-semibold text-black mb-2">
                Welcome to your new life!
              </h2>
              <p className="text-gray-600">
                You've completed your first week checklist. Your dashboard is now ready.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Greeting */}
      <header className="mb-8 animate-fade-in">
        <h1 className="page-title">{getGreeting()}, {userName}.</h1>
        <p className="page-subtitle">
          {checklistCompleted ? "Here's your dashboard." : "We've prepared a few things."}
        </p>
      </header>

      {/* Dashboard View (shown after checklist completion) */}
      <AnimatePresence mode="wait">
        {checklistCompleted ? (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
          >
            {/* Visa Tracker */}
            <section className="mb-6">
              <div className="noor-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-black">Visa Status</h3>
                  <Link href="/visa" className="text-xs text-gray-500 hover:text-black">
                    Details →
                  </Link>
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-light text-black">{getVisaDaysRemaining()}</span>
                  <span className="text-gray-500 mb-1">days remaining</span>
                </div>
                <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: '85%' }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  F-1 Visa • Expires {new Date(Date.now() + getVisaDaysRemaining() * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </p>
              </div>
            </section>

            {/* Budget Overview */}
            <section className="mb-6">
              <div className="noor-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-black">This Month</h3>
                  <span className="text-xs text-gray-500">Jan 2026</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Spent</p>
                    <p className="text-2xl font-light text-black">$1,240</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Budget</p>
                    <p className="text-2xl font-light text-black">$2,000</p>
                  </div>
                </div>
                <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black rounded-full"
                    style={{ width: '62%' }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  $760 remaining • 38% of budget left
                </p>
              </div>
            </section>

            {/* Upcoming Deadlines */}
            {upcomingDeadlines.length > 0 && (
              <section className="mb-6">
                <h3 className="section-title mb-3">Upcoming</h3>
                <div className="space-y-2">
                  {upcomingDeadlines.map((deadline, index) => (
                    <div
                      key={index}
                      className={`noor-card px-4 py-3 flex items-center justify-between ${
                        deadline.severity === 'urgent'
                          ? 'border-l-2 border-l-red-500'
                          : deadline.severity === 'warning'
                          ? 'border-l-2 border-l-yellow-500'
                          : ''
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium text-black">{deadline.title}</p>
                        <p className="text-xs text-gray-500">{deadline.date}</p>
                      </div>
                      <span className="text-lg">
                        {deadline.severity === 'urgent' ? '🚨' : deadline.severity === 'warning' ? '⚠️' : '📌'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Quick Actions */}
            <section className="mb-6">
              <h3 className="section-title mb-3">Quick Actions</h3>
              <div className="grid grid-cols-4 gap-3">
                {QUICK_ACTIONS.map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="flex flex-col items-center p-3 rounded-2xl transition-all hover:scale-105"
                    style={{ backgroundColor: action.color }}
                  >
                    <span className="text-2xl mb-1">{action.icon}</span>
                    <span className="text-xs text-gray-700">{action.label}</span>
                  </Link>
                ))}
              </div>
            </section>

            {/* Deals Section */}
            <section className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="section-title">Student Deals</h3>
                <Link href="/deals" className="text-xs text-gray-500 hover:text-black">
                  View all →
                </Link>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                <div className="noor-card p-4 min-w-[160px] flex-shrink-0">
                  <span className="text-2xl">🍕</span>
                  <p className="font-medium text-sm mt-2">Domino's</p>
                  <p className="text-xs text-gray-500">50% off pizza</p>
                </div>
                <div className="noor-card p-4 min-w-[160px] flex-shrink-0">
                  <span className="text-2xl">🎵</span>
                  <p className="font-medium text-sm mt-2">Spotify</p>
                  <p className="text-xs text-gray-500">Free 3 months</p>
                </div>
                <div className="noor-card p-4 min-w-[160px] flex-shrink-0">
                  <span className="text-2xl">💻</span>
                  <p className="font-medium text-sm mt-2">Apple</p>
                  <p className="text-xs text-gray-500">Education pricing</p>
                </div>
              </div>
            </section>

            {/* Show Checklist Again Link */}
            <div className="text-center py-4">
              <button
                onClick={() => {
                  setChecklistCompleted(false);
                  localStorage.setItem(STORAGE_KEY_CHECKLIST_COMPLETED, 'false');
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                View first week checklist
              </button>
            </div>
          </motion.div>
        ) : (
          /* Checklist View */
          <motion.div
            key="checklist"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
          >
            {/* Progress Summary */}
            <section className="mb-6">
              <div className="noor-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-black">First Week Progress</h3>
                  <span className="text-sm text-gray-500">{completedItems.size}/{totalItems}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-black rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(completedItems.size / totalItems) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                {completedItems.size === totalItems - 1 && (
                  <p className="text-xs text-green-600 mt-2">
                    Almost there! Just 1 more item to go.
                  </p>
                )}
              </div>
            </section>

            {/* Checklist Sections */}
            <section className="animate-fade-in">
              <h2 className="section-title mb-5">Your first week.</h2>
              <div className="space-y-3">
                {CHECKLIST_SECTIONS.map((section) => {
                  const progress = getSectionProgress(section.id, section.items.length);
                  const isExpanded = expandedSection === section.id;
                  const sectionCompleted = progress === section.items.length;

                  return (
                    <motion.div
                      key={section.id}
                      className={`noor-card overflow-hidden ${sectionCompleted ? 'opacity-60' : ''}`}
                      layout
                    >
                      {/* Section Header */}
                      <button
                        onClick={() => toggleSection(section.id)}
                        className="w-full px-6 py-5 flex items-center justify-between text-left transition-all duration-300"
                      >
                        <div className="flex items-center gap-4">
                          {sectionCompleted && (
                            <span className="text-green-500">✓</span>
                          )}
                          <span className={`font-medium ${sectionCompleted ? 'text-gray-500' : 'text-black'}`}>
                            {section.title}
                          </span>
                          <span className="text-xs text-gray-400">
                            {progress}/{section.items.length}
                          </span>
                        </div>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Section Items */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="overflow-hidden"
                          >
                            <div className="px-6 pb-5 space-y-4">
                              {section.items.map((item, index) => {
                                const key = `${section.id}-${index}`;
                                const isCompleted = completedItems.has(key);
                                return (
                                  <motion.label
                                    key={index}
                                    className="flex items-start gap-4 cursor-pointer group"
                                    onClick={() => toggleItem(section.id, index)}
                                    whileTap={{ scale: 0.98 }}
                                  >
                                    <div className="pt-0.5 flex-shrink-0">
                                      <motion.div
                                        className={`w-5 h-5 border-[1.5px] rounded-md flex items-center justify-center transition-all duration-300 ${
                                          isCompleted
                                            ? 'bg-black border-black'
                                            : 'border-gray-300 group-hover:border-gray-500'
                                        }`}
                                        whileTap={{ scale: 0.9 }}
                                      >
                                        <AnimatePresence>
                                          {isCompleted && (
                                            <motion.svg
                                              initial={{ scale: 0 }}
                                              animate={{ scale: 1 }}
                                              exit={{ scale: 0 }}
                                              className="w-3 h-3 text-white"
                                              fill="currentColor"
                                              viewBox="0 0 20 20"
                                            >
                                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </motion.svg>
                                          )}
                                        </AnimatePresence>
                                      </motion.div>
                                    </div>
                                    <span
                                      className={`text-[15px] leading-relaxed transition-all duration-300 ${
                                        isCompleted ? 'text-gray-400 line-through' : 'text-gray-700'
                                      }`}
                                    >
                                      {item}
                                    </span>
                                  </motion.label>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </section>

            {/* Skip to Dashboard Link */}
            <div className="text-center py-6">
              <button
                onClick={() => {
                  setChecklistCompleted(true);
                  localStorage.setItem(STORAGE_KEY_CHECKLIST_COMPLETED, 'true');
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Skip to dashboard →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageLayout>
  );
}
