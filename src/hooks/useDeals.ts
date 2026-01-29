import { useState, useEffect, useCallback } from 'react';

export interface Deal {
  id: string;
  title: string;
  description: string;
  discount_text: string | null;
  discount_percent: number | null;
  category: string;
  brand: string;
  link: string | null;
  logo_url: string | null;
  expires_at: string | null;
  upvotes: number;
  country: string;
  created_at: string;
}

interface UseDealsOptions {
  country?: string;
  category?: string;
  limit?: number;
}

export function useDeals({
  country,
  category,
  limit = 20,
}: UseDealsOptions = {}) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDeals = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get country from localStorage if not provided
      const savedCountry = typeof window !== 'undefined' ? localStorage.getItem('noor_selected_country') : null;
      const targetCountry = country || savedCountry || 'US';

      const params = new URLSearchParams({
        country: targetCountry,
        limit: limit.toString(),
      });

      if (category && category !== 'all') {
        params.set('category', category);
      }

      const response = await fetch(`/api/deals?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch deals');
      }

      setDeals(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch deals');
      setDeals([]);
    } finally {
      setIsLoading(false);
    }
  }, [country, category, limit]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  return {
    deals,
    isLoading,
    error,
    refetch: fetchDeals,
  };
}
