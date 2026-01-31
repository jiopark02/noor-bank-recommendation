'use client';

import React, { useState } from 'react';
import { useBankRecommendations, BankRecommendation } from '@/hooks/useBankRecommendations';
import { BankCard, BankCardSkeleton } from './BankCard';
import { BankDetailModal } from './BankDetailModal';
import { BankComparisonTable } from './BankComparisonTable';

interface BankRecommendationListProps {
  userId: string;
  limit?: number;
  showComparison?: boolean;
  country?: string; // US, UK, CA
}

export function BankRecommendationList({
  userId,
  limit = 10,
  showComparison = true,
  country = 'US',
}: BankRecommendationListProps) {
  const {
    recommendations,
    isLoading,
    error,
    refetch,
  } = useBankRecommendations({ userId, limit, country });

  const [selectedBank, setSelectedBank] = useState<BankRecommendation | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <BankCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="noor-card p-6 text-center">
        <p className="text-gray-500 mb-4">Failed to load recommendations</p>
        <button
          onClick={refetch}
          className="text-black underline text-sm"
        >
          Try again
        </button>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="noor-card p-8 text-center">
        <p className="text-gray-500">No banks match your criteria.</p>
        <p className="text-gray-400 text-sm mt-2">Try adjusting your filters.</p>
      </div>
    );
  }

  // Get banks with category picks (these are the "Top Picks")
  const topPicks = recommendations.filter(r => r.categoryPick);
  // Get remaining banks without category picks
  const otherBanks = recommendations.filter(r => !r.categoryPick);

  return (
    <>
      {/* Top Picks Section */}
      {topPicks.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-black mb-4">Top Picks for You</h3>
          <div className="space-y-3">
            {topPicks.map((rec) => (
              <TopPickCard
                key={rec.bank.id}
                recommendation={rec}
                onClick={() => setSelectedBank(rec)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Comparison Table */}
      {showComparison && topPicks.length >= 2 && (
        <div className="mb-8">
          <BankComparisonTable
            recommendations={topPicks.slice(0, 3)}
            onSelectBank={setSelectedBank}
          />
        </div>
      )}

      {/* Other Recommendations */}
      {otherBanks.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Other options</h3>
          {otherBanks.map((rec) => (
            <BankCard
              key={rec.bank.id}
              recommendation={rec}
              onClick={() => setSelectedBank(rec)}
            />
          ))}
        </div>
      )}

      {selectedBank && (
        <BankDetailModal
          recommendation={selectedBank}
          isOpen={!!selectedBank}
          onClose={() => setSelectedBank(null)}
        />
      )}
    </>
  );
}

// Top Pick Card - shows category label prominently
function TopPickCard({
  recommendation,
  onClick,
}: {
  recommendation: BankRecommendation;
  onClick: () => void;
}) {
  const { bank, fitScore, categoryPick, matchReasons } = recommendation;
  const isOverall = categoryPick?.category === 'best_overall';

  // Get category-specific styling
  const getCategoryStyle = () => {
    switch (categoryPick?.category) {
      case 'best_overall':
        return 'bg-black text-white';
      case 'best_low_fees':
        return 'bg-green-600 text-white';
      case 'best_international':
        return 'bg-blue-600 text-white';
      case 'best_branches':
        return 'bg-purple-600 text-white';
      case 'best_online':
        return 'bg-indigo-600 text-white';
      case 'best_student':
        return 'bg-orange-500 text-white';
      case 'best_no_ssn':
        return 'bg-teal-600 text-white';
      default:
        return 'bg-gray-600 text-white';
    }
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left noor-card p-5 hover:border-gray-300 transition-colors ${
        isOverall ? 'ring-2 ring-black ring-offset-2' : ''
      }`}
    >
      {/* Category Badge */}
      <div className="flex items-center justify-between mb-3">
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getCategoryStyle()}`}>
          {categoryPick?.label || 'Recommended'}
        </span>
        <span className="fit-badge">{Math.round(fitScore)}% fit</span>
      </div>

      {/* Bank Info */}
      <h3 className="font-semibold text-black text-lg">{bank.bank_name}</h3>

      {/* Category Reason */}
      {categoryPick?.reason && (
        <p className="text-gray-600 text-sm mt-1">{categoryPick.reason}</p>
      )}

      {/* Quick highlights */}
      <div className="flex flex-wrap gap-2 mt-3">
        {bank.monthly_fee === 0 && (
          <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded">No monthly fee</span>
        )}
        {bank.can_open_without_ssn && (
          <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded">No SSN required</span>
        )}
        {bank.has_zelle && (
          <span className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded">Zelle</span>
        )}
        {bank.intl_wire_outgoing === 0 && (
          <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded">Free wires</span>
        )}
      </div>
    </button>
  );
}
