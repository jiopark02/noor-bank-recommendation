import { useState, useEffect, useCallback } from 'react';
import { Scholarship } from '@/types/database';

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
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (f1Only) params.set('f1', 'true');

      const response = await fetch(`/api/scholarships?${params}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch scholarships');
      }

      const data = await response.json();
      setScholarships(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setScholarships([]);
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
