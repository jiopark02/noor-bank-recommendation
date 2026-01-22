'use client';

import React from 'react';
import { BankRecommendation, MatchReason } from '@/hooks/useBankRecommendations';

interface BankCardProps {
  recommendation: BankRecommendation;
  onClick?: () => void;
}

export function BankCard({ recommendation, onClick }: BankCardProps) {
  const { bank, fitScore, isBestMatch, matchReasons, warnings } = recommendation;

  // Get top 3 match reasons to display
  const topReasons = matchReasons.slice(0, 3);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left noor-card p-5 hover:border-gray-300 transition-colors ${
        isBestMatch ? 'ring-2 ring-black ring-offset-2' : ''
      }`}
    >
      {/* Best Match Badge */}
      {isBestMatch && (
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-black text-white">
            Best Match
          </span>
          <span className="text-gray-500 text-xs">Your top recommendation</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        {/* Bank Info */}
        <div className="flex-1 min-w-0">
          {/* Bank Name */}
          <h3 className="font-semibold text-black text-base">
            {bank.bank_name}
          </h3>

          {/* Product Name */}
          {bank.account_type && (
            <p className="text-gray-500 text-sm mt-0.5">
              {formatAccountType(bank.account_type)}
            </p>
          )}

          {/* Match Reasons */}
          <div className="mt-3 space-y-1.5">
            {topReasons.map((reason, index) => (
              <ReasonTag key={index} reason={reason} />
            ))}
          </div>

          {/* Warnings (show first one) */}
          {warnings.length > 0 && (
            <div className="mt-2">
              <span className="text-orange-600 text-sm">
                {warnings[0].icon} {warnings[0].title}
              </span>
            </div>
          )}
        </div>

        {/* Fit Score Badge */}
        <div className={`flex-shrink-0 ${isBestMatch ? 'best-fit-badge' : 'fit-badge'}`}>
          {Math.round(fitScore)}% fit
        </div>
      </div>
    </button>
  );
}

function ReasonTag({ reason }: { reason: MatchReason }) {
  const bgColor = reason.type === 'positive'
    ? 'bg-green-50 text-green-700'
    : reason.type === 'info'
    ? 'bg-blue-50 text-blue-700'
    : 'bg-orange-50 text-orange-700';

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${bgColor} mr-2`}>
      <span>{reason.icon}</span>
      <span className="font-medium">{reason.title}</span>
    </div>
  );
}

function formatAccountType(type: string): string {
  const typeMap: Record<string, string> = {
    checking: 'Checking Account',
    savings: 'Savings Account',
    student_account: 'Student Account',
    credit_card: 'Credit Card',
    secured_card: 'Secured Card',
  };
  return typeMap[type] || type.replace('_', ' ');
}

// Skeleton loader for bank cards
export function BankCardSkeleton() {
  return (
    <div className="noor-card p-5 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="h-5 bg-gray-200 rounded w-32 mb-2" />
          <div className="h-4 bg-gray-100 rounded w-24 mb-3" />
          <div className="flex gap-2">
            <div className="h-6 bg-gray-100 rounded w-24" />
            <div className="h-6 bg-gray-100 rounded w-20" />
          </div>
        </div>
        <div className="h-7 bg-gray-200 rounded-full w-20" />
      </div>
    </div>
  );
}
