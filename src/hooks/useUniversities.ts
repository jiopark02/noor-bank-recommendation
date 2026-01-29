import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface University {
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  country: string;
  type: string;
  is_public: boolean;
  enrollment: number | null;
}

interface UseUniversitiesOptions {
  country?: string;
  searchQuery?: string;
  limit?: number;
  type?: 'university' | 'community_college' | 'all';
}

export function useUniversities({
  country = 'US',
  searchQuery = '',
  limit = 20,
  type = 'all',
}: UseUniversitiesOptions = {}) {
  const [universities, setUniversities] = useState<University[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUniversities = useCallback(async () => {
    if (!supabase) {
      setError('Supabase not configured');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('universities')
        .select('id, name, short_name, city, state, country, type, is_public, enrollment')
        .eq('country', country)
        .order('enrollment', { ascending: false, nullsFirst: false })
        .limit(limit);

      // Filter by type
      if (type === 'university') {
        query = query.neq('type', 'community_college');
      } else if (type === 'community_college') {
        query = query.eq('type', 'community_college');
      }

      // Search query
      if (searchQuery && searchQuery.length >= 2) {
        query = query.or(`name.ilike.%${searchQuery}%,short_name.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%`);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setUniversities(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch universities');
      setUniversities([]);
    } finally {
      setIsLoading(false);
    }
  }, [country, searchQuery, limit, type]);

  useEffect(() => {
    fetchUniversities();
  }, [fetchUniversities]);

  return {
    universities,
    isLoading,
    error,
    refetch: fetchUniversities,
  };
}

// Search universities with debounce
export function useUniversitySearch(country: string = 'US', type: 'university' | 'community_college' | 'all' = 'all') {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { universities, isLoading, error } = useUniversities({
    country,
    searchQuery: debouncedQuery,
    limit: 15,
    type,
  });

  return {
    query,
    setQuery,
    universities,
    isLoading,
    error,
  };
}
