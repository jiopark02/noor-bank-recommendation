'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageLayout } from '@/components/layout';

const IMPORTANT_DATES = [
  { label: 'FAFSA', days: 15 },
  { label: 'Tax', days: 42 },
  { label: 'OPT', days: 90 },
];

const QUICK_LINKS = [
  { label: 'SSN Guide', href: '/guides/ssn' },
  { label: 'ITIN Guide', href: '/guides/itin' },
];

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

export default function HomePage() {
  const router = useRouter();
  const [expandedSection, setExpandedSection] = useState<string | null>('arrival');
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const [userName, setUserName] = useState('there');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const userId = localStorage.getItem('noor_user_id');
    if (!userId) {
      router.push('/welcome');
      return;
    }
    setUserName('there');
    setIsLoading(false);
  }, [router]);

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

  const getSectionProgress = (sectionId: string, totalItems: number) => {
    let completed = 0;
    for (let i = 0; i < totalItems; i++) {
      if (completedItems.has(`${sectionId}-${i}`)) {
        completed++;
      }
    }
    return completed;
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
      {/* Greeting */}
      <header className="mb-12 animate-fade-in">
        <h1 className="page-title">{getGreeting()}, {userName}.</h1>
        <p className="page-subtitle">We've prepared a few things.</p>
      </header>

      {/* Important Dates */}
      <section className="mb-12 animate-fade-in">
        <h2 className="section-title mb-4">Important dates.</h2>
        <div className="flex gap-3 flex-wrap">
          {IMPORTANT_DATES.map((date) => (
            <span
              key={date.label}
              className="px-4 py-2.5 border border-gray-200 rounded-full text-sm transition-all duration-300 hover:border-gray-400"
            >
              {date.label} · {date.days}d
            </span>
          ))}
        </div>
      </section>

      {/* Quick Links */}
      <section className="mb-12 animate-fade-in">
        <div className="flex gap-6">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-black text-sm hover:opacity-60 transition-opacity duration-300"
            >
              {link.label} →
            </Link>
          ))}
        </div>
      </section>

      {/* First Week Checklist */}
      <section className="animate-fade-in">
        <h2 className="section-title mb-5">Your first week.</h2>
        <div className="space-y-3">
          {CHECKLIST_SECTIONS.map((section) => {
            const progress = getSectionProgress(section.id, section.items.length);
            const isExpanded = expandedSection === section.id;

            return (
              <div
                key={section.id}
                className="noor-card overflow-hidden"
              >
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left transition-all duration-300"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-medium text-black">{section.title}</span>
                    {progress > 0 && (
                      <span className="text-xs text-gray-400">
                        {progress}/{section.items.length}
                      </span>
                    )}
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
                {isExpanded && (
                  <div className="px-6 pb-5 space-y-4 animate-fade-in">
                    {section.items.map((item, index) => {
                      const key = `${section.id}-${index}`;
                      const isCompleted = completedItems.has(key);
                      return (
                        <label
                          key={index}
                          className="flex items-start gap-4 cursor-pointer group"
                          onClick={() => toggleItem(section.id, index)}
                        >
                          <div className="pt-0.5 flex-shrink-0">
                            <div
                              className={`w-5 h-5 border-[1.5px] rounded-md flex items-center justify-center transition-all duration-300 ${
                                isCompleted
                                  ? 'bg-black border-black'
                                  : 'border-gray-300 group-hover:border-gray-500'
                              }`}
                            >
                              {isCompleted && (
                                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>
                          <span
                            className={`text-[15px] leading-relaxed transition-all duration-300 ${
                              isCompleted ? 'text-gray-400 line-through' : 'text-gray-700'
                            }`}
                          >
                            {item}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </PageLayout>
  );
}
