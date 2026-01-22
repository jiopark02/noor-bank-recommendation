import { useState, useEffect, useCallback } from 'react';
import { Apartment } from '@/types/database';

interface UseApartmentsOptions {
  limit?: number;
  filters?: {
    gym?: boolean;
    furnished?: boolean;
    parking?: boolean;
  };
  autoFetch?: boolean;
}

interface UseApartmentsReturn {
  apartments: Apartment[];
  isLoading: boolean;
  error: string | null;
  total: number;
  refetch: () => Promise<void>;
}

export function useApartments({
  limit = 20,
  filters = {},
  autoFetch = true,
}: UseApartmentsOptions = {}): UseApartmentsReturn {
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchApartments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (filters.gym) params.set('gym', 'true');
      if (filters.furnished) params.set('furnished', 'true');
      if (filters.parking) params.set('parking', 'true');

      const response = await fetch(`/api/apartments?${params}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch apartments');
      }

      const data = await response.json();
      setApartments(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setApartments([]);
    } finally {
      setIsLoading(false);
    }
  }, [limit, filters.gym, filters.furnished, filters.parking]);

  useEffect(() => {
    if (autoFetch) {
      fetchApartments();
    }
  }, [autoFetch, fetchApartments]);

  return {
    apartments,
    isLoading,
    error,
    total,
    refetch: fetchApartments,
  };
}
