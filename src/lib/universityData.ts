/**
 * University Location Data
 * Coordinates and campus side helpers for maps integration
 */

export type CampusSide = 'north' | 'south' | 'east' | 'west' | 'center';

export interface UniversityLocation {
  name: string;
  center: { lat: number; lng: number };
}

export const UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> = {
  'Stanford': { name: 'Stanford University', center: { lat: 37.4275, lng: -122.1697 } },
  'UC Berkeley': { name: 'UC Berkeley', center: { lat: 37.8719, lng: -122.2585 } },
  'UIUC': { name: 'UIUC', center: { lat: 40.1020, lng: -88.2272 } },
  'USC': { name: 'USC', center: { lat: 34.0224, lng: -118.2851 } },
  'UCLA': { name: 'UCLA', center: { lat: 34.0689, lng: -118.4452 } },
  'Columbia': { name: 'Columbia University', center: { lat: 40.8075, lng: -73.9626 } },
  'NYU': { name: 'NYU', center: { lat: 40.7295, lng: -73.9965 } },
  'Cornell': { name: 'Cornell University', center: { lat: 42.4534, lng: -76.4735 } },
  'Northeastern': { name: 'Northeastern University', center: { lat: 42.3398, lng: -71.0892 } },
  'UC Irvine': { name: 'UC Irvine', center: { lat: 33.6405, lng: -117.8443 } },
  'Boston U': { name: 'Boston University', center: { lat: 42.3505, lng: -71.1054 } },
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

// Bank branches organized by university
export const BANK_BRANCHES: Record<string, BankBranch[]> = {
  'Stanford': [
    { id: 'stanford-bofa-1', bank: 'Bank of America', name: 'Palo Alto Downtown', address: '420 University Ave, Palo Alto, CA', lat: 37.4448, lng: -122.1614, campusSide: 'north', phone: '(650) 462-2100' },
    { id: 'stanford-bofa-2', bank: 'Bank of America', name: 'Stanford Shopping Center', address: '660 Stanford Shopping Center, Palo Alto, CA', lat: 37.4436, lng: -122.1714, campusSide: 'north', phone: '(650) 463-4800' },
    { id: 'stanford-chase-1', bank: 'Chase', name: 'Palo Alto University Ave', address: '440 University Ave, Palo Alto, CA', lat: 37.4450, lng: -122.1610, campusSide: 'north', phone: '(650) 321-3400' },
    { id: 'stanford-chase-2', bank: 'Chase', name: 'California Ave', address: '275 S California Ave, Palo Alto, CA', lat: 37.4295, lng: -122.1424, campusSide: 'east', phone: '(650) 327-2000' },
    { id: 'stanford-wells-1', bank: 'Wells Fargo', name: 'University Ave', address: '475 University Ave, Palo Alto, CA', lat: 37.4452, lng: -122.1598, campusSide: 'north', phone: '(650) 462-3700' },
    { id: 'stanford-wells-2', bank: 'Wells Fargo', name: 'El Camino Real', address: '2600 El Camino Real, Palo Alto, CA', lat: 37.4300, lng: -122.1380, campusSide: 'east', phone: '(650) 327-4400' },
    { id: 'stanford-citi-1', bank: 'Citibank', name: 'Palo Alto', address: '445 Hamilton Ave, Palo Alto, CA', lat: 37.4430, lng: -122.1620, campusSide: 'north', phone: '(650) 326-5700' },
  ],
  'UC Berkeley': [
    { id: 'berkeley-bofa-1', bank: 'Bank of America', name: 'Telegraph Ave', address: '2333 Telegraph Ave, Berkeley, CA', lat: 37.8676, lng: -122.2594, campusSide: 'south', phone: '(510) 841-5000' },
    { id: 'berkeley-bofa-2', bank: 'Bank of America', name: 'Shattuck Ave', address: '2180 Shattuck Ave, Berkeley, CA', lat: 37.8708, lng: -122.2685, campusSide: 'west', phone: '(510) 845-4200' },
    { id: 'berkeley-chase-1', bank: 'Chase', name: 'Downtown Berkeley', address: '2120 Center St, Berkeley, CA', lat: 37.8695, lng: -122.2680, campusSide: 'west', phone: '(510) 849-5500' },
    { id: 'berkeley-wells-1', bank: 'Wells Fargo', name: 'Durant Ave', address: '2401 Durant Ave, Berkeley, CA', lat: 37.8678, lng: -122.2567, campusSide: 'south', phone: '(510) 843-2400' },
    { id: 'berkeley-wells-2', bank: 'Wells Fargo', name: 'Shattuck Ave', address: '2222 Shattuck Ave, Berkeley, CA', lat: 37.8700, lng: -122.2690, campusSide: 'west', phone: '(510) 548-7700' },
    { id: 'berkeley-citi-1', bank: 'Citibank', name: 'Berkeley', address: '2435 Telegraph Ave, Berkeley, CA', lat: 37.8665, lng: -122.2590, campusSide: 'south', phone: '(510) 486-0800' },
  ],
  'UIUC': [
    { id: 'uiuc-bofa-1', bank: 'Bank of America', name: 'Green Street', address: '616 E Green St, Champaign, IL', lat: 40.1105, lng: -88.2320, campusSide: 'north', phone: '(217) 351-4600' },
    { id: 'uiuc-chase-1', bank: 'Chase', name: 'Champaign', address: '502 E Green St, Champaign, IL', lat: 40.1108, lng: -88.2360, campusSide: 'north', phone: '(217) 352-8500' },
    { id: 'uiuc-chase-2', bank: 'Chase', name: 'Neil St', address: '200 N Neil St, Champaign, IL', lat: 40.1200, lng: -88.2445, campusSide: 'north', phone: '(217) 398-5100' },
    { id: 'uiuc-wells-1', bank: 'Wells Fargo', name: 'Green St', address: '601 E Green St, Champaign, IL', lat: 40.1103, lng: -88.2330, campusSide: 'north', phone: '(217) 378-6200' },
    { id: 'uiuc-busey-1', bank: 'Busey Bank', name: 'Campus', address: '201 W Springfield Ave, Champaign, IL', lat: 40.1082, lng: -88.2350, campusSide: 'center', phone: '(217) 365-4500' },
  ],
  'USC': [
    { id: 'usc-bofa-1', bank: 'Bank of America', name: 'Figueroa St', address: '3460 S Figueroa St, Los Angeles, CA', lat: 34.0230, lng: -118.2775, campusSide: 'east', phone: '(213) 740-2000' },
    { id: 'usc-bofa-2', bank: 'Bank of America', name: 'USC Village', address: '929 W Jefferson Blvd, Los Angeles, CA', lat: 34.0255, lng: -118.2895, campusSide: 'west', phone: '(213) 747-6200' },
    { id: 'usc-chase-1', bank: 'Chase', name: 'USC Campus', address: '3607 Trousdale Pkwy, Los Angeles, CA', lat: 34.0210, lng: -118.2850, campusSide: 'center', phone: '(213) 740-5700' },
    { id: 'usc-wells-1', bank: 'Wells Fargo', name: 'Jefferson Blvd', address: '3020 W Jefferson Blvd, Los Angeles, CA', lat: 34.0245, lng: -118.3000, campusSide: 'west', phone: '(213) 734-8000' },
    { id: 'usc-citi-1', bank: 'Citibank', name: 'Downtown LA', address: '700 S Flower St, Los Angeles, CA', lat: 34.0480, lng: -118.2570, campusSide: 'north', phone: '(213) 239-0200' },
  ],
  'UCLA': [
    { id: 'ucla-bofa-1', bank: 'Bank of America', name: 'Westwood Village', address: '1001 Westwood Blvd, Los Angeles, CA', lat: 34.0600, lng: -118.4445, campusSide: 'south', phone: '(310) 824-7400' },
    { id: 'ucla-bofa-2', bank: 'Bank of America', name: 'Wilshire Westwood', address: '10867 Wilshire Blvd, Los Angeles, CA', lat: 34.0595, lng: -118.4408, campusSide: 'south', phone: '(310) 208-2400' },
    { id: 'ucla-chase-1', bank: 'Chase', name: 'Westwood', address: '1100 Glendon Ave, Los Angeles, CA', lat: 34.0585, lng: -118.4380, campusSide: 'south', phone: '(310) 208-3500' },
    { id: 'ucla-wells-1', bank: 'Wells Fargo', name: 'Westwood Blvd', address: '1101 Westwood Blvd, Los Angeles, CA', lat: 34.0598, lng: -118.4450, campusSide: 'south', phone: '(310) 208-7811' },
    { id: 'ucla-citi-1', bank: 'Citibank', name: 'Westwood Village', address: '1055 Broxton Ave, Los Angeles, CA', lat: 34.0615, lng: -118.4473, campusSide: 'south', phone: '(310) 208-8181' },
  ],
  'Columbia': [
    { id: 'columbia-bofa-1', bank: 'Bank of America', name: 'Broadway', address: '2849 Broadway, New York, NY', lat: 40.8060, lng: -73.9655, campusSide: 'south', phone: '(212) 678-4900' },
    { id: 'columbia-chase-1', bank: 'Chase', name: 'Broadway Morningside', address: '2880 Broadway, New York, NY', lat: 40.8065, lng: -73.9660, campusSide: 'south', phone: '(212) 866-4200' },
    { id: 'columbia-chase-2', bank: 'Chase', name: 'Amsterdam Ave', address: '1130 Amsterdam Ave, New York, NY', lat: 40.8080, lng: -73.9600, campusSide: 'center', phone: '(212) 316-5500' },
    { id: 'columbia-wells-1', bank: 'Wells Fargo', name: 'Upper West Side', address: '2799 Broadway, New York, NY', lat: 40.8050, lng: -73.9670, campusSide: 'south', phone: '(212) 866-3700' },
    { id: 'columbia-td-1', bank: 'TD Bank', name: 'Broadway', address: '2859 Broadway, New York, NY', lat: 40.8062, lng: -73.9658, campusSide: 'south', phone: '(212) 666-5600' },
  ],
  'NYU': [
    { id: 'nyu-bofa-1', bank: 'Bank of America', name: 'Washington Square', address: '100 University Pl, New York, NY', lat: 40.7340, lng: -73.9940, campusSide: 'north', phone: '(212) 598-3000' },
    { id: 'nyu-chase-1', bank: 'Chase', name: 'Broadway', address: '770 Broadway, New York, NY', lat: 40.7310, lng: -73.9925, campusSide: 'east', phone: '(212) 505-4400' },
    { id: 'nyu-chase-2', bank: 'Chase', name: 'Astor Place', address: '51 Astor Pl, New York, NY', lat: 40.7300, lng: -73.9910, campusSide: 'east', phone: '(212) 477-6900' },
    { id: 'nyu-wells-1', bank: 'Wells Fargo', name: 'Union Square', address: '815 Broadway, New York, NY', lat: 40.7338, lng: -73.9905, campusSide: 'north', phone: '(212) 420-0700' },
    { id: 'nyu-citi-1', bank: 'Citibank', name: 'University Place', address: '20 W 8th St, New York, NY', lat: 40.7320, lng: -73.9970, campusSide: 'west', phone: '(212) 505-4100' },
  ],
  'Cornell': [
    { id: 'cornell-bofa-1', bank: 'Bank of America', name: 'Collegetown', address: '409 College Ave, Ithaca, NY', lat: 42.4420, lng: -76.4855, campusSide: 'south', phone: '(607) 273-5800' },
    { id: 'cornell-chase-1', bank: 'Chase', name: 'Commons', address: '130 E State St, Ithaca, NY', lat: 42.4400, lng: -76.4970, campusSide: 'west', phone: '(607) 273-3500' },
    { id: 'cornell-wells-1', bank: 'Wells Fargo', name: 'Ithaca', address: '301 E State St, Ithaca, NY', lat: 42.4405, lng: -76.4950, campusSide: 'west', phone: '(607) 272-1800' },
    { id: 'cornell-tompkins-1', bank: 'Tompkins Trust', name: 'Collegetown', address: '306 College Ave, Ithaca, NY', lat: 42.4425, lng: -76.4840, campusSide: 'south', phone: '(607) 273-3210' },
  ],
  'Northeastern': [
    { id: 'neu-bofa-1', bank: 'Bank of America', name: 'Huntington Ave', address: '300 Huntington Ave, Boston, MA', lat: 42.3410, lng: -71.0890, campusSide: 'center', phone: '(617) 437-7500' },
    { id: 'neu-bofa-2', bank: 'Bank of America', name: 'Ruggles', address: '1200 Columbus Ave, Boston, MA', lat: 42.3365, lng: -71.0910, campusSide: 'south', phone: '(617) 541-4500' },
    { id: 'neu-chase-1', bank: 'Chase', name: 'Prudential', address: '800 Boylston St, Boston, MA', lat: 42.3475, lng: -71.0820, campusSide: 'north', phone: '(617) 247-8400' },
    { id: 'neu-santander-1', bank: 'Santander', name: 'Mass Ave', address: '761 Massachusetts Ave, Boston, MA', lat: 42.3380, lng: -71.0850, campusSide: 'east', phone: '(617) 437-7800' },
    { id: 'neu-td-1', bank: 'TD Bank', name: 'Northeastern', address: '270 Huntington Ave, Boston, MA', lat: 42.3415, lng: -71.0880, campusSide: 'center', phone: '(617) 867-5800' },
  ],
  'UC Irvine': [
    { id: 'uci-bofa-1', bank: 'Bank of America', name: 'University Center', address: '4115 Campus Dr, Irvine, CA', lat: 33.6460, lng: -117.8420, campusSide: 'north', phone: '(949) 824-5700' },
    { id: 'uci-chase-1', bank: 'Chase', name: 'Campus Plaza', address: '4235 Campus Dr, Irvine, CA', lat: 33.6470, lng: -117.8410, campusSide: 'north', phone: '(949) 854-6100' },
    { id: 'uci-wells-1', bank: 'Wells Fargo', name: 'Irvine', address: '4040 Barranca Pkwy, Irvine, CA', lat: 33.6680, lng: -117.8550, campusSide: 'north', phone: '(949) 551-5900' },
    { id: 'uci-union-1', bank: 'Union Bank', name: 'University Town Center', address: '4501 Campus Dr, Irvine, CA', lat: 33.6495, lng: -117.8395, campusSide: 'north', phone: '(949) 824-5300' },
  ],
  'Boston U': [
    { id: 'bu-bofa-1', bank: 'Bank of America', name: 'Commonwealth Ave', address: '714 Commonwealth Ave, Boston, MA', lat: 42.3500, lng: -71.1030, campusSide: 'center', phone: '(617) 536-4900' },
    { id: 'bu-bofa-2', bank: 'Bank of America', name: 'Kenmore', address: '660 Beacon St, Boston, MA', lat: 42.3490, lng: -71.0960, campusSide: 'east', phone: '(617) 236-2300' },
    { id: 'bu-chase-1', bank: 'Chase', name: 'Brookline Ave', address: '1318 Beacon St, Brookline, MA', lat: 42.3440, lng: -71.1185, campusSide: 'west', phone: '(617) 734-2500' },
    { id: 'bu-santander-1', bank: 'Santander', name: 'Commonwealth Ave', address: '874 Commonwealth Ave, Boston, MA', lat: 42.3498, lng: -71.1090, campusSide: 'center', phone: '(617) 782-3400' },
    { id: 'bu-td-1', bank: 'TD Bank', name: 'Allston', address: '1205 Commonwealth Ave, Boston, MA', lat: 42.3510, lng: -71.1320, campusSide: 'west', phone: '(617) 783-2300' },
  ],
};

/**
 * Get branches near a specific university
 */
export function getBranchesForUniversity(university: string): BankBranch[] {
  return BANK_BRANCHES[university] || [];
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
  const branches = getBranchesForUniversity(university);
  return branches.filter(b => b.bank.toLowerCase() === bankName.toLowerCase());
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
  const branches = getBranchesForUniversity(university);
  return Array.from(new Set(branches.map(b => b.bank)));
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
