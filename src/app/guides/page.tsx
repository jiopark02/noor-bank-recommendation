'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { PageLayout } from '@/components/layout';

type Country = 'US' | 'UK' | 'CA';

// Guide categories organized by life moments
interface Guide {
  id: string;
  title: string;
  description: string;
  timeEstimate: string;
  href: string;
  completed?: boolean;
}

interface GuideMoment {
  id: string;
  title: string;
  subtitle: string;
  guides: Guide[];
}

// Country-specific guide content
const GUIDE_MOMENTS_BY_COUNTRY: Record<Country, GuideMoment[]> = {
  US: [
    {
      id: 'just-arrived',
      title: 'Just Arrived',
      subtitle: 'Your first few days in the US',
      guides: [
        {
          id: 'phone',
          title: 'Get a US phone number',
          description: 'Compare prepaid vs postpaid options and find the best deal.',
          timeEstimate: '5 min read',
          href: '/guides/phone',
        },
        {
          id: 'documents',
          title: 'Collect your documents',
          description: 'I-20, student ID, and other essentials you need to get.',
          timeEstimate: '3 min read',
          href: '/guides/documents',
        },
        {
          id: 'campus',
          title: 'Navigate your campus',
          description: 'Find the important offices and resources at your school.',
          timeEstimate: '4 min read',
          href: '/guides/campus',
        },
      ],
    },
    {
      id: 'first-bank',
      title: 'First Bank Account',
      subtitle: 'Setting up your finances',
      guides: [
        {
          id: 'bank-account',
          title: 'Open a bank account without SSN',
          description: 'Step-by-step guide to opening your first US bank account.',
          timeEstimate: '7 min read',
          href: '/banking',
        },
        {
          id: 'transfer-money',
          title: 'Transfer money from home',
          description: 'Compare Wise, Remitly, and bank wires for the best rates.',
          timeEstimate: '5 min read',
          href: '/guides/transfer',
        },
        {
          id: 'mobile-banking',
          title: 'Set up mobile banking',
          description: 'Get the most out of your bank\'s app and features.',
          timeEstimate: '4 min read',
          href: '/guides/mobile-banking',
        },
      ],
    },
    {
      id: 'build-credit',
      title: 'Building Credit',
      subtitle: 'Start your credit journey',
      guides: [
        {
          id: 'credit-basics',
          title: 'Understanding US credit',
          description: 'What credit scores mean and why they matter.',
          timeEstimate: '6 min read',
          href: '/guides/credit',
        },
        {
          id: 'first-card',
          title: 'Get your first credit card',
          description: 'Best secured and student cards for beginners.',
          timeEstimate: '5 min read',
          href: '/funding',
        },
        {
          id: 'credit-tips',
          title: 'Build credit the right way',
          description: 'Tips to improve your score without debt.',
          timeEstimate: '4 min read',
          href: '/guides/credit-tips',
        },
      ],
    },
    {
      id: 'first-apartment',
      title: 'First Apartment',
      subtitle: 'Finding a place to live',
      guides: [
        {
          id: 'housing-search',
          title: 'Find apartments near campus',
          description: 'Where to look and what to watch out for.',
          timeEstimate: '6 min read',
          href: '/housing',
        },
        {
          id: 'lease',
          title: 'Understand your lease',
          description: 'What to check before signing anything.',
          timeEstimate: '8 min read',
          href: '/guides/lease',
        },
        {
          id: 'utilities',
          title: 'Set up utilities',
          description: 'Electric, internet, and other essentials.',
          timeEstimate: '5 min read',
          href: '/guides/utilities',
        },
      ],
    },
    {
      id: 'work-life',
      title: 'Work & Income',
      subtitle: 'Earning money as a student',
      guides: [
        {
          id: 'campus-jobs',
          title: 'Find on-campus jobs',
          description: 'Where to look and how to apply.',
          timeEstimate: '5 min read',
          href: '/jobs',
        },
        {
          id: 'ssn',
          title: 'Get your SSN',
          description: 'When you need it and how to apply.',
          timeEstimate: '6 min read',
          href: '/guides/ssn',
        },
        {
          id: 'cpt-opt',
          title: 'Understand CPT and OPT',
          description: 'Work authorization options explained simply.',
          timeEstimate: '8 min read',
          href: '/guides/work-auth',
        },
      ],
    },
    {
      id: 'stay-healthy',
      title: 'Health & Safety',
      subtitle: 'Taking care of yourself',
      guides: [
        {
          id: 'insurance',
          title: 'Use your health insurance',
          description: 'How to find doctors and file claims.',
          timeEstimate: '6 min read',
          href: '/guides/insurance',
        },
        {
          id: 'emergency',
          title: 'What to do in emergencies',
          description: 'Important numbers and steps to know.',
          timeEstimate: '4 min read',
          href: '/guides/emergency',
        },
        {
          id: 'mental-health',
          title: 'Mental health resources',
          description: 'Support available at your school.',
          timeEstimate: '5 min read',
          href: '/guides/mental-health',
        },
      ],
    },
  ],
  UK: [
    {
      id: 'just-arrived',
      title: 'Just Arrived',
      subtitle: 'Your first few days in the UK',
      guides: [
        {
          id: 'phone-uk',
          title: 'Get a UK phone number',
          description: 'Compare Giffgaff, Three, EE and other mobile options.',
          timeEstimate: '5 min read',
          href: '/guides/phone',
        },
        {
          id: 'brp',
          title: 'Collect your BRP',
          description: 'Biometric Residence Permit - where to collect and what to check.',
          timeEstimate: '4 min read',
          href: '/guides/documents',
        },
        {
          id: 'campus-uk',
          title: 'Navigate your university',
          description: 'Find the important offices: Student Union, International Office.',
          timeEstimate: '4 min read',
          href: '/guides/campus',
        },
      ],
    },
    {
      id: 'first-bank',
      title: 'First Bank Account',
      subtitle: 'Setting up your finances',
      guides: [
        {
          id: 'bank-account-uk',
          title: 'Open a UK bank account',
          description: 'Monzo, Barclays, HSBC - best options for international students.',
          timeEstimate: '7 min read',
          href: '/banking',
        },
        {
          id: 'transfer-money-uk',
          title: 'Transfer money from home',
          description: 'Compare Wise, PayPal, and bank transfers for GBP.',
          timeEstimate: '5 min read',
          href: '/guides/transfer',
        },
        {
          id: 'student-discount',
          title: 'Get your student discounts',
          description: 'TOTUM card, UNiDAYS, and Student Beans explained.',
          timeEstimate: '4 min read',
          href: '/guides/discounts',
        },
      ],
    },
    {
      id: 'nhs-health',
      title: 'NHS & Healthcare',
      subtitle: 'Accessing healthcare in the UK',
      guides: [
        {
          id: 'nhs-registration',
          title: 'Register with a GP',
          description: 'How to register with a doctor near your accommodation.',
          timeEstimate: '5 min read',
          href: '/guides/nhs',
        },
        {
          id: 'prescriptions',
          title: 'Getting prescriptions',
          description: 'How NHS prescriptions work and what they cost.',
          timeEstimate: '4 min read',
          href: '/guides/prescriptions',
        },
        {
          id: 'emergency-uk',
          title: 'What to do in emergencies',
          description: '999, 111, A&E - when to call and where to go.',
          timeEstimate: '4 min read',
          href: '/guides/emergency',
        },
      ],
    },
    {
      id: 'accommodation',
      title: 'Accommodation',
      subtitle: 'Finding a place to live',
      guides: [
        {
          id: 'housing-uk',
          title: 'Find student accommodation',
          description: 'Halls, private rentals, and flat shares explained.',
          timeEstimate: '6 min read',
          href: '/housing',
        },
        {
          id: 'tenancy-uk',
          title: 'Understand your tenancy',
          description: 'AST agreements, deposits, and your rights.',
          timeEstimate: '8 min read',
          href: '/guides/lease',
        },
        {
          id: 'council-tax',
          title: 'Council Tax exemption',
          description: 'How to apply for student exemption.',
          timeEstimate: '3 min read',
          href: '/guides/council-tax',
        },
      ],
    },
    {
      id: 'work-uk',
      title: 'Work & Income',
      subtitle: 'Working as a Tier 4 student',
      guides: [
        {
          id: 'work-hours',
          title: 'Understand your work rights',
          description: '20 hours term-time, full-time in holidays.',
          timeEstimate: '5 min read',
          href: '/guides/work-rights',
        },
        {
          id: 'nin',
          title: 'Get your National Insurance Number',
          description: 'Apply for NIN to start working legally.',
          timeEstimate: '6 min read',
          href: '/guides/nin',
        },
        {
          id: 'graduate-visa',
          title: 'Graduate Visa route',
          description: 'Stay and work for 2 years after graduation.',
          timeEstimate: '7 min read',
          href: '/guides/graduate-visa',
        },
      ],
    },
  ],
  CA: [
    {
      id: 'just-arrived',
      title: 'Just Arrived',
      subtitle: 'Your first few days in Canada',
      guides: [
        {
          id: 'phone-ca',
          title: 'Get a Canadian phone number',
          description: 'Compare Rogers, Bell, Telus, and budget options.',
          timeEstimate: '5 min read',
          href: '/guides/phone',
        },
        {
          id: 'study-permit',
          title: 'Validate your Study Permit',
          description: 'What to do at the port of entry and after arrival.',
          timeEstimate: '4 min read',
          href: '/guides/documents',
        },
        {
          id: 'campus-ca',
          title: 'Navigate your campus',
          description: 'International Student Services, registrar, and key offices.',
          timeEstimate: '4 min read',
          href: '/guides/campus',
        },
      ],
    },
    {
      id: 'first-bank',
      title: 'First Bank Account',
      subtitle: 'Setting up your finances',
      guides: [
        {
          id: 'bank-account-ca',
          title: 'Open a Canadian bank account',
          description: 'TD, RBC, Scotiabank - student accounts compared.',
          timeEstimate: '7 min read',
          href: '/banking',
        },
        {
          id: 'transfer-money-ca',
          title: 'Transfer money from home',
          description: 'Compare Wise, Remitly for CAD transfers.',
          timeEstimate: '5 min read',
          href: '/guides/transfer',
        },
        {
          id: 'interac',
          title: 'Set up Interac e-Transfer',
          description: 'Canada\'s instant payment system explained.',
          timeEstimate: '3 min read',
          href: '/guides/interac',
        },
      ],
    },
    {
      id: 'health-ca',
      title: 'Health Insurance',
      subtitle: 'Provincial health coverage',
      guides: [
        {
          id: 'provincial-health',
          title: 'Apply for provincial health insurance',
          description: 'MSP (BC), OHIP (Ontario), RAMQ (Quebec) guide.',
          timeEstimate: '6 min read',
          href: '/guides/health-insurance',
        },
        {
          id: 'uhip',
          title: 'Understand UHIP coverage',
          description: 'University health plan while waiting for provincial.',
          timeEstimate: '4 min read',
          href: '/guides/uhip',
        },
        {
          id: 'emergency-ca',
          title: 'What to do in emergencies',
          description: '911, walk-in clinics, ER - when to use each.',
          timeEstimate: '4 min read',
          href: '/guides/emergency',
        },
      ],
    },
    {
      id: 'accommodation-ca',
      title: 'Accommodation',
      subtitle: 'Finding a place to live',
      guides: [
        {
          id: 'housing-ca',
          title: 'Find student housing',
          description: 'On-campus, off-campus, and homestay options.',
          timeEstimate: '6 min read',
          href: '/housing',
        },
        {
          id: 'lease-ca',
          title: 'Understand your lease',
          description: 'Standard lease terms and tenant rights.',
          timeEstimate: '8 min read',
          href: '/guides/lease',
        },
        {
          id: 'utilities-ca',
          title: 'Set up utilities',
          description: 'Hydro, internet, and tenant insurance.',
          timeEstimate: '5 min read',
          href: '/guides/utilities',
        },
      ],
    },
    {
      id: 'work-ca',
      title: 'Work & Income',
      subtitle: 'Working as a study permit holder',
      guides: [
        {
          id: 'work-rights-ca',
          title: 'Understand your work rights',
          description: 'On-campus, off-campus, and co-op work permits.',
          timeEstimate: '5 min read',
          href: '/guides/work-rights',
        },
        {
          id: 'sin',
          title: 'Get your SIN',
          description: 'Social Insurance Number - how to apply.',
          timeEstimate: '5 min read',
          href: '/guides/sin',
        },
        {
          id: 'pgwp',
          title: 'Post-Graduation Work Permit',
          description: 'Work in Canada after graduation.',
          timeEstimate: '7 min read',
          href: '/guides/pgwp',
        },
      ],
    },
  ],
};

const STORAGE_KEY_COMPLETED_GUIDES = 'noor_completed_guides';

export default function GuidesPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('there');
  const [isLoading, setIsLoading] = useState(true);
  const [completedGuides, setCompletedGuides] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMoment, setExpandedMoment] = useState<string | null>('just-arrived');
  const [country, setCountry] = useState<Country>('US');

  useEffect(() => {
    const userId = localStorage.getItem('noor_user_id');
    if (!userId) {
      router.push('/welcome');
      return;
    }

    // Load selected country
    const savedCountry = localStorage.getItem('noor_selected_country');
    if (savedCountry && ['US', 'UK', 'CA'].includes(savedCountry)) {
      setCountry(savedCountry as Country);
    }

    // Load user profile
    const profileData = localStorage.getItem('noor_user_profile');
    if (profileData) {
      try {
        const profile = JSON.parse(profileData);
        if (profile.firstName) {
          setUserName(profile.firstName);
        }
      } catch (e) {
        // ignore parse errors
      }
    }

    // Load completed guides
    const saved = localStorage.getItem(STORAGE_KEY_COMPLETED_GUIDES);
    if (saved) {
      try {
        setCompletedGuides(new Set(JSON.parse(saved)));
      } catch (e) {
        // ignore parse errors
      }
    }

    setIsLoading(false);
  }, [router]);

  // Get country-specific guide moments
  const guideMoments = GUIDE_MOMENTS_BY_COUNTRY[country];

  // Filter guides based on search
  const filteredMoments = searchQuery
    ? guideMoments.map(moment => ({
        ...moment,
        guides: moment.guides.filter(
          guide =>
            guide.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            guide.description.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      })).filter(moment => moment.guides.length > 0)
    : guideMoments;

  // Calculate overall progress
  const totalGuides = guideMoments.reduce((acc, m) => acc + m.guides.length, 0);
  const completedCount = completedGuides.size;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PageLayout userName={userName}>
      {/* Header */}
      <header className="mb-6 animate-fade-in">
        <h1 className="text-2xl font-medium text-black mb-1">Guides</h1>
        <p className="text-gray-500 text-sm">
          Step-by-step help for every moment
        </p>
      </header>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search guides..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-300 transition-all"
          />
        </div>
      </div>

      {/* Progress Overview */}
      {!searchQuery && (
        <motion.div
          className="noor-card p-4 mb-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Your progress</span>
            <span className="text-sm font-medium text-black">
              {completedCount}/{totalGuides} guides
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-green-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${(completedCount / totalGuides) * 100}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
        </motion.div>
      )}

      {/* Guide Moments */}
      <div className="space-y-4">
        {filteredMoments.map((moment, momentIndex) => {
          const isExpanded = expandedMoment === moment.id || searchQuery !== '';
          const momentCompleted = moment.guides.filter(g =>
            completedGuides.has(g.id)
          ).length;

          return (
            <motion.div
              key={moment.id}
              className="noor-card overflow-hidden"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: momentIndex * 0.05 }}
            >
              {/* Moment Header */}
              <button
                onClick={() =>
                  setExpandedMoment(isExpanded && !searchQuery ? null : moment.id)
                }
                className="w-full px-5 py-4 flex items-center justify-between text-left"
              >
                <div>
                  <h2 className="font-medium text-black">{moment.title}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{moment.subtitle}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    {momentCompleted}/{moment.guides.length}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </button>

              {/* Guides List */}
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-gray-100"
                >
                  {moment.guides.map((guide, guideIndex) => {
                    const isCompleted = completedGuides.has(guide.id);
                    return (
                      <Link
                        key={guide.id}
                        href={guide.href}
                        className={`block px-5 py-4 hover:bg-gray-50 transition-colors ${
                          guideIndex !== moment.guides.length - 1
                            ? 'border-b border-gray-50'
                            : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                              isCompleted
                                ? 'bg-green-500 border-green-500'
                                : 'border-gray-300'
                            }`}
                          >
                            {isCompleted && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3
                              className={`font-medium text-sm ${
                                isCompleted ? 'text-gray-400' : 'text-black'
                              }`}
                            >
                              {guide.title}
                            </h3>
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                              {guide.description}
                            </p>
                            <span className="text-xs text-gray-400 mt-2 inline-block">
                              {guide.timeEstimate}
                            </span>
                          </div>
                          <svg
                            className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      </Link>
                    );
                  })}
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Empty Search State */}
      {filteredMoments.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">No guides found for "{searchQuery}"</p>
          <button
            onClick={() => setSearchQuery('')}
            className="text-sm text-black font-medium mt-2 hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {/* Help Footer */}
      <div className="mt-8 text-center">
        <p className="text-xs text-gray-400 mb-2">Can't find what you're looking for?</p>
        <Link
          href="/chat"
          className="inline-flex items-center text-sm font-medium text-black hover:underline"
        >
          Ask Noor AI
          <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </PageLayout>
  );
}
