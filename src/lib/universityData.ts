/**
 * University Location Data
 * Coordinates and campus side helpers for maps integration
 */

import {
  ALL_BANK_BRANCHES,
  ALL_UNIVERSITY_LOCATIONS,
  ALL_APARTMENTS,
  getBankBranchesForUniversity,
  getApartmentsForUniversity,
  getUniversityLocation,
  getAvailableBanksAtUniversity,
  getBranchesForBankAtUniversity,
  hasUniversityData,
  getUniversityCountry,
  getUniversitiesForCountry,
  getDataStatistics,
} from './locationData';

export type CampusSide = 'north' | 'south' | 'east' | 'west' | 'center';

export interface UniversityLocation {
  name: string;
  center: { lat: number; lng: number };
}

// Convert new format to legacy format for backwards compatibility
const convertToLegacyFormat = (): Record<string, UniversityLocation> => {
  const result: Record<string, UniversityLocation> = {};
  for (const [key, location] of Object.entries(ALL_UNIVERSITY_LOCATIONS)) {
    result[key] = {
      name: location.name,
      center: location.center,
    };
  }
  return result;
};

export const UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> = convertToLegacyFormat();

// Re-export helper functions from locationData
export {
  getBankBranchesForUniversity,
  getApartmentsForUniversity,
  getUniversityLocation,
  getAvailableBanksAtUniversity,
  getBranchesForBankAtUniversity,
  hasUniversityData,
  getUniversityCountry,
  getUniversitiesForCountry,
  getDataStatistics,
  ALL_BANK_BRANCHES,
  ALL_APARTMENTS,
};

/**
 * Calculate which side of campus a location is on
 */
export function calculateCampusSide(university: string, lat: number, lng: number): CampusSide {
  const uniLocation = UNIVERSITY_LOCATIONS[university];
  if (!uniLocation) return 'center';

  const { center } = uniLocation;
  const latDiff = lat - center.lat;
  const lngDiff = lng - center.lng;

  // Threshold for "center" (within ~0.5 miles)
  const threshold = 0.008;
  if (Math.abs(latDiff) < threshold && Math.abs(lngDiff) < threshold) {
    return 'center';
  }

  // Determine primary direction
  if (Math.abs(latDiff) > Math.abs(lngDiff)) {
    return latDiff > 0 ? 'north' : 'south';
  } else {
    return lngDiff > 0 ? 'east' : 'west';
  }
}

/**
 * Get display name for campus side
 */
export function getCampusSideLabel(side: CampusSide): string {
  const labels: Record<CampusSide, string> = {
    north: 'North side',
    south: 'South side',
    east: 'East side',
    west: 'West side',
    center: 'Near campus',
  };
  return labels[side];
}

// Bank branch data
export interface BankBranch {
  id: string;
  bank: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  campusSide: CampusSide;
  phone?: string;
  hours?: string;
}

// Bank branches organized by university - uses comprehensive data from locationData
export const BANK_BRANCHES: Record<string, BankBranch[]> = ALL_BANK_BRANCHES;

/**
 * Get branches near a specific university (uses fuzzy matching)
 */
export function getBranchesForUniversity(university: string): BankBranch[] {
  return getBankBranchesForUniversity(university);
}

/**
 * Get branches filtered by campus side
 */
export function getBranchesByCampusSide(university: string, side: CampusSide): BankBranch[] {
  const branches = getBranchesForUniversity(university);
  if (side === 'center') return branches;
  return branches.filter(b => b.campusSide === side || b.campusSide === 'center');
}

/**
 * Get branches for a specific bank at a university
 */
export function getBranchesForBank(university: string, bankName: string): BankBranch[] {
  return getBranchesForBankAtUniversity(university, bankName);
}

/**
 * Count branches for a bank at a university
 */
export function countBranchesForBank(university: string, bankName: string): number {
  return getBranchesForBank(university, bankName).length;
}

/**
 * Get branch count by campus side for a bank
 */
export function getBranchCountBySide(university: string, bankName: string, side: CampusSide): number {
  const branches = getBranchesForBank(university, bankName);
  if (side === 'center') return branches.length;
  return branches.filter(b => b.campusSide === side || b.campusSide === 'center').length;
}

/**
 * Get all unique banks available at a university
 */
export function getAvailableBanks(university: string): string[] {
  return getAvailableBanksAtUniversity(university);
}

/**
 * Calculate distance between two points (in km)
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get nearest branch for a bank with estimated walking time
 */
export interface NearestBranchInfo {
  branch: BankBranch;
  distanceKm: number;
  walkingMinutes: number;
}

export function getNearestBranch(university: string, bankName: string): NearestBranchInfo | null {
  const branches = getBranchesForBank(university, bankName);
  if (branches.length === 0) return null;

  const uniLocation = UNIVERSITY_LOCATIONS[university];
  if (!uniLocation) return null;

  let nearest: BankBranch | null = null;
  let minDistance = Infinity;

  for (const branch of branches) {
    const distance = haversineDistance(
      uniLocation.center.lat,
      uniLocation.center.lng,
      branch.lat,
      branch.lng
    );
    if (distance < minDistance) {
      minDistance = distance;
      nearest = branch;
    }
  }

  if (!nearest) return null;

  // Average walking speed is 5 km/h, so walking time = distance * 12 minutes per km
  const walkingMinutes = Math.round(minDistance * 12);

  return {
    branch: nearest,
    distanceKm: Math.round(minDistance * 10) / 10,
    walkingMinutes: Math.max(1, walkingMinutes), // At least 1 minute
  };
}
