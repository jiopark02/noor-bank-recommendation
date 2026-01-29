/**
 * University Search Service
 *
 * Searches universities from Supabase database with fallback to local data.
 * Supports 5,000+ institutions across US, UK, and Canada.
 */

import { searchUniversities as searchLocalUniversities, University as LocalUniversity, Country } from './universities';

export interface UniversitySearchResult {
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
  website?: string;
}

export interface SearchOptions {
  limit?: number;
  country?: Country | Country[];
  type?: string | string[];
  offset?: number;
}

// Cache for API availability
let apiAvailable: boolean | null = null;
let lastApiCheck = 0;
const API_CHECK_INTERVAL = 60000; // 1 minute

/**
 * Check if the universities API is available
 */
async function checkApiAvailability(): Promise<boolean> {
  const now = Date.now();
  if (apiAvailable !== null && now - lastApiCheck < API_CHECK_INTERVAL) {
    return apiAvailable;
  }

  try {
    const response = await fetch('/api/universities?limit=1');
    const data = await response.json();
    apiAvailable = response.ok && !data.fallback;
    lastApiCheck = now;
    return apiAvailable;
  } catch {
    apiAvailable = false;
    lastApiCheck = now;
    return false;
  }
}

/**
 * Search universities from Supabase API
 */
async function searchFromApi(
  query: string,
  options: SearchOptions = {}
): Promise<UniversitySearchResult[]> {
  const { limit = 20, country, type, offset = 0 } = options;

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (limit) params.set('limit', limit.toString());
  if (offset) params.set('offset', offset.toString());
  if (country) {
    params.set('country', Array.isArray(country) ? country.join(',') : country);
  }
  if (type) {
    params.set('type', Array.isArray(type) ? type.join(',') : type);
  }

  const response = await fetch(`/api/universities?${params.toString()}`);

  if (!response.ok) {
    throw new Error('API request failed');
  }

  const data = await response.json();
  return data.data || [];
}

/**
 * Convert local university to search result format
 */
function toSearchResult(uni: LocalUniversity): UniversitySearchResult {
  return {
    id: uni.id,
    name: uni.name,
    short_name: uni.short_name,
    city: uni.city,
    state: uni.state,
    country: uni.country || 'US',
    type: uni.type,
    is_public: uni.is_public,
    enrollment: uni.enrollment,
    international_students: uni.international_students,
    website: uni.website,
  };
}

/**
 * Search universities from local data (fallback)
 */
function searchFromLocal(
  query: string,
  options: SearchOptions = {}
): UniversitySearchResult[] {
  const { limit = 20, country, type } = options;

  let results = searchLocalUniversities(query, { limit: limit * 2, country });

  // Filter by type if specified
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    results = results.filter(u => types.includes(u.type));
  }

  return results.slice(0, limit).map(toSearchResult);
}

/**
 * Search universities - tries API first, falls back to local data
 *
 * @param query - Search query (name, city, etc.)
 * @param options - Search options (limit, country, type)
 * @returns Promise resolving to array of universities
 */
export async function searchUniversities(
  query: string,
  options: SearchOptions = {}
): Promise<UniversitySearchResult[]> {
  // For server-side rendering or initial load, use local data
  if (typeof window === 'undefined') {
    return searchFromLocal(query, options);
  }

  // Check if API is available
  const isApiAvailable = await checkApiAvailability();

  if (isApiAvailable) {
    try {
      return await searchFromApi(query, options);
    } catch (error) {
      console.warn('API search failed, falling back to local data:', error);
      apiAvailable = false;
      return searchFromLocal(query, options);
    }
  }

  return searchFromLocal(query, options);
}

/**
 * Get university by ID
 */
export async function getUniversityById(id: string): Promise<UniversitySearchResult | null> {
  if (typeof window === 'undefined') {
    const { getUniversityById: getLocal } = await import('./universities');
    const local = getLocal(id);
    return local ? toSearchResult(local) : null;
  }

  const isApiAvailable = await checkApiAvailability();

  if (isApiAvailable) {
    try {
      const response = await fetch('/api/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.data?.[0] || null;
      }
    } catch (error) {
      console.warn('API getById failed, falling back to local:', error);
    }
  }

  const { getUniversityById: getLocal } = await import('./universities');
  const local = getLocal(id);
  return local ? toSearchResult(local) : null;
}

/**
 * Get universities by country
 */
export async function getUniversitiesByCountry(
  country: Country,
  options: { limit?: number; type?: string } = {}
): Promise<UniversitySearchResult[]> {
  return searchUniversities('', { ...options, country });
}

/**
 * Get all countries with university counts
 */
export async function getCountryCounts(): Promise<Record<string, number>> {
  // For now, return static counts - can be enhanced to query from API
  return {
    US: 7000,
    UK: 160,
    CA: 250,
  };
}
