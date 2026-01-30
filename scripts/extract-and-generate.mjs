#!/usr/bin/env node
/**
 * Extract all universities and generate comprehensive apartment data
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src', 'lib', 'universities');

// Apartment templates
const US_NAMES = ['The Residences', 'Campus Village', 'University Apartments', 'College Commons', 'The Heights', 'Park Place', 'Student Living', 'Metro Apartments', 'City Center', 'Collegiate Housing', 'Summit Suites', 'Plaza Apartments', 'Vista Living', 'The Lofts', 'Gateway Apartments'];
const UK_NAMES = ['Student House', 'University Halls', 'Campus Lodge', 'The Residence', 'College Court', 'City Rooms', 'Student Village', 'The Studios', 'Academic House', 'Scholar House', 'Trinity Court', 'Crown Place', 'Castle View', 'Garden Court', 'The Quadrant'];
const CA_NAMES = ['Campus Residence', 'University Suites', 'Student Housing', 'College Living', 'The Commons', 'Maple House', 'Academic Residence', 'Campus Place', 'The Towers', 'University Village', 'Scholar Suites', 'Northern Residence', 'Lakeside Living', 'Cedar Hall', 'Oak Residence'];

const CAMPUS_SIDES = ['north', 'south', 'east', 'west', 'center'];
const PET_POLICIES = ['No pets', 'Cats only', 'Cats allowed', 'Small pets', 'Pets welcome'];
const BEDROOMS = ['Studio', 'Studio - 1BR', '1BR', '1BR - 2BR', 'Studio - 2BR', '2BR - 3BR', '1BR - 3BR'];
const US_STREETS = ['University Ave', 'College Ave', 'Main St', 'Oak St', 'Campus Dr', 'Student Ln', 'Academic Blvd', 'Park Ave', 'Elm St', 'Cedar Rd'];
const UK_STREETS = ['High Street', 'Market Street', 'Station Road', 'Church Lane', 'Oxford Road', 'Cambridge Road', 'University Road', 'College Street'];
const CA_STREETS = ['University Ave', 'College Street', 'King Street', 'Queen Street', 'Main Street', 'Campus Drive', 'Maple Road', 'Bay Street'];

const EXPENSIVE_US = ['New York', 'San Francisco', 'Los Angeles', 'Boston', 'Washington', 'Seattle', 'San Jose', 'Palo Alto', 'Cambridge', 'Santa Monica', 'Berkeley'];
const MODERATE_US = ['Chicago', 'Philadelphia', 'San Diego', 'Denver', 'Austin', 'Miami', 'Atlanta', 'Portland', 'Minneapolis', 'Dallas', 'Houston'];
const EXPENSIVE_UK = ['London'];
const MODERATE_UK = ['Manchester', 'Edinburgh', 'Bristol', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool', 'Oxford', 'Cambridge'];
const EXPENSIVE_CA = ['Toronto', 'Vancouver'];
const MODERATE_CA = ['Calgary', 'Ottawa', 'Montreal', 'Edmonton'];

function random(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max, decimals = 4) { return parseFloat((Math.random() * (max - min) + min).toFixed(decimals)); }

function getPriceRange(country, city) {
  if (country === 'US') {
    if (EXPENSIVE_US.some(c => city?.includes(c))) return { min: 1800, max: 4500 };
    if (MODERATE_US.some(c => city?.includes(c))) return { min: 1200, max: 2800 };
    return { min: 700, max: 1800 };
  } else if (country === 'UK') {
    if (EXPENSIVE_UK.some(c => city?.includes(c))) return { min: 1200, max: 2800 };
    if (MODERATE_UK.some(c => city?.includes(c))) return { min: 600, max: 1400 };
    return { min: 400, max: 900 };
  } else {
    if (EXPENSIVE_CA.some(c => city?.includes(c))) return { min: 1600, max: 3500 };
    if (MODERATE_CA.some(c => city?.includes(c))) return { min: 1000, max: 2200 };
    return { min: 600, max: 1400 };
  }
}

function generateCoords(lat, lng, index) {
  const angle = (index / 10) * 2 * Math.PI + randomFloat(-0.3, 0.3);
  const distance = randomFloat(0.005, 0.025);
  return { lat: lat + distance * Math.cos(angle), lng: lng + distance * Math.sin(angle) };
}

function extractUniversities(content, country) {
  const unis = [];
  // Match university objects with coordinates
  const regex = /\{\s*id:\s*'([^']+)'[^}]*?short_name:\s*'([^']+)'[^}]*?city:\s*'([^']+)'[^}]*?(?:state:\s*'([^']+)'[^}]*?)?latitude:\s*([\d.-]+)[^}]*?longitude:\s*([\d.-]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    unis.push({
      id: match[1],
      short_name: match[2],
      city: match[3],
      state: match[4] || '',
      latitude: parseFloat(match[5]),
      longitude: parseFloat(match[6]),
      country
    });
  }
  return unis;
}

function generateApartments(unis, country) {
  const names = country === 'US' ? US_NAMES : country === 'UK' ? UK_NAMES : CA_NAMES;
  const streets = country === 'US' ? US_STREETS : country === 'UK' ? UK_STREETS : CA_STREETS;
  const apartments = [];

  for (const u of unis) {
    if (!u.latitude || !u.longitude) continue;
    const cleanId = u.id.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 25);
    const priceRange = getPriceRange(country, u.city);
    const uniRef = u.short_name || u.id;

    for (let i = 0; i < 10; i++) {
      const name = names[i % names.length];
      const coords = generateCoords(u.latitude, u.longitude, i);
      const streetNum = random(100, 9999);
      const street = streets[random(0, streets.length - 1)];
      const address = u.state ? `${streetNum} ${street}, ${u.city}, ${u.state}` : `${streetNum} ${street}, ${u.city}`;
      const priceMin = Math.max(400, priceRange.min + random(-200, 200));
      const priceMax = Math.max(priceMin + 400, priceRange.max + random(-300, 300));
      const walkingMin = random(3, 25);

      apartments.push({
        id: `${cleanId}-${i + 1}`,
        name,
        address,
        university: uniRef,
        bedrooms: BEDROOMS[random(0, BEDROOMS.length - 1)],
        bathrooms: random(1, 2) === 1 ? '1' : '1-2',
        price_min: priceMin,
        price_max: priceMax,
        sqft_min: random(350, 600),
        sqft_max: random(700, 1200),
        walking_minutes: walkingMin,
        biking_minutes: Math.max(1, Math.floor(walkingMin / 3)),
        transit_minutes: walkingMin + random(2, 8),
        driving_minutes: Math.max(2, Math.floor(walkingMin / 4)),
        rating: randomFloat(3.8, 4.9, 1),
        review_count: random(50, 400),
        pet_policy: PET_POLICIES[random(0, PET_POLICIES.length - 1)],
        campus_side: CAMPUS_SIDES[i % 5],
        furnished: Math.random() > 0.5,
        gym: Math.random() > 0.4,
        parking: Math.random() > 0.3,
        latitude: parseFloat(coords.lat.toFixed(6)),
        longitude: parseFloat(coords.lng.toFixed(6)),
      });
    }
  }
  return apartments;
}

// Read and extract all universities
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts') && f !== 'types.ts');
let allUs = [], allUk = [], allCa = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(srcDir, file), 'utf8');

  if (file.includes('uk') || file.toLowerCase().includes('uk')) {
    allUk.push(...extractUniversities(content, 'UK'));
  } else if (file.includes('canada') || file.toLowerCase().includes('canada')) {
    allCa.push(...extractUniversities(content, 'CA'));
  } else {
    allUs.push(...extractUniversities(content, 'US'));
  }
}

// Dedupe by id
const dedupeById = (arr) => [...new Map(arr.map(u => [u.id, u])).values()];
allUs = dedupeById(allUs);
allUk = dedupeById(allUk);
allCa = dedupeById(allCa);

console.error(`Found: US=${allUs.length}, UK=${allUk.length}, CA=${allCa.length}`);

// Generate apartments
const usApts = generateApartments(allUs, 'US');
const ukApts = generateApartments(allUk, 'UK');
const caApts = generateApartments(allCa, 'CA');

// Output file
console.log(`/**
 * COMPREHENSIVE APARTMENTS DATA
 * Auto-generated: ${new Date().toISOString()}
 * US Universities: ${allUs.length} (${usApts.length} apartments)
 * UK Universities: ${allUk.length} (${ukApts.length} apartments)
 * CA Universities: ${allCa.length} (${caApts.length} apartments)
 * Total: ${usApts.length + ukApts.length + caApts.length} apartments
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

// ============================================================================
// US APARTMENTS (${usApts.length})
// ============================================================================
export const US_APARTMENTS: ApartmentData[] = ${JSON.stringify(usApts, null, 2)};

// ============================================================================
// UK APARTMENTS (${ukApts.length})
// ============================================================================
export const UK_APARTMENTS: ApartmentData[] = ${JSON.stringify(ukApts, null, 2)};

// ============================================================================
// CANADA APARTMENTS (${caApts.length})
// ============================================================================
export const CA_APARTMENTS: ApartmentData[] = ${JSON.stringify(caApts, null, 2)};

// ============================================================================
// ALL APARTMENTS
// ============================================================================
export const ALL_APARTMENTS: ApartmentData[] = [
  ...US_APARTMENTS,
  ...UK_APARTMENTS,
  ...CA_APARTMENTS,
];

/**
 * Get apartments for a specific university
 */
export function getApartmentsForUniversity(university: string): ApartmentData[] {
  const normalizedSearch = university.toLowerCase().trim();
  return ALL_APARTMENTS.filter(apt => {
    const aptUni = apt.university.toLowerCase();
    return aptUni === normalizedSearch ||
           aptUni.includes(normalizedSearch) ||
           normalizedSearch.includes(aptUni);
  });
}

/**
 * Get combined apartments (for backwards compatibility)
 */
export function getCombinedApartments(): ApartmentData[] {
  return ALL_APARTMENTS;
}
`);
