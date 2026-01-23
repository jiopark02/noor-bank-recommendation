import { useState, useEffect, useCallback } from 'react';
import { Apartment } from '@/types/database';

// Mock data for development
const MOCK_APARTMENTS: Apartment[] = [
  {
    id: '1',
    name: 'University Village',
    address: '123 College Ave',
    city: 'Berkeley',
    state: 'CA',
    zip: '94704',
    price_min: 1800,
    price_max: 2400,
    bedrooms: 'Studio - 2BR',
    bathrooms: '1-2',
    sqft_min: 400,
    sqft_max: 900,
    walking_minutes: 5,
    has_gym: true,
    has_pool: false,
    has_parking: true,
    is_furnished: false,
    pet_friendly: true,
    images: [],
    amenities: ['Gym', 'Parking', 'Laundry'],
  },
  {
    id: '2',
    name: 'Campus Edge',
    address: '456 University Dr',
    city: 'Berkeley',
    state: 'CA',
    zip: '94704',
    price_min: 2200,
    price_max: 3100,
    bedrooms: '1BR - 3BR',
    bathrooms: '1-2',
    sqft_min: 600,
    sqft_max: 1200,
    walking_minutes: 8,
    has_gym: true,
    has_pool: true,
    has_parking: true,
    is_furnished: true,
    pet_friendly: false,
    images: [],
    amenities: ['Gym', 'Pool', 'Furnished', 'Parking'],
  },
  {
    id: '3',
    name: 'The Graduate',
    address: '789 Scholar Way',
    city: 'Berkeley',
    state: 'CA',
    zip: '94704',
    price_min: 1500,
    price_max: 2000,
    bedrooms: 'Studio - 1BR',
    bathrooms: '1',
    sqft_min: 350,
    sqft_max: 650,
    walking_minutes: 12,
    has_gym: false,
    has_pool: false,
    has_parking: false,
    is_furnished: true,
    pet_friendly: true,
    images: [],
    amenities: ['Furnished', 'Pet Friendly'],
  },
  {
    id: '4',
    name: 'Hillside Terrace',
    address: '321 Hill St',
    city: 'Berkeley',
    state: 'CA',
    zip: '94704',
    price_min: 2500,
    price_max: 3500,
    bedrooms: '2BR - 4BR',
    bathrooms: '2-3',
    sqft_min: 900,
    sqft_max: 1600,
    walking_minutes: 15,
    has_gym: true,
    has_pool: true,
    has_parking: true,
    is_furnished: false,
    pet_friendly: true,
    images: [],
    amenities: ['Gym', 'Pool', 'Parking', 'Pet Friendly'],
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
      if (filters.gym) filtered = filtered.filter(a => a.has_gym);
      if (filters.furnished) filtered = filtered.filter(a => a.is_furnished);
      if (filters.parking) filtered = filtered.filter(a => a.has_parking);
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
