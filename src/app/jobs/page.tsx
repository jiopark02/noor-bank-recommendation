'use client';

import React, { useState, useEffect } from 'react';
import { PageLayout, PageHeader, Tabs, OutlineButton, LoadingSpinner } from '@/components/layout';
import { useJobs, Job } from '@/hooks/useJobs';

const TABS = [
  { id: 'campus', label: 'Campus' },
  { id: 'internship', label: 'Internships' },
];

const JOB_FILTERS = [
  { id: 'research', label: 'Research' },
  { id: 'tutoring', label: 'Tutoring' },
  { id: 'admin', label: 'Admin' },
];

export default function JobsPage() {
  const [activeTab, setActiveTab] = useState('campus');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  const category = activeFilters.length === 1 ? activeFilters[0] : null;

  const { jobs, isLoading, error, total, refetch } = useJobs({
    limit: 20,
    jobType: activeTab,
    category,
  });

  useEffect(() => {
    refetch();
  }, [activeTab, activeFilters]);

  const toggleFilter = (id: string) => {
    setActiveFilters((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  };

  const formatDeadline = (deadline: string | null) => {
    if (!deadline) return 'Open';
    const date = new Date(deadline);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <PageLayout>
      <PageHeader
        title="Jobs."
        subtitle={`${total} positions. All F-1 eligible.`}
        rightContent={
          <div className="flex gap-2">
            <OutlineButton>Filters</OutlineButton>
            <OutlineButton>Pay</OutlineButton>
          </div>
        }
      />

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {/* F-1 Info Banner */}
      <div className="noor-card p-5 mb-6">
        <p className="text-gray-500 text-sm">
          F-1: up to 20 hrs/week during classes. Unlimited during breaks.
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2.5 mb-6 flex-wrap">
        {JOB_FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => toggleFilter(filter.id)}
            className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
              activeFilters.includes(filter.id)
                ? 'bg-black text-white'
                : 'bg-white text-black border-[1.5px] border-gray-200 hover:border-black'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <h2 className="section-title mb-5">Available.</h2>

      {/* Job List */}
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="noor-card p-8 text-center">
          <p className="text-gray-500 mb-5">Failed to load jobs</p>
          <button onClick={refetch} className="text-black text-sm border-b border-gray-300 hover:border-black transition-colors duration-300">
            Try again
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="noor-card p-10 text-center">
          <p className="text-gray-500">No jobs found.</p>
          <p className="text-gray-400 text-sm mt-2">Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} formatDeadline={formatDeadline} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function JobCard({ job, formatDeadline }: { job: Job; formatDeadline: (d: string | null) => string }) {
  return (
    <button className="w-full text-left noor-card p-6 transition-all duration-300 group">
      <h3 className="font-medium text-black group-hover:opacity-70 transition-opacity duration-300">{job.title}</h3>
      <p className="text-gray-500 text-sm mt-1.5">
        {job.department} {job.location ? `· ${job.location}` : ''}
      </p>
      <div className="flex items-center justify-between mt-4">
        <p className="font-medium text-black">
          {job.pay_min && job.pay_max
            ? `$${job.pay_min}-${job.pay_max}/hr`
            : job.pay_min
            ? `$${job.pay_min}/hr`
            : 'TBD'}
        </p>
        <p className="text-gray-400 text-sm">{formatDeadline(job.deadline)}</p>
      </div>
    </button>
  );
}
