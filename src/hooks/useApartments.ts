import { useState, useEffect, useCallback } from 'react';
import { Apartment } from '@/types/database';

interface UseApartmentsOptions {
  limit?: number;
  filters?: {
    gym?: boolean;
    furnished?: boolean;
    parking?: boolean;
    campusSide?: string;
    university?: string;
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

export function useApartments({ limit = 20, filters = {}, autoFetch = true }: UseApartmentsOptions = {}): UseApartmentsReturn {
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchApartments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get country from localStorage
      const savedCountry = typeof window !== 'undefined' ? localStorage.getItem('noor_selected_country') : null;
      const country = savedCountry || 'US';

      // Build API query params
      const params = new URLSearchParams({
        country,
        limit: limit.toString(),
      });

      if (filters.university) {
        params.set('university', filters.university);
      }
      if (filters.gym) params.set('gym', 'true');
      if (filters.furnished) params.set('furnished', 'true');
      if (filters.parking) params.set('parking', 'true');
      if (filters.campusSide) params.set('campus_side', filters.campusSide);

      // Fetch from API (which uses local data)
      const response = await fetch(`/api/apartments?${params}`);
      const data = await response.json();

      if (response.ok && data.success) {
        setApartments(data.data || []);
        setTotal(data.meta?.total || data.data?.length || 0);
        setError(null);
      } else {
        setApartments([]);
        setTotal(0);
        setError(data.error || 'Failed to fetch apartments');
      }
    } catch (err) {
      setApartments([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Failed to fetch apartments');
    } finally {
      setIsLoading(false);
    }
  }, [limit, filters.gym, filters.furnished, filters.parking, filters.campusSide, filters.university]);

  useEffect(() => {
    if (autoFetch) fetchApartments();
  }, [autoFetch, fetchApartments]);

  return {
    apartments,
    isLoading,
    error,
    total,
    refetch: fetchApartments,
  };
}
