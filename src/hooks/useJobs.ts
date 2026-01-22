import { useState, useEffect, useCallback } from 'react';

export interface Job {
  id: string;
  title: string;
  department: string;
  location: string | null;
  description: string | null;
  pay_min: number | null;
  pay_max: number | null;
  hours_per_week: number;
  job_type: string;
  category: string | null;
  requirements: string[] | null;
  f1_eligible: boolean;
  deadline: string | null;
  contact_email: string | null;
  apply_link: string | null;
  university: string | null;
  is_active: boolean;
  created_at: string;
}

interface UseJobsOptions {
  limit?: number;
  category?: string | null;
  jobType?: string;
  autoFetch?: boolean;
}

interface UseJobsReturn {
  jobs: Job[];
  isLoading: boolean;
  error: string | null;
  total: number;
  refetch: () => Promise<void>;
}

export function useJobs({
  limit = 20,
  category = null,
  jobType = 'campus',
  autoFetch = true,
}: UseJobsOptions = {}): UseJobsReturn {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (category) params.set('category', category);
      if (jobType) params.set('type', jobType);

      const response = await fetch(`/api/jobs?${params}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch jobs');
      }

      const data = await response.json();
      setJobs(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setJobs([]);
    } finally {
      setIsLoading(false);
    }
  }, [limit, category, jobType]);

  useEffect(() => {
    if (autoFetch) {
      fetchJobs();
    }
  }, [autoFetch, fetchJobs]);

  return {
    jobs,
    isLoading,
    error,
    total,
    refetch: fetchJobs,
  };
}
