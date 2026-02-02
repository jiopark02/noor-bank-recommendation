/**
 * University Location Data
 * Auto-generated from ALL_UNIVERSITIES for consistency
 * Uses short_name as key to match survey data
 */

import { ALL_UNIVERSITIES } from '../universities';

export interface UniversityLocation {
  name: string;
  short_name: string;
  center: { lat: number; lng: number };
  country: 'US' | 'UK' | 'CA';
  city: string;
  state?: string;
  aliases?: string[];
}

// ============================================================================
// GENERATE LOCATIONS FROM ALL_UNIVERSITIES
// ============================================================================

function generateLocations(): Record<string, UniversityLocation> {
  const locations: Record<string, UniversityLocation> = {};

  for (const uni of ALL_UNIVERSITIES) {
    const country = (uni.country || 'US') as 'US' | 'UK' | 'CA';

    // Primary key: short_name
    const location: UniversityLocation = {
      name: uni.name,
      short_name: uni.short_name,
      center: { lat: uni.latitude, lng: uni.longitude },
      country,
      city: uni.city,
      state: uni.state,
      aliases: uni.aliases || [],
    };

    // Add by short_name (primary key used in survey)
    locations[uni.short_name] = location;

    // Also add by full name for backwards compatibility
    if (uni.name !== uni.short_name) {
      locations[uni.name] = location;
    }

    // Add by aliases
    if (uni.aliases) {
      for (const alias of uni.aliases) {
        if (!locations[alias]) {
          locations[alias] = location;
        }
      }
    }
  }

  return locations;
}

// Generate all location mappings
export const ALL_UNIVERSITY_LOCATIONS = generateLocations();

// Country-specific subsets
export const US_UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> =
  Object.fromEntries(
    Object.entries(ALL_UNIVERSITY_LOCATIONS).filter(([_, loc]) => loc.country === 'US')
  );

export const UK_UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> =
  Object.fromEntries(
    Object.entries(ALL_UNIVERSITY_LOCATIONS).filter(([_, loc]) => loc.country === 'UK')
  );

export const CANADA_UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> =
  Object.fromEntries(
    Object.entries(ALL_UNIVERSITY_LOCATIONS).filter(([_, loc]) => loc.country === 'CA')
  );

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize university name for matching
 * Handles various formats: full name, short name, aliases
 */
export function normalizeUniversityName(name: string): string {
  if (!name) return '';
  return name.toLowerCase().trim();
}

/**
 * Find university location by any name variant
 * Matches short_name, full name, or aliases
 */
export function findUniversityLocation(searchName: string): UniversityLocation | null {
  if (!searchName) return null;

  const normalized = normalizeUniversityName(searchName);

  // Direct match
  for (const [key, location] of Object.entries(ALL_UNIVERSITY_LOCATIONS)) {
    if (normalizeUniversityName(key) === normalized) {
      return location;
    }
  }

  // Partial match
  for (const [key, location] of Object.entries(ALL_UNIVERSITY_LOCATIONS)) {
    const keyNorm = normalizeUniversityName(key);
    if (keyNorm.includes(normalized) || normalized.includes(keyNorm)) {
      return location;
    }
  }

  // Check full name and aliases
  for (const location of Object.values(ALL_UNIVERSITY_LOCATIONS)) {
    if (normalizeUniversityName(location.name).includes(normalized)) {
      return location;
    }
    if (location.aliases) {
      for (const alias of location.aliases) {
        if (normalizeUniversityName(alias).includes(normalized) ||
            normalized.includes(normalizeUniversityName(alias))) {
          return location;
        }
      }
    }
  }

  return null;
}

/**
 * Get university center coordinates
 */
export function getUniversityCenter(name: string): { lat: number; lng: number } | null {
  const location = findUniversityLocation(name);
  return location?.center || null;
}

/**
 * Get university country
 */
export function getUniversityCountryFromLocation(name: string): 'US' | 'UK' | 'CA' | null {
  const location = findUniversityLocation(name);
  return location?.country || null;
}
