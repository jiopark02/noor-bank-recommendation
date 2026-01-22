'use client';

import React from 'react';
import { PageLayout, PageHeader, LoadingSpinner } from '@/components/layout';
import { useScholarships } from '@/hooks/useScholarships';
import { Scholarship } from '@/types/database';

export default function FundingPage() {
  const { scholarships, isLoading, error, total, refetch } = useScholarships({
    limit: 20,
    f1Only: true,
  });

  return (
    <PageLayout>
      <PageHeader
        title="Funding."
        subtitle={`${total} opportunities matched to you.`}
      />

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="noor-card p-8 text-center">
          <p className="text-gray-500 mb-5">Failed to load scholarships</p>
          <button onClick={refetch} className="text-black text-sm border-b border-gray-300 hover:border-black transition-colors duration-300">
            Try again
          </button>
        </div>
      ) : scholarships.length === 0 ? (
        <div className="noor-card p-10 text-center">
          <p className="text-gray-500">No scholarships found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {scholarships.map((scholarship) => (
            <ScholarshipCard key={scholarship.id} scholarship={scholarship} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function ScholarshipCard({ scholarship }: { scholarship: Scholarship }) {
  const formatAmount = (min?: number | null, max?: number | null) => {
    if (!min && !max) return 'Varies';
    if (min && max) {
      return `$${min.toLocaleString()}-$${max.toLocaleString()}`;
    }
    return `Up to $${(max || min || 0).toLocaleString()}`;
  };

  return (
    <button className="w-full text-left noor-card p-6 transition-all duration-300 group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="font-medium text-black group-hover:opacity-70 transition-opacity duration-300">{scholarship.name}</h3>
          <p className="text-gray-500 text-sm mt-1.5">{scholarship.provider}</p>
          <p className="font-medium text-black mt-4">
            {formatAmount(scholarship.amount_min, scholarship.amount_max)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-gray-400 text-sm">{scholarship.deadline || 'Rolling'}</p>
          {scholarship.eligibility_f1 && (
            <span className="inline-block mt-3 badge text-xs">
              F-1 eligible
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
