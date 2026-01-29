import { useState, useEffect, useCallback } from 'react';
import { Scholarship } from '@/types/database';

// Mock data for development
const MOCK_SCHOLARSHIPS: Scholarship[] = [
  {
    id: '1',
    name: 'International Student Excellence Award',
    provider: 'University Foundation',
    description: 'Merit-based scholarship for outstanding international students',
    amount_min: 5000,
    amount_max: 10000,
    deadline: 'Mar 15',
    eligibility_f1: true,
    eligibility_j1: false,
    requirements: ['3.5+ GPA', 'Full-time enrollment'],
    is_nationwide: true,
    category: 'merit',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: '2',
    name: 'STEM Leaders Scholarship',
    provider: 'Tech Industry Council',
    description: 'For international students pursuing STEM degrees',
    amount_min: 2500,
    amount_max: 5000,
    deadline: 'Apr 1',
    eligibility_f1: true,
    eligibility_j1: true,
    requirements: ['STEM major', 'Sophomore or above'],
    is_nationwide: true,
    category: 'field',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: '3',
    name: 'Global Diversity Grant',
    provider: 'International Education Fund',
    description: 'Supporting diverse perspectives in higher education',
    amount_min: 1000,
    amount_max: 3000,
    deadline: 'Rolling',
    eligibility_f1: true,
    eligibility_j1: true,
    requirements: ['Essay submission', 'Community involvement'],
    is_nationwide: true,
    category: 'diversity',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: '4',
    name: 'Financial Need Scholarship',
    provider: 'Student Aid Office',
    description: 'Need-based support for international students',
    amount_min: 2000,
    amount_max: 8000,
    deadline: 'Feb 28',
    eligibility_f1: true,
    eligibility_j1: false,
    requirements: ['Demonstrated financial need', 'Good standing'],
    is_nationwide: false,
    category: 'need',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: '5',
    name: 'Research Excellence Fellowship',
    provider: 'Graduate Studies Office',
    description: 'For graduate students conducting original research',
    amount_min: 10000,
    amount_max: 20000,
    deadline: 'Jan 31',
    eligibility_f1: true,
    eligibility_j1: true,
    requirements: ['Graduate student', 'Research proposal'],
    is_nationwide: true,
    category: 'research',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
];

interface UseScholarshipsOptions {
  limit?: number;
  f1Only?: boolean;
  autoFetch?: boolean;
}

interface UseScholarshipsReturn {
  scholarships: Scholarship[];
  isLoading: boolean;
  error: string | null;
  total: number;
  refetch: () => Promise<void>;
}

export function useScholarships({
  limit = 20,
  f1Only = false,
  autoFetch = true,
}: UseScholarshipsOptions = {}): UseScholarshipsReturn {
  const [scholarships, setScholarships] = useState<Scholarship[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchScholarships = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get country from localStorage
      const savedCountry = typeof window !== 'undefined' ? localStorage.getItem('noor_selected_country') : null;
      const country = savedCountry || 'US';

      const params = new URLSearchParams();
      params.set('country', country);
      params.set('limit', limit.toString());
      if (f1Only) params.set('f1', 'true');

      const response = await fetch(`/api/scholarships?${params}`);

      if (!response.ok) {
        throw new Error('Failed to fetch scholarships');
      }

      const data = await response.json();
      setScholarships(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      // Use mock data on error
      let filtered = [...MOCK_SCHOLARSHIPS];
      if (f1Only) filtered = filtered.filter(s => s.eligibility_f1);
      setScholarships(filtered.slice(0, limit));
      setTotal(filtered.length);
      setError(null);
    } finally {
      setIsLoading(false);
    }
  }, [limit, f1Only]);

  useEffect(() => {
    if (autoFetch) {
      fetchScholarships();
    }
  }, [autoFetch, fetchScholarships]);

  return {
    scholarships,
    isLoading,
    error,
    total,
    refetch: fetchScholarships,
  };
}
