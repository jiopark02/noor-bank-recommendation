import { useState, useEffect, useCallback } from 'react';
import { Scholarship } from '@/types/database';

type Country = 'US' | 'UK' | 'CA';

// Mock data for development - US scholarships
const US_SCHOLARSHIPS: Scholarship[] = [
  {
    id: 'us-1',
    name: 'International Student Excellence Award',
    provider: 'University Foundation',
    description: 'Merit-based scholarship for outstanding international students',
    amount_min: 5000,
    amount_max: 10000,
    deadline: 'Mar 15',
    eligibility_f1: true,
    eligibility_j1: false,
    country: 'US',
    requirements: ['3.5+ GPA', 'Full-time enrollment'],
    is_nationwide: true,
    category: 'merit',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: 'us-2',
    name: 'STEM Leaders Scholarship',
    provider: 'Tech Industry Council',
    description: 'For international students pursuing STEM degrees',
    amount_min: 2500,
    amount_max: 5000,
    deadline: 'Apr 1',
    eligibility_f1: true,
    eligibility_j1: true,
    country: 'US',
    requirements: ['STEM major', 'Sophomore or above'],
    is_nationwide: true,
    category: 'field',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: 'us-3',
    name: 'Global Diversity Grant',
    provider: 'International Education Fund',
    description: 'Supporting diverse perspectives in higher education',
    amount_min: 1000,
    amount_max: 3000,
    deadline: 'Rolling',
    eligibility_f1: true,
    eligibility_j1: true,
    country: 'US',
    requirements: ['Essay submission', 'Community involvement'],
    is_nationwide: true,
    category: 'diversity',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
];

// UK scholarships
const UK_SCHOLARSHIPS: Scholarship[] = [
  {
    id: 'uk-1',
    name: 'Chevening Scholarship',
    provider: 'UK Government',
    description: 'Fully funded scholarship for outstanding emerging leaders',
    amount_min: 18000,
    amount_max: 25000,
    deadline: 'Nov 1',
    eligibility_f1: false,
    eligibility_j1: false,
    eligibility_tier4: true,
    country: 'UK',
    requirements: ['Work experience', 'Leadership potential'],
    is_nationwide: true,
    category: 'merit',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: 'uk-2',
    name: 'Commonwealth Scholarship',
    provider: 'Commonwealth Scholarship Commission',
    description: 'For students from Commonwealth countries',
    amount_min: 15000,
    amount_max: 35000,
    deadline: 'Dec 15',
    eligibility_f1: false,
    eligibility_j1: false,
    eligibility_tier4: true,
    country: 'UK',
    requirements: ['Commonwealth citizen', 'Graduate programme'],
    is_nationwide: true,
    category: 'merit',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: 'uk-3',
    name: 'GREAT Scholarships',
    provider: 'British Council',
    description: 'Scholarships for international students across UK universities',
    amount_min: 10000,
    amount_max: 10000,
    deadline: 'Rolling',
    eligibility_f1: false,
    eligibility_j1: false,
    eligibility_tier4: true,
    country: 'UK',
    requirements: ['Postgraduate study', 'Eligible nationality'],
    is_nationwide: true,
    category: 'merit',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
];

// Canada scholarships
const CA_SCHOLARSHIPS: Scholarship[] = [
  {
    id: 'ca-1',
    name: 'Vanier Canada Graduate Scholarship',
    provider: 'Government of Canada',
    description: 'Prestigious award for doctoral students',
    amount_min: 50000,
    amount_max: 50000,
    deadline: 'Nov 1',
    eligibility_f1: false,
    eligibility_j1: false,
    eligibility_study_permit: true,
    country: 'CA',
    requirements: ['Doctoral program', 'Research excellence'],
    is_nationwide: true,
    category: 'research',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: 'ca-2',
    name: 'Ontario Graduate Scholarship',
    provider: 'Ontario Government',
    description: 'Merit-based award for graduate students in Ontario',
    amount_min: 10000,
    amount_max: 15000,
    deadline: 'Mar 1',
    eligibility_f1: false,
    eligibility_j1: false,
    eligibility_study_permit: true,
    country: 'CA',
    requirements: ['Ontario university', 'Graduate student'],
    is_nationwide: false,
    category: 'merit',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: 'ca-3',
    name: 'Lester B. Pearson International Scholarship',
    provider: 'University of Toronto',
    description: 'For exceptional international students at UofT',
    amount_min: 40000,
    amount_max: 60000,
    deadline: 'Jan 15',
    eligibility_f1: false,
    eligibility_j1: false,
    eligibility_study_permit: true,
    country: 'CA',
    requirements: ['Outstanding academic achievement', 'Leadership'],
    is_nationwide: false,
    category: 'merit',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
];

// Combined mock data
const MOCK_SCHOLARSHIPS: Record<Country, Scholarship[]> = {
  US: US_SCHOLARSHIPS,
  UK: UK_SCHOLARSHIPS,
  CA: CA_SCHOLARSHIPS,
};

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
      const country = (savedCountry as Country) || 'US';

      const params = new URLSearchParams();
      params.set('country', country);
      params.set('limit', limit.toString());
      if (f1Only) params.set('eligible_only', 'true');

      const response = await fetch(`/api/scholarships?${params}`);

      if (!response.ok) {
        throw new Error('Failed to fetch scholarships');
      }

      const data = await response.json();
      setScholarships(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      // Use country-specific mock data on error
      const savedCountry = typeof window !== 'undefined' ? localStorage.getItem('noor_selected_country') : null;
      const country = (savedCountry as Country) || 'US';

      let filtered = [...MOCK_SCHOLARSHIPS[country]];
      if (f1Only) {
        // Filter based on country-specific eligibility
        if (country === 'US') {
          filtered = filtered.filter(s => s.eligibility_f1);
        } else if (country === 'UK') {
          filtered = filtered.filter(s => s.eligibility_tier4);
        } else if (country === 'CA') {
          filtered = filtered.filter(s => s.eligibility_study_permit);
        }
      }
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
