import { useState, useEffect, useCallback } from 'react';

export interface University {
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  country: string;
  type: string;
  is_public: boolean;
  enrollment?: number;
  international_students?: number;
}

interface UseUniversitySearchOptions {
  country: string;
  type: 'university' | 'community_college' | 'all';
  enabled?: boolean;
  searchQuery?: string; // External search query
}

export function useUniversitySearch({
  country,
  type,
  enabled = true,
  searchQuery: externalQuery,
}: UseUniversitySearchOptions) {
  const [internalQuery, setInternalQuery] = useState('');
  const [universities, setUniversities] = useState<University[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use external query if provided, otherwise use internal
  const query = externalQuery !== undefined ? externalQuery : internalQuery;
  const setQuery = setInternalQuery;

  const fetchUniversities = useCallback(async (searchQuery: string) => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        country: country || 'US',
        limit: '20',
      });

      if (searchQuery && searchQuery.length >= 2) {
        params.set('q', searchQuery);
      }

      if (type && type !== 'all') {
        params.set('type', type);
      }

      const response = await fetch(`/api/universities?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch universities');
      }

      setUniversities(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch universities');
      setUniversities([]);
    } finally {
      setIsLoading(false);
    }
  }, [country, type, enabled]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUniversities(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, fetchUniversities]);

  return {
    query,
    setQuery,
    universities,
    isLoading,
    error,
    refetch: () => fetchUniversities(query),
  };
}

// Get university by ID
export async function getUniversityById(id: string): Promise<University | null> {
  try {
    const response = await fetch('/api/universities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      return data.data[0];
    }
    return null;
  } catch {
    return null;
  }
}
