/**
 * Fetch US Universities from College Scorecard API
 *
 * College Scorecard API is free and provides data on all US postsecondary institutions
 * Documentation: https://collegescorecard.ed.gov/data/documentation/
 *
 * Run: npx tsx scripts/universities/fetch-us-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'https://api.data.gov/ed/collegescorecard/v1/schools';
const API_KEY = 'YOUR_API_KEY'; // Get free key from https://api.data.gov/signup/

// If no API key, use rate-limited public access
const USE_PUBLIC_ACCESS = !API_KEY || API_KEY === 'YOUR_API_KEY';

interface CollegeScorecardSchool {
  id: number;
  'school.name': string;
  'school.alias': string | null;
  'school.city': string;
  'school.state': string;
  'school.zip': string;
  'school.school_url': string;
  'school.main_campus': number;
  'school.branches': number;
  'school.degrees_awarded.predominant': number;
  'school.degrees_awarded.highest': number;
  'school.ownership': number; // 1=Public, 2=Private nonprofit, 3=Private for-profit
  'school.locale': number;
  'school.carnegie_basic': number | null;
  'school.carnegie_undergrad': number | null;
  'school.carnegie_size_setting': number | null;
  'location.lat': number | null;
  'location.lon': number | null;
  'latest.student.size': number | null;
  'latest.student.enrollment.undergrad_12_month': number | null;
  'latest.student.enrollment.grad_12_month': number | null;
  'latest.admissions.admission_rate.overall': number | null;
  'latest.admissions.sat_scores.average.overall': number | null;
  'latest.admissions.act_scores.midpoint.cumulative': number | null;
  'latest.cost.tuition.in_state': number | null;
  'latest.cost.tuition.out_of_state': number | null;
  'latest.cost.roomboard.oncampus': number | null;
}

interface ProcessedUniversity {
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  country: string;
  zip_code: string;
  latitude: number | null;
  longitude: number | null;
  type: string;
  campus_type: string;
  carnegie_class: string | null;
  sector: string;
  is_public: boolean;
  enrollment: number | null;
  undergraduate_enrollment: number | null;
  graduate_enrollment: number | null;
  acceptance_rate: number | null;
  sat_avg: number | null;
  act_avg: number | null;
  tuition_in_state: number | null;
  tuition_out_state: number | null;
  room_board: number | null;
  website: string | null;
  aliases: string[];
  source: string;
  source_id: string;
}

// Carnegie classification mapping
const CARNEGIE_TYPES: Record<number, string> = {
  1: 'Associate\'s Colleges',
  2: 'Associate\'s Colleges',
  3: 'Associate\'s Colleges',
  4: 'Associate\'s Colleges',
  5: 'Associate\'s Colleges',
  6: 'Associate\'s Colleges',
  7: 'Associate\'s Colleges',
  8: 'Associate\'s Colleges',
  9: 'Associate\'s Colleges',
  10: 'Baccalaureate Colleges',
  11: 'Baccalaureate Colleges',
  12: 'Baccalaureate Colleges',
  13: 'Baccalaureate Colleges',
  14: 'Master\'s Colleges',
  15: 'Master\'s Colleges',
  16: 'Master\'s Colleges',
  17: 'Doctoral Universities',
  18: 'Doctoral Universities',
  19: 'Doctoral Universities',
  20: 'Doctoral Universities',
  21: 'Doctoral Universities',
  22: 'Special Focus Institutions',
  23: 'Special Focus Institutions',
  24: 'Special Focus Institutions',
  25: 'Special Focus Institutions',
  26: 'Special Focus Institutions',
  27: 'Special Focus Institutions',
  28: 'Special Focus Institutions',
  29: 'Special Focus Institutions',
  30: 'Special Focus Institutions',
  31: 'Special Focus Institutions',
  32: 'Special Focus Institutions',
  33: 'Tribal Colleges',
};

// Ivy League IDs from College Scorecard
const IVY_LEAGUE_IDS = new Set([
  166027, // Harvard
  130794, // Yale
  186131, // Princeton
  190150, // Columbia
  215062, // Penn
  217156, // Brown
  182670, // Dartmouth
  190415, // Cornell
]);

function getInstitutionType(school: CollegeScorecardSchool): string {
  // Check for Ivy League
  if (IVY_LEAGUE_IDS.has(school.id)) {
    return 'ivy_league';
  }

  // Predominant degree: 1=Certificate, 2=Associate, 3=Bachelor's, 4=Graduate
  const predominant = school['school.degrees_awarded.predominant'];

  if (predominant === 2) {
    return 'community_college';
  }
  if (predominant === 1) {
    return 'technical_college';
  }
  return 'university';
}

function getSector(ownership: number): string {
  switch (ownership) {
    case 1: return 'public';
    case 2: return 'private_nonprofit';
    case 3: return 'private_forprofit';
    default: return 'public';
  }
}

function generateShortName(name: string): string {
  // Common abbreviation patterns
  const abbreviations: Record<string, string> = {
    'University of California': 'UC',
    'California State University': 'CSU',
    'State University of New York': 'SUNY',
    'City University of New York': 'CUNY',
    'University of Texas': 'UT',
    'Texas A&M University': 'TAMU',
    'University of North Carolina': 'UNC',
    'University of Massachusetts': 'UMass',
    'University of Wisconsin': 'UW',
  };

  for (const [pattern, abbrev] of Object.entries(abbreviations)) {
    if (name.includes(pattern)) {
      const rest = name.replace(pattern, '').trim().replace(/^-\s*/, '').replace(/^at\s*/i, '');
      if (rest) {
        return `${abbrev} ${rest}`;
      }
      return abbrev;
    }
  }

  // Remove common suffixes for short name
  let short = name
    .replace(/\s*-\s*Main Campus$/i, '')
    .replace(/\s*University$/i, '')
    .replace(/\s*College$/i, '')
    .replace(/\s*Institute$/i, '')
    .replace(/\s*of Technology$/i, ' Tech');

  // If name is already short, use it
  if (name.length <= 25) {
    return name;
  }

  return short.trim() || name;
}

function generateId(name: string, state: string, id: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);

  return `us-${state.toLowerCase()}-${slug}-${id}`;
}

function parseAliases(aliasString: string | null): string[] {
  if (!aliasString) return [];
  return aliasString
    .split(',')
    .map(a => a.trim())
    .filter(a => a.length > 0);
}

async function fetchPage(page: number, perPage: number = 100): Promise<CollegeScorecardSchool[]> {
  const fields = [
    'id',
    'school.name',
    'school.alias',
    'school.city',
    'school.state',
    'school.zip',
    'school.school_url',
    'school.main_campus',
    'school.branches',
    'school.degrees_awarded.predominant',
    'school.degrees_awarded.highest',
    'school.ownership',
    'school.locale',
    'school.carnegie_basic',
    'location.lat',
    'location.lon',
    'latest.student.size',
    'latest.student.enrollment.undergrad_12_month',
    'latest.student.enrollment.grad_12_month',
    'latest.admissions.admission_rate.overall',
    'latest.admissions.sat_scores.average.overall',
    'latest.admissions.act_scores.midpoint.cumulative',
    'latest.cost.tuition.in_state',
    'latest.cost.tuition.out_of_state',
    'latest.cost.roomboard.oncampus',
  ].join(',');

  const url = new URL(API_BASE);
  url.searchParams.set('fields', fields);
  url.searchParams.set('per_page', perPage.toString());
  url.searchParams.set('page', page.toString());
  // Only get operating schools (not closed)
  url.searchParams.set('school.operating', '1');

  if (!USE_PUBLIC_ACCESS) {
    url.searchParams.set('api_key', API_KEY);
  }

  console.log(`Fetching page ${page}...`);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.results;
}

async function fetchAllSchools(): Promise<CollegeScorecardSchool[]> {
  const allSchools: CollegeScorecardSchool[] = [];
  const perPage = 100;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const schools = await fetchPage(page, perPage);

      if (schools.length === 0) {
        hasMore = false;
      } else {
        allSchools.push(...schools);
        page++;

        // Rate limiting for public access
        if (USE_PUBLIC_ACCESS) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`  Fetched ${allSchools.length} schools so far...`);
      }
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error);
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  return allSchools;
}

function processSchool(school: CollegeScorecardSchool): ProcessedUniversity {
  const name = school['school.name'];
  const state = school['school.state'];
  const ownership = school['school.ownership'];
  const isMainCampus = school['school.main_campus'] === 1;

  return {
    id: generateId(name, state, school.id),
    name,
    short_name: generateShortName(name),
    city: school['school.city'],
    state,
    country: 'US',
    zip_code: school['school.zip'],
    latitude: school['location.lat'],
    longitude: school['location.lon'],
    type: getInstitutionType(school),
    campus_type: isMainCampus ? 'main' : 'branch',
    carnegie_class: school['school.carnegie_basic']
      ? CARNEGIE_TYPES[school['school.carnegie_basic']] || null
      : null,
    sector: getSector(ownership),
    is_public: ownership === 1,
    enrollment: school['latest.student.size'],
    undergraduate_enrollment: school['latest.student.enrollment.undergrad_12_month'],
    graduate_enrollment: school['latest.student.enrollment.grad_12_month'],
    acceptance_rate: school['latest.admissions.admission_rate.overall']
      ? Math.round(school['latest.admissions.admission_rate.overall'] * 10000) / 100
      : null,
    sat_avg: school['latest.admissions.sat_scores.average.overall'],
    act_avg: school['latest.admissions.act_scores.midpoint.cumulative'],
    tuition_in_state: school['latest.cost.tuition.in_state'],
    tuition_out_state: school['latest.cost.tuition.out_of_state'],
    room_board: school['latest.cost.roomboard.oncampus'],
    website: school['school.school_url']
      ? (school['school.school_url'].startsWith('http')
          ? school['school.school_url']
          : `https://${school['school.school_url']}`)
      : null,
    aliases: parseAliases(school['school.alias']),
    source: 'college_scorecard',
    source_id: school.id.toString(),
  };
}

async function main() {
  console.log('Fetching US universities from College Scorecard API...');
  console.log(USE_PUBLIC_ACCESS ? '(Using public access - may be slow)' : '(Using API key)');

  const schools = await fetchAllSchools();
  console.log(`\nTotal schools fetched: ${schools.length}`);

  const processed = schools.map(processSchool);

  // Count by type
  const typeCounts: Record<string, number> = {};
  for (const school of processed) {
    typeCounts[school.type] = (typeCounts[school.type] || 0) + 1;
  }
  console.log('\nBreakdown by type:');
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count}`);
  }

  // Save to JSON file
  const outputPath = path.join(__dirname, 'data', 'us-universities.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(processed, null, 2));
  console.log(`\nSaved to ${outputPath}`);

  return processed;
}

main().catch(console.error);

export { fetchAllSchools, processSchool };
export type { ProcessedUniversity };
