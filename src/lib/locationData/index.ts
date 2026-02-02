/**
 * Location Data Index
 * Combines all bank branches, university locations, and apartments
 */

// Re-export types
export type { BankBranch, CampusSide, UniversityLocation as UniversityLocationLegacy } from '../universityData';
export type { UniversityLocation } from './universityLocations';
export type { ApartmentData } from './apartmentsData';

// Import all data
import { ALL_US_BANK_BRANCHES } from './usBankBranches';
import { ALL_UK_BANK_BRANCHES } from './ukBankBranches';
import { ALL_CANADA_BANK_BRANCHES } from './canadaBankBranches';
import {
  ALL_UNIVERSITY_LOCATIONS,
  US_UNIVERSITY_LOCATIONS,
  UK_UNIVERSITY_LOCATIONS,
  CANADA_UNIVERSITY_LOCATIONS,
  findUniversityLocation,
  normalizeUniversityName
} from './universityLocations';
import {
  ALL_APARTMENTS,
  US_APARTMENTS,
  UK_APARTMENTS,
  CA_APARTMENTS
} from './apartmentsData';

import { BankBranch } from '../universityData';

// ============================================================================
// COMBINED BANK BRANCHES
// ============================================================================

export const ALL_BANK_BRANCHES: Record<string, BankBranch[]> = {
  ...ALL_US_BANK_BRANCHES,
  ...ALL_UK_BANK_BRANCHES,
  ...ALL_CANADA_BANK_BRANCHES,
};

// Export individual region data
export {
  ALL_US_BANK_BRANCHES,
  ALL_UK_BANK_BRANCHES,
  ALL_CANADA_BANK_BRANCHES,
};

// ============================================================================
// UNIVERSITY LOCATIONS
// ============================================================================

export {
  ALL_UNIVERSITY_LOCATIONS,
  US_UNIVERSITY_LOCATIONS,
  UK_UNIVERSITY_LOCATIONS,
  CANADA_UNIVERSITY_LOCATIONS,
};

// ============================================================================
// APARTMENTS
// ============================================================================

export {
  ALL_APARTMENTS,
  US_APARTMENTS,
  UK_APARTMENTS,
  CA_APARTMENTS,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get bank branches for a university (with fuzzy matching)
 */
export function getBankBranchesForUniversity(university: string): BankBranch[] {
  // Direct match
  if (ALL_BANK_BRANCHES[university]) {
    return ALL_BANK_BRANCHES[university];
  }

  // Fuzzy match - check if university name contains or is contained in keys
  const normalizedSearch = university.toLowerCase().trim();

  for (const [key, branches] of Object.entries(ALL_BANK_BRANCHES)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes(normalizedSearch) || normalizedSearch.includes(normalizedKey)) {
      return branches;
    }
  }

  // Check university locations for aliases
  const location = ALL_UNIVERSITY_LOCATIONS[university];
  if (location) {
    const locationName = location.name.toLowerCase();
    for (const [key, branches] of Object.entries(ALL_BANK_BRANCHES)) {
      if (key.toLowerCase().includes(locationName) || locationName.includes(key.toLowerCase())) {
        return branches;
      }
    }
  }

  return [];
}

/**
 * Get apartments for a university (with fuzzy matching)
 */
export function getApartmentsForUniversity(university: string): typeof ALL_APARTMENTS {
  const normalizedSearch = university.toLowerCase().trim();

  return ALL_APARTMENTS.filter(apt => {
    const aptUni = apt.university.toLowerCase();
    return aptUni === normalizedSearch ||
           aptUni.includes(normalizedSearch) ||
           normalizedSearch.includes(aptUni);
  });
}

/**
 * Get university location data
 * Uses comprehensive matching: short_name, full name, and aliases
 */
export function getUniversityLocation(university: string) {
  return findUniversityLocation(university);
}

/**
 * Get all banks available at a university
 */
export function getAvailableBanksAtUniversity(university: string): string[] {
  const branches = getBankBranchesForUniversity(university);
  const uniqueBanks = new Set(branches.map(b => b.bank));
  return Array.from(uniqueBanks);
}

/**
 * Get bank branches filtered by bank name
 */
export function getBranchesForBankAtUniversity(university: string, bankName: string): BankBranch[] {
  const branches = getBankBranchesForUniversity(university);
  return branches.filter(b => b.bank.toLowerCase() === bankName.toLowerCase());
}

/**
 * Check if a university has location data
 */
export function hasUniversityData(university: string): boolean {
  return !!getUniversityLocation(university);
}

/**
 * Get country for a university
 */
export function getUniversityCountry(university: string): 'US' | 'UK' | 'CA' | null {
  const location = getUniversityLocation(university);
  return location?.country || null;
}

/**
 * Get all universities for a country
 */
export function getUniversitiesForCountry(country: 'US' | 'UK' | 'CA'): string[] {
  const locationMap = {
    'US': US_UNIVERSITY_LOCATIONS,
    'UK': UK_UNIVERSITY_LOCATIONS,
    'CA': CANADA_UNIVERSITY_LOCATIONS,
  };

  return Object.keys(locationMap[country] || {});
}

/**
 * Get statistics about available data
 */
export function getDataStatistics() {
  const usUniversities = Object.keys(US_UNIVERSITY_LOCATIONS).length;
  const ukUniversities = Object.keys(UK_UNIVERSITY_LOCATIONS).length;
  const caUniversities = Object.keys(CANADA_UNIVERSITY_LOCATIONS).length;

  const usBranches = Object.values(ALL_US_BANK_BRANCHES).flat().length;
  const ukBranches = Object.values(ALL_UK_BANK_BRANCHES).flat().length;
  const caBranches = Object.values(ALL_CANADA_BANK_BRANCHES).flat().length;

  return {
    universities: {
      total: usUniversities + ukUniversities + caUniversities,
      us: usUniversities,
      uk: ukUniversities,
      canada: caUniversities,
    },
    bankBranches: {
      total: usBranches + ukBranches + caBranches,
      us: usBranches,
      uk: ukBranches,
      canada: caBranches,
    },
    apartments: {
      total: ALL_APARTMENTS.length,
      us: US_APARTMENTS.length,
      uk: UK_APARTMENTS.length,
      canada: CA_APARTMENTS.length,
    },
  };
}
