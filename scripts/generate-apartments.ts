/**
 * Comprehensive Apartment Data Generator
 * Generates 10 apartments per university for US, UK, and Canada
 */

// Apartment name templates by country
const US_APARTMENT_NAMES = [
  ['The', 'Residences'],
  ['Campus', 'Village'],
  ['University', 'Apartments'],
  ['College', 'Commons'],
  ['The', 'Heights'],
  ['Park', 'Place'],
  ['Student', 'Living'],
  ['Metro', 'Apartments'],
  ['City', 'Center'],
  ['Collegiate', 'Housing'],
  ['Summit', 'Suites'],
  ['Plaza', 'Apartments'],
  ['Vista', 'Living'],
  ['The', 'Lofts'],
  ['Gateway', 'Apartments'],
  ['Horizon', 'Suites'],
  ['The', 'Quarters'],
  ['Academy', 'Hall'],
  ['The', 'Reserve'],
  ['Landmark', 'Apartments'],
];

const UK_APARTMENT_NAMES = [
  ['Student', 'House'],
  ['University', 'Halls'],
  ['Campus', 'Lodge'],
  ['The', 'Residence'],
  ['College', 'Court'],
  ['City', 'Rooms'],
  ['Student', 'Village'],
  ['The', 'Studios'],
  ['Academic', 'House'],
  ['Scholar', 'House'],
  ['Trinity', 'Court'],
  ['Crown', 'Place'],
  ['Castle', 'View'],
  ['Garden', 'Court'],
  ['The', 'Quadrant'],
  ['University', 'Green'],
  ['King', 'House'],
  ['Queens', 'Court'],
  ['Victoria', 'House'],
  ['Royal', 'Residence'],
];

const CA_APARTMENT_NAMES = [
  ['Campus', 'Residence'],
  ['University', 'Suites'],
  ['Student', 'Housing'],
  ['College', 'Living'],
  ['The', 'Commons'],
  ['Maple', 'House'],
  ['Academic', 'Residence'],
  ['Campus', 'Place'],
  ['The', 'Towers'],
  ['University', 'Village'],
  ['Scholar', 'Suites'],
  ['Northern', 'Residence'],
  ['Lakeside', 'Living'],
  ['Cedar', 'Hall'],
  ['Oak', 'Residence'],
  ['The', 'Quarters'],
  ['Campus', 'View'],
  ['Metro', 'Suites'],
  ['City', 'Living'],
  ['Pioneer', 'House'],
];

// Price ranges by country and city type
const PRICE_RANGES = {
  US: {
    expensive: { min: 1800, max: 4500 },    // NYC, SF, LA, Boston
    moderate: { min: 1200, max: 2800 },     // Most cities
    affordable: { min: 700, max: 1800 },    // Smaller college towns
  },
  UK: {
    expensive: { min: 1200, max: 2800 },    // London (in GBP)
    moderate: { min: 600, max: 1400 },      // Manchester, Edinburgh, etc
    affordable: { min: 400, max: 900 },     // Smaller towns
  },
  CA: {
    expensive: { min: 1600, max: 3500 },    // Toronto, Vancouver (in CAD)
    moderate: { min: 1000, max: 2200 },     // Calgary, Ottawa
    affordable: { min: 600, max: 1400 },    // Smaller cities
  },
};

// Expensive cities by country
const EXPENSIVE_CITIES = {
  US: ['New York', 'San Francisco', 'Los Angeles', 'Boston', 'Washington', 'Seattle', 'San Jose', 'Palo Alto', 'Cambridge'],
  UK: ['London'],
  CA: ['Toronto', 'Vancouver'],
};

const MODERATE_CITIES = {
  US: ['Chicago', 'Philadelphia', 'San Diego', 'Denver', 'Austin', 'Miami', 'Atlanta', 'Portland', 'Minneapolis'],
  UK: ['Manchester', 'Edinburgh', 'Bristol', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool'],
  CA: ['Calgary', 'Ottawa', 'Montreal', 'Edmonton'],
};

const CAMPUS_SIDES = ['north', 'south', 'east', 'west', 'center'] as const;
const PET_POLICIES = ['No pets', 'Cats only', 'Cats allowed', 'Small pets', 'Pets welcome'];
const BEDROOM_OPTIONS = ['Studio', 'Studio - 1BR', '1BR', '1BR - 2BR', 'Studio - 2BR', '2BR - 3BR', '1BR - 3BR', 'Studio - 4BR'];

// Generate random number in range
function random(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Generate random float
function randomFloat(min: number, max: number, decimals: number = 4): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

// Get price tier for a city
function getPriceTier(country: 'US' | 'UK' | 'CA', city: string): 'expensive' | 'moderate' | 'affordable' {
  if (EXPENSIVE_CITIES[country].some(c => city.toLowerCase().includes(c.toLowerCase()))) {
    return 'expensive';
  }
  if (MODERATE_CITIES[country].some(c => city.toLowerCase().includes(c.toLowerCase()))) {
    return 'moderate';
  }
  return 'affordable';
}

// Generate coordinates near university
function generateNearbyCoords(centerLat: number, centerLng: number, index: number): { lat: number; lng: number } {
  // Spread apartments around the university (within ~1-2 miles)
  const angle = (index / 10) * 2 * Math.PI + randomFloat(-0.3, 0.3);
  const distance = randomFloat(0.005, 0.025); // ~0.5 to 2.5 km

  return {
    lat: centerLat + distance * Math.cos(angle),
    lng: centerLng + distance * Math.sin(angle),
  };
}

// Generate apartment data for a university
function generateApartmentsForUniversity(
  uniKey: string,
  uniName: string,
  city: string,
  state: string | undefined,
  country: 'US' | 'UK' | 'CA',
  centerLat: number,
  centerLng: number
): string {
  const apartments: string[] = [];
  const nameTemplates = country === 'US' ? US_APARTMENT_NAMES : country === 'UK' ? UK_APARTMENT_NAMES : CA_APARTMENT_NAMES;
  const priceTier = getPriceTier(country, city);
  const priceRange = PRICE_RANGES[country][priceTier];

  // Clean up university key for IDs
  const cleanKey = uniKey.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 30);

  for (let i = 0; i < 10; i++) {
    const template = nameTemplates[i % nameTemplates.length];
    const name = `${template[0]} ${city.split(' ')[0]} ${template[1]}`.substring(0, 40);
    const coords = generateNearbyCoords(centerLat, centerLng, i);
    const campusSide = CAMPUS_SIDES[i % 5];

    // Generate prices with some variation
    const baseMin = priceRange.min + random(-200, 200);
    const baseMax = priceRange.max + random(-300, 300);
    const priceMin = Math.max(400, baseMin);
    const priceMax = Math.max(priceMin + 400, baseMax);

    // Generate other attributes
    const walkingMin = random(3, 25);
    const bikingMin = Math.max(1, Math.floor(walkingMin / 3));
    const transitMin = walkingMin + random(2, 8);
    const drivingMin = Math.max(2, Math.floor(walkingMin / 4));

    const rating = randomFloat(3.8, 4.9, 1);
    const reviewCount = random(50, 400);
    const sqftMin = random(350, 600);
    const sqftMax = sqftMin + random(200, 600);

    const bedrooms = BEDROOM_OPTIONS[random(0, BEDROOM_OPTIONS.length - 1)];
    const bathrooms = bedrooms.includes('Studio') ? '1' : random(1, 2) === 1 ? '1' : '1-2';
    const petPolicy = PET_POLICIES[random(0, PET_POLICIES.length - 1)];
    const furnished = Math.random() > 0.5;
    const gym = Math.random() > 0.4;
    const parking = Math.random() > 0.3;

    // Build address
    const streetNum = random(100, 9999);
    const streetNames = country === 'UK'
      ? ['High Street', 'Market Street', 'Station Road', 'Church Lane', 'Oxford Road', 'Cambridge Road', 'University Road', 'College Street']
      : country === 'CA'
      ? ['University Ave', 'College Street', 'King Street', 'Queen Street', 'Main Street', 'Campus Drive', 'Maple Road', 'Bay Street']
      : ['University Ave', 'College Ave', 'Main Street', 'Oak Street', 'Campus Drive', 'Student Lane', 'Academic Blvd', 'Park Ave'];
    const streetName = streetNames[random(0, streetNames.length - 1)];
    const address = country === 'UK'
      ? `${streetNum} ${streetName}, ${city}`
      : state
      ? `${streetNum} ${streetName}, ${city}, ${state}`
      : `${streetNum} ${streetName}, ${city}`;

    apartments.push(`  apt('${cleanKey}-${i + 1}', '${name.replace(/'/g, "\\'")}', '${address.replace(/'/g, "\\'")}', '${uniKey.replace(/'/g, "\\'")}', '${bedrooms}', '${bathrooms}', ${priceMin}, ${priceMax}, ${sqftMin}, ${sqftMax}, ${walkingMin}, ${bikingMin}, ${transitMin}, ${drivingMin}, ${rating}, ${reviewCount}, '${petPolicy}', '${campusSide}', ${furnished}, ${gym}, ${parking}, ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}),`);
  }

  return apartments.join('\n');
}

// Main data generation
console.log(`/**
 * COMPREHENSIVE APARTMENTS DATA
 * Auto-generated for all universities in US, UK, and Canada
 * 10 apartments per university = ~6,500 total apartments
 */

import { CampusSide } from '../universityData';

export interface ApartmentData {
  id: string;
  name: string;
  address: string;
  university: string;
  bedrooms: string;
  bathrooms: string;
  price_min: number;
  price_max: number;
  shared_price_min?: number;
  shared_price_max?: number;
  sqft_min: number;
  sqft_max: number;
  walking_minutes: number;
  biking_minutes: number;
  transit_minutes: number;
  driving_minutes: number;
  rating: number;
  review_count: number;
  pet_policy: string;
  campus_side: CampusSide;
  furnished: boolean;
  gym: boolean;
  parking: boolean;
  latitude: number;
  longitude: number;
  images?: string[];
  contact_website?: string;
}

// Helper function to create apartment data
function apt(
  id: string, name: string, address: string, university: string,
  bedrooms: string, bathrooms: string, price_min: number, price_max: number,
  sqft_min: number, sqft_max: number, walking_minutes: number, biking_minutes: number,
  transit_minutes: number, driving_minutes: number, rating: number, review_count: number,
  pet_policy: string, campus_side: CampusSide, furnished: boolean, gym: boolean,
  parking: boolean, lat: number, lng: number, website?: string
): ApartmentData {
  return {
    id, name, address, university, bedrooms, bathrooms, price_min, price_max,
    shared_price_min: Math.round(price_min * 0.55),
    shared_price_max: Math.round(price_max * 0.55),
    sqft_min, sqft_max, walking_minutes, biking_minutes, transit_minutes, driving_minutes,
    rating, review_count, pet_policy, campus_side, furnished, gym, parking,
    latitude: lat, longitude: lng, contact_website: website,
  };
}

// ============================================================================
// US APARTMENTS
// ============================================================================
`);

// This script would need to be run with actual university data
// For now, output the template structure
console.log(`export const US_APARTMENTS: ApartmentData[] = [
  // Generated apartments will go here
];

export const UK_APARTMENTS: ApartmentData[] = [
  // Generated apartments will go here
];

export const CA_APARTMENTS: ApartmentData[] = [
  // Generated apartments will go here
];

export const ALL_APARTMENTS: ApartmentData[] = [
  ...US_APARTMENTS,
  ...UK_APARTMENTS,
  ...CA_APARTMENTS,
];

export function getApartmentsForUniversity(university: string): ApartmentData[] {
  const normalizedSearch = university.toLowerCase().trim();
  return ALL_APARTMENTS.filter(apt => {
    const aptUni = apt.university.toLowerCase();
    return aptUni === normalizedSearch ||
           aptUni.includes(normalizedSearch) ||
           normalizedSearch.includes(aptUni);
  });
}
`);
