'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLayout, PageHeader, Tabs, FilterChips, LoadingSpinner } from '@/components/layout';
import { BankRecommendationList, BranchLocator } from '@/components/bank';
import { CampusSide } from '@/lib/universityData';
import { useCreditCards, CreditCard } from '@/hooks/useCreditCards';

const TABS = [
  { id: 'banks', label: 'Banks' },
  { id: 'cards', label: 'Cards' },
  { id: 'guides', label: 'Guides' },
];

const BANK_FILTERS = [
  { id: 'no_ssn', label: 'No SSN' },
  { id: 'traditional', label: 'Traditional' },
  { id: 'edit', label: 'Edit' },
];

const CAMPUS_SIDE_FILTERS: { id: CampusSide | 'all'; label: string }[] = [
  { id: 'all', label: 'All Areas' },
  { id: 'north', label: 'North' },
  { id: 'south', label: 'South' },
  { id: 'east', label: 'East' },
  { id: 'west', label: 'West' },
];

const CARD_FILTERS = [
  { id: 'no_ssn', label: 'No SSN' },
  { id: 'no_history', label: 'No Credit History' },
  { id: 'no_fee', label: 'No Annual Fee' },
];

export default function BankingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('banks');
  const [bankFilters, setBankFilters] = useState<string[]>(['no_ssn', 'traditional']);
  const [cardFilters, setCardFilters] = useState<string[]>([]);
  const [userUniversity, setUserUniversity] = useState<string>('Stanford');
  const [userCampusSide, setUserCampusSide] = useState<CampusSide | undefined>(undefined);
  const [selectedCampusSide, setSelectedCampusSide] = useState<CampusSide | 'all'>('all');

  useEffect(() => {
    const storedUserId = localStorage.getItem('noor_user_id');
    if (!storedUserId) {
      router.push('/survey');
      return;
    }
    setUserId(storedUserId);

    // Load user profile for university and campus side
    try {
      const profile = localStorage.getItem('noor_user_profile');
      if (profile) {
        const parsed = JSON.parse(profile);
        if (parsed.university) {
          setUserUniversity(parsed.university);
        }
        if (parsed.campusSide && parsed.campusSide !== 'unknown') {
          setUserCampusSide(parsed.campusSide as CampusSide);
        }
      }
    } catch (e) {
      // Use defaults
    }
  }, [router]);

  const { cards, isLoading: cardsLoading, error: cardsError, total: cardTotal, refetch: refetchCards } = useCreditCards({
    f1Only: true,
    noSsn: cardFilters.includes('no_ssn'),
  });

  const toggleBankFilter = (filterId: string) => {
    if (filterId === 'edit') {
      router.push('/survey');
      return;
    }
    setBankFilters((prev) =>
      prev.includes(filterId)
        ? prev.filter((id) => id !== filterId)
        : [...prev, filterId]
    );
  };

  const toggleCardFilter = (filterId: string) => {
    setCardFilters((prev) =>
      prev.includes(filterId)
        ? prev.filter((id) => id !== filterId)
        : [...prev, filterId]
    );
  };

  if (!userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-[1.5px] border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="Banking"
        subtitle="We'll help you find the right fit."
      />

      {/* Reassurance message */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <p className="text-sm text-gray-600 leading-relaxed">
          Most banks here accept international students — you don't need an SSN to get started. Take your time to compare.
        </p>
      </div>

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'banks' && (
        <div className="animate-fade-in">
          <FilterChips
            filters={BANK_FILTERS}
            activeFilters={bankFilters}
            onChange={toggleBankFilter}
          />

          {/* Campus Side Filter */}
          <div className="mb-6">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Branch Location</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {CAMPUS_SIDE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setSelectedCampusSide(filter.id)}
                  className={`px-4 py-2 rounded-full border-[1.5px] text-sm font-medium whitespace-nowrap transition-all duration-300 ${
                    selectedCampusSide === filter.id
                      ? 'border-black bg-black text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <h2 className="section-title mb-3">Recommended for you</h2>
          <p className="text-sm text-gray-500 mb-5">Based on your situation. No pressure to decide today.</p>
          <BankRecommendationList userId={userId} limit={10} />

          {/* Branch Locations Section */}
          <div className="mt-10 pt-8 border-t border-gray-100">
            <h2 className="section-title mb-3">Branches near you</h2>
            <p className="text-sm text-gray-500 mb-5">In-person help when you need it.</p>
            <BranchLocator
              university={userUniversity}
              userCampusSide={selectedCampusSide !== 'all' ? selectedCampusSide : userCampusSide}
              recommendedBanks={['Bank of America', 'Chase', 'Wells Fargo']}
            />
          </div>
        </div>
      )}

      {activeTab === 'cards' && (
        <div className="animate-fade-in">
          <FilterChips
            filters={CARD_FILTERS}
            activeFilters={cardFilters}
            onChange={toggleCardFilter}
          />
          <div className="bg-gray-50 rounded-xl p-4 mb-5">
            <p className="text-sm text-gray-600 leading-relaxed">
              Building credit takes time — start with one card and use it responsibly. No need to rush.
            </p>
          </div>
          <h2 className="section-title mb-3">Good first cards</h2>
          <p className="text-sm text-gray-500 mb-5">{cardTotal} options for international students</p>

          {cardsLoading ? (
            <LoadingSpinner />
          ) : cardsError ? (
            <div className="noor-card p-8 text-center">
              <p className="text-gray-500 mb-5">Failed to load credit cards</p>
              <button onClick={refetchCards} className="text-black text-sm border-b border-gray-300 hover:border-black transition-colors duration-300">
                Try again
              </button>
            </div>
          ) : cards.length === 0 ? (
            <div className="noor-card p-10 text-center">
              <p className="text-gray-500">No cards match your criteria.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {cards.map((card) => (
                <CreditCardItem key={card.id} card={card} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'guides' && (
        <div className="space-y-4 animate-fade-in">
          <GuideCard
            title="SSN Guide"
            description="How to get your Social Security Number as an F-1 student"
            href="https://www.ssa.gov/ssnumber/"
          />
          <GuideCard
            title="ITIN Guide"
            description="Individual Taxpayer Identification Number explained"
            href="https://www.irs.gov/individuals/individual-taxpayer-identification-number"
          />
          <GuideCard
            title="Building Credit"
            description="Step-by-step guide to building credit history in the US"
            href="https://www.nerdwallet.com/article/finance/how-to-build-credit"
          />
          <GuideCard
            title="Bank Account Comparison"
            description="Detailed comparison of student-friendly bank accounts"
            href="https://www.nerdwallet.com/best/banking/student-checking-accounts"
          />
        </div>
      )}
    </PageLayout>
  );
}

function CreditCardItem({ card }: { card: CreditCard }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="noor-card overflow-hidden transition-all duration-300">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h3 className="font-medium text-black">{card.card_name}</h3>
              {!card.ssn_required && (
                <span className="badge-dark text-xs">No SSN</span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-1.5">{card.issuer}</p>
            {card.rewards_rate && (
              <p className="text-gray-600 text-sm mt-3">{card.rewards_rate}</p>
            )}
          </div>
          <div className="text-right">
            <p className="font-medium text-black">
              {card.annual_fee === 0 ? 'No annual fee' : `$${card.annual_fee}/yr`}
            </p>
            {card.foreign_transaction_fee === 0 && (
              <p className="text-gray-400 text-xs mt-1">No FTF</p>
            )}
          </div>
        </div>

        {card.f1_notes && (
          <p className="text-sm text-gray-400 italic mt-4">{card.f1_notes}</p>
        )}
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-gray-100 pt-5 animate-fade-in">
          {card.signup_bonus && (
            <div className="mb-5">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Signup Bonus</p>
              <p className="text-sm text-black">{card.signup_bonus}</p>
            </div>
          )}

          {card.benefits && card.benefits.length > 0 && (
            <div className="mb-5">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Benefits</p>
              <ul className="text-sm text-gray-600 space-y-2">
                {card.benefits.slice(0, 4).map((b, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-black mt-0.5">+</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {card.drawbacks && card.drawbacks.length > 0 && (
            <div className="mb-5">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Watch out for</p>
              <ul className="text-sm text-gray-600 space-y-2">
                {card.drawbacks.slice(0, 3).map((d, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-gray-400 mt-0.5">-</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {card.apply_link && (
            <a
              href={card.apply_link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary w-full mt-2"
            >
              Apply Now
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function GuideCard({ title, description, href }: { title: string; description: string; href?: string }) {
  const handleClick = () => {
    if (href) {
      window.open(href, '_blank');
    }
  };

  return (
    <button
      onClick={handleClick}
      className="w-full text-left noor-card p-6 transition-all duration-300 group"
    >
      <h3 className="font-medium text-black group-hover:opacity-70 transition-opacity duration-300">{title}</h3>
      <p className="text-gray-500 text-sm mt-2">{description}</p>
      <span className="text-gray-400 text-sm mt-4 inline-block">Read more →</span>
    </button>
  );
}
