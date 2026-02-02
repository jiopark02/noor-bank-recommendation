/**
 * Fetch REAL bank and apartment data from OpenStreetMap Overpass API
 * This gets actual locations, not generated fake data
 *
 * Run: npx tsx scripts/supabase/fetch-real-locations.ts
 */

import { createClient } from '@supabase/supabase-js';
import { ALL_UNIVERSITIES } from '../../src/lib/universities';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Major banks to look for
const BANK_NAMES = {
  US: ['Bank of America', 'Chase', 'Wells Fargo', 'Citibank', 'TD Bank', 'PNC', 'Capital One', 'US Bank', 'Regions', 'BB&T', 'SunTrust', 'Fifth Third'],
  UK: ['Barclays', 'HSBC', 'Lloyds', 'NatWest', 'Santander', 'TSB', 'Halifax', 'Nationwide'],
  CA: ['TD Canada Trust', 'RBC', 'Scotiabank', 'BMO', 'CIBC', 'National Bank', 'Desjardins'],
};

interface OSMElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function fetchFromOverpass(query: string): Promise<OSMElement[]> {
  try {
    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) {
      throw new Error('Overpass API error: ' + response.status);
    }

    const data = await response.json();
    return data.elements || [];
  } catch (error) {
    console.error('Fetch error:', error);
    return [];
  }
}

async function fetchBanksNearUniversity(uni: typeof ALL_UNIVERSITIES[0]): Promise<any[]> {
  const radiusMeters = 2000; // 2km radius

  // Query for banks near the university
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="bank"](around:${radiusMeters},${uni.latitude},${uni.longitude});
      way["amenity"="bank"](around:${radiusMeters},${uni.latitude},${uni.longitude});
    );
    out center;
  `;

  const elements = await fetchFromOverpass(query);
  const country = uni.country || 'US';
  const validBanks = BANK_NAMES[country as keyof typeof BANK_NAMES] || BANK_NAMES.US;

  return elements
    .filter(el => {
      const name = el.tags?.name || '';
      // Check if it's a major bank we recognize
      return validBanks.some(bank => name.toLowerCase().includes(bank.toLowerCase()));
    })
    .map(el => {
      const lat = el.lat || el.center?.lat || 0;
      const lon = el.lon || el.center?.lon || 0;
      const tags = el.tags || {};

      return {
        bank_name: tags.name || 'Unknown Bank',
        branch_name: tags['branch'] || tags['addr:street'] || null,
        address: formatAddress(tags),
        university_id: uni.id,
        university_short_name: uni.short_name,
        latitude: lat,
        longitude: lon,
        phone: tags.phone || tags['contact:phone'] || null,
        hours: tags.opening_hours || null,
        has_atm: tags.atm === 'yes' || true,
        source: 'openstreetmap',
        osm_id: el.type + '/' + el.id,
      };
    });
}

async function fetchApartmentsNearUniversity(uni: typeof ALL_UNIVERSITIES[0]): Promise<any[]> {
  const radiusMeters = 3000; // 3km radius for apartments

  // Query for apartments/residential buildings
  const query = `
    [out:json][timeout:30];
    (
      node["building"="apartments"](around:${radiusMeters},${uni.latitude},${uni.longitude});
      way["building"="apartments"](around:${radiusMeters},${uni.latitude},${uni.longitude});
      node["building"="residential"](around:${radiusMeters},${uni.latitude},${uni.longitude});
      way["building"="residential"](around:${radiusMeters},${uni.latitude},${uni.longitude});
      node["amenity"="student_accommodation"](around:${radiusMeters},${uni.latitude},${uni.longitude});
      way["amenity"="student_accommodation"](around:${radiusMeters},${uni.latitude},${uni.longitude});
    );
    out center;
  `;

  const elements = await fetchFromOverpass(query);

  // Filter to get buildings with names (actual apartment complexes, not random houses)
  const namedElements = elements.filter(el => el.tags?.name);

  // If we don't have enough named apartments, include some without names
  const apartments = namedElements.length >= 10
    ? namedElements.slice(0, 15)
    : [...namedElements, ...elements.filter(el => !el.tags?.name).slice(0, 15 - namedElements.length)];

  return apartments.slice(0, 15).map((el, index) => {
    const lat = el.lat || el.center?.lat || 0;
    const lon = el.lon || el.center?.lon || 0;
    const tags = el.tags || {};

    // Calculate approximate walking distance
    const distance = calculateDistance(uni.latitude, uni.longitude, lat, lon);
    const walkingMinutes = Math.round(distance / 80); // ~80m per minute walking

    return {
      name: tags.name || 'Apartment Complex ' + (index + 1),
      address: formatAddress(tags) || uni.city + ', ' + (uni.state || ''),
      university_id: uni.id,
      university_short_name: uni.short_name,
      latitude: lat,
      longitude: lon,
      walking_minutes: Math.min(walkingMinutes, 30),
      source: 'openstreetmap',
      osm_id: el.type + '/' + el.id,
    };
  });
}

function formatAddress(tags: Record<string, string>): string {
  const parts = [];
  if (tags['addr:housenumber']) parts.push(tags['addr:housenumber']);
  if (tags['addr:street']) parts.push(tags['addr:street']);
  if (tags['addr:city']) parts.push(tags['addr:city']);
  if (tags['addr:state']) parts.push(tags['addr:state']);
  if (tags['addr:postcode']) parts.push(tags['addr:postcode']);
  return parts.join(', ');
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Fetching REAL location data from OpenStreetMap...');
  console.log('Total universities: ' + ALL_UNIVERSITIES.length);
  console.log('');

  let totalBanks = 0;
  let totalApartments = 0;
  let processed = 0;

  for (const uni of ALL_UNIVERSITIES) {
    processed++;
    console.log('[' + processed + '/' + ALL_UNIVERSITIES.length + '] ' + uni.short_name + ' (' + uni.city + ')');

    try {
      // Fetch banks
      const banks = await fetchBanksNearUniversity(uni);
      if (banks.length > 0) {
        const { error } = await supabase
          .from('bank_branches')
          .upsert(banks, { onConflict: 'osm_id' });

        if (!error) {
          totalBanks += banks.length;
          console.log('  Banks: ' + banks.length);
        }
      }

      // Fetch apartments
      const apartments = await fetchApartmentsNearUniversity(uni);
      if (apartments.length > 0) {
        const { error } = await supabase
          .from('apartments')
          .upsert(apartments, { onConflict: 'osm_id' });

        if (!error) {
          totalApartments += apartments.length;
          console.log('  Apartments: ' + apartments.length);
        }
      }

      // Rate limiting - wait between requests to not overload Overpass API
      await sleep(1000);
    } catch (error) {
      console.error('  Error: ' + error);
    }
  }

  console.log('');
  console.log('=== DONE ===');
  console.log('Total banks inserted: ' + totalBanks);
  console.log('Total apartments inserted: ' + totalApartments);
}

main().catch(console.error);
