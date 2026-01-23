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

// Mock data for development
const MOCK_JOBS: Job[] = [
  {
    id: '1',
    title: 'Research Assistant',
    department: 'Computer Science',
    location: 'Soda Hall',
    description: 'Assist with ML research projects',
    pay_min: 18,
    pay_max: 22,
    hours_per_week: 15,
    job_type: 'campus',
    category: 'research',
    requirements: ['Python', 'Machine Learning basics'],
    f1_eligible: true,
    deadline: '2026-02-15',
    contact_email: null,
    apply_link: null,
    university: 'UC Berkeley',
    is_active: true,
    created_at: '2026-01-15',
  },
  {
    id: '2',
    title: 'Math Tutor',
    department: 'Student Learning Center',
    location: 'Library',
    description: 'Help students with calculus and linear algebra',
    pay_min: 17,
    pay_max: 20,
    hours_per_week: 10,
    job_type: 'campus',
    category: 'tutoring',
    requirements: ['Strong math background', 'Good communication'],
    f1_eligible: true,
    deadline: null,
    contact_email: null,
    apply_link: null,
    university: 'UC Berkeley',
    is_active: true,
    created_at: '2026-01-10',
  },
  {
    id: '3',
    title: 'Office Assistant',
    department: 'International Student Services',
    location: 'Admin Building',
    description: 'Front desk support and administrative tasks',
    pay_min: 16,
    pay_max: 18,
    hours_per_week: 12,
    job_type: 'campus',
    category: 'admin',
    requirements: ['Organized', 'Friendly'],
    f1_eligible: true,
    deadline: '2026-02-01',
    contact_email: null,
    apply_link: null,
    university: 'UC Berkeley',
    is_active: true,
    created_at: '2026-01-12',
  },
  {
    id: '4',
    title: 'Software Engineering Intern',
    department: 'Engineering',
    location: 'San Francisco, CA',
    description: 'Summer internship building web applications',
    pay_min: 45,
    pay_max: 55,
    hours_per_week: 40,
    job_type: 'internship',
    category: null,
    requirements: ['React', 'Node.js', 'SQL'],
    f1_eligible: true,
    deadline: '2026-03-01',
    contact_email: null,
    apply_link: null,
    university: null,
    is_active: true,
    created_at: '2026-01-08',
  },
  {
    id: '5',
    title: 'Data Science Intern',
    department: 'Analytics',
    location: 'Remote',
    description: 'Work on data analysis and visualization projects',
    pay_min: 40,
    pay_max: 50,
    hours_per_week: 40,
    job_type: 'internship',
    category: null,
    requirements: ['Python', 'SQL', 'Tableau'],
    f1_eligible: true,
    deadline: '2026-02-28',
    contact_email: null,
    apply_link: null,
    university: null,
    is_active: true,
    created_at: '2026-01-05',
  },
];

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
      // Use mock data on error
      let filtered = MOCK_JOBS.filter(j => j.job_type === jobType);
      if (category) filtered = filtered.filter(j => j.category === category);
      setJobs(filtered.slice(0, limit));
      setTotal(filtered.length);
      setError(null);
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
