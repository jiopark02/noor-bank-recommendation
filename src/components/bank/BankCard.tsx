'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { BankRecommendation, MatchReason } from '@/hooks/useBankRecommendations';
import { getBranchesForBank, getNearestBranch, NearestBranchInfo } from '@/lib/universityData';

interface BankCardProps {
  recommendation: BankRecommendation;
  onClick?: () => void;
}

export function BankCard({ recommendation, onClick }: BankCardProps) {
  const { bank, fitScore, isBestMatch, matchReasons, warnings } = recommendation;
  const [userUniversity, setUserUniversity] = useState<string>('Stanford');

  useEffect(() => {
    try {
      const profile = localStorage.getItem('noor_user_profile');
      if (profile) {
        const parsed = JSON.parse(profile);
        if (parsed.university) {
          setUserUniversity(parsed.university);
        }
      }
    } catch (e) {
      // Use default
    }
  }, []);

  // Get top 3 match reasons to display
  const topReasons = matchReasons.slice(0, 3);

  // Get branch count and nearest branch for this bank
  const branchCount = getBranchesForBank(userUniversity, bank.bank_name).length;
  const nearestBranch = useMemo(() => {
    return getNearestBranch(userUniversity, bank.bank_name);
  }, [userUniversity, bank.bank_name]);

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

          {/* Nearest Branch Info */}
          {nearestBranch && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">Nearest Branch</p>
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-black truncate">{nearestBranch.branch.name}</p>
                  <p className="text-xs text-gray-500 truncate">{nearestBranch.branch.address}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    ~{nearestBranch.walkingMinutes} min walk from campus
                  </p>
                </div>
              </div>
              {branchCount > 1 && (
                <p className="text-xs text-gray-400 mt-2">
                  +{branchCount - 1} more {branchCount - 1 === 1 ? 'branch' : 'branches'} nearby
                </p>
              )}
            </div>
          )}

          {/* Branch count (when no nearest branch info) */}
          {!nearestBranch && branchCount > 0 && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <span>{branchCount} {branchCount === 1 ? 'branch' : 'branches'} nearby</span>
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
