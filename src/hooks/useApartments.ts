import { useState, useEffect, useCallback } from 'react';
import { Apartment } from '@/types/database';

// Mock data for development
const MOCK_APARTMENTS: Apartment[] = [
  {
    id: '1',
    name: 'University Village',
    address: '123 College Ave, Berkeley, CA 94704',
    university: 'UC Berkeley',
    bedrooms: 'Studio - 2BR',
    bathrooms: '1-2',
    price_min: 1800,
    price_max: 2400,
    sqft_min: 400,
    sqft_max: 900,
    walking_minutes: 5,
    biking_minutes: 2,
    transit_minutes: 8,
    driving_minutes: 3,
    rating: 4.5,
    review_count: 48,
    available_units: 3,
    pet_policy: 'Cats and small dogs allowed',
    furnished: false,
    gym: true,
    parking: true,
    woman_only: false,
    verified: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: '2',
    name: 'Campus Edge',
    address: '456 University Dr, Berkeley, CA 94704',
    university: 'UC Berkeley',
    bedrooms: '1BR - 3BR',
    bathrooms: '1-2',
    price_min: 2200,
    price_max: 3100,
    sqft_min: 600,
    sqft_max: 1200,
    walking_minutes: 8,
    biking_minutes: 4,
    transit_minutes: 12,
    driving_minutes: 5,
    rating: 4.8,
    review_count: 72,
    available_units: 5,
    pet_policy: 'No pets',
    furnished: true,
    gym: true,
    parking: true,
    woman_only: false,
    verified: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: '3',
    name: 'The Graduate',
    address: '789 Scholar Way, Berkeley, CA 94704',
    university: 'UC Berkeley',
    bedrooms: 'Studio - 1BR',
    bathrooms: '1',
    price_min: 1500,
    price_max: 2000,
    sqft_min: 350,
    sqft_max: 650,
    walking_minutes: 12,
    biking_minutes: 5,
    transit_minutes: 15,
    driving_minutes: 6,
    rating: 4.2,
    review_count: 31,
    available_units: 8,
    pet_policy: 'Pets allowed with deposit',
    furnished: true,
    gym: false,
    parking: false,
    woman_only: false,
    verified: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  {
    id: '4',
    name: 'Hillside Terrace',
    address: '321 Hill St, Berkeley, CA 94704',
    university: 'UC Berkeley',
    bedrooms: '2BR - 4BR',
    bathrooms: '2-3',
    price_min: 2500,
    price_max: 3500,
    sqft_min: 900,
    sqft_max: 1600,
    walking_minutes: 15,
    biking_minutes: 7,
    transit_minutes: 20,
    driving_minutes: 8,
    rating: 4.6,
    review_count: 56,
    available_units: 2,
    pet_policy: 'All pets welcome',
    furnished: false,
    gym: true,
    parking: true,
    woman_only: false,
    verified: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
];

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
        throw new Error('Failed to fetch apartments');
      }

      const data = await response.json();
      setApartments(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      // Use mock data on error
      let filtered = [...MOCK_APARTMENTS];
      if (filters.gym) filtered = filtered.filter(a => a.gym);
      if (filters.furnished) filtered = filtered.filter(a => a.furnished);
      if (filters.parking) filtered = filtered.filter(a => a.parking);
      setApartments(filtered.slice(0, limit));
      setTotal(filtered.length);
      setError(null);
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
