/**
 * Fetch US universities in parallel by state
 * This bypasses rate limits by making requests for each state separately
 */

import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'https://api.data.gov/ed/collegescorecard/v1/schools';
const API_KEY = 'DEMO_KEY';
const IVY_LEAGUE_IDS = new Set([166027, 130794, 186131, 190150, 215062, 217156, 182670, 190415]);

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
];

interface School {
  id: number;
  'school.name': string;
  'school.alias'?: string;
  'school.city': string;
  'school.state': string;
  'school.zip': string;
  'school.school_url'?: string;
  'school.main_campus': number;
  'school.degrees_awarded.predominant': number;
  'school.ownership': number;
  'location.lat': number | null;
  'location.lon': number | null;
  'latest.student.size': number | null;
}

function escapeSQL(str: string | undefined | null): string {
  if (!str) return 'NULL';
  return `'${str.replace(/'/g, "''")}'`;
}

function arrayToSQL(arr: string[] | undefined | null): string {
  if (!arr || arr.length === 0) return 'NULL';
  const escaped = arr.map(s => s.replace(/'/g, "''")).join("','");
  return `ARRAY['${escaped}']`;
}

function generateInsert(school: School): string {
  const name = school['school.name'] || '';
  const state = school['school.state'] || '';
  const id = school.id;
  const ownership = school['school.ownership'] || 1;
  const predominant = school['school.degrees_awarded.predominant'] || 0;

  let type = 'university';
  if (IVY_LEAGUE_IDS.has(id)) type = 'ivy_league';
  else if (predominant === 2) type = 'community_college';
  else if (predominant === 1) type = 'technical_college';

  let shortName = name
    .replace(/University of California,?\s*/i, 'UC ')
    .replace(/California State University,?\s*/i, 'CSU ')
    .replace(/State University of New York\s*/i, 'SUNY ')
    .replace(/\s*-\s*Main Campus$/i, '')
    .substring(0, 50);

  const sector = ownership === 1 ? 'public' : ownership === 2 ? 'private_nonprofit' : 'private_forprofit';
  const aliases = school['school.alias']?.split(',').map(a => a.trim()).filter(a => a) || null;

  let website = school['school.school_url'];
  if (website && !website.startsWith('http')) website = `https://${website}`;

  return `INSERT INTO universities (id, name, short_name, city, state, country, zip_code, latitude, longitude, type, campus_type, sector, is_public, enrollment, website, aliases, source, source_id) VALUES (${escapeSQL(`us-${state.toLowerCase()}-${id}`)}, ${escapeSQL(name)}, ${escapeSQL(shortName.trim() || name.substring(0, 50))}, ${escapeSQL(school['school.city'])}, ${escapeSQL(state)}, 'US', ${escapeSQL(school['school.zip'])}, ${school['location.lat'] ?? 'NULL'}, ${school['location.lon'] ?? 'NULL'}, ${escapeSQL(type)}, ${escapeSQL(school['school.main_campus'] === 1 ? 'main' : 'branch')}, ${escapeSQL(sector)}, ${ownership === 1}, ${school['latest.student.size'] ?? 'NULL'}, ${escapeSQL(website)}, ${arrayToSQL(aliases)}, 'college_scorecard', ${escapeSQL(id.toString())}) ON CONFLICT (id) DO NOTHING;`;
}

async function fetchStateSchools(state: string): Promise<School[]> {
  const fields = 'id,school.name,school.alias,school.city,school.state,school.zip,school.school_url,school.main_campus,school.degrees_awarded.predominant,school.ownership,location.lat,location.lon,latest.student.size';

  const schools: School[] = [];
  let page = 0;
  const perPage = 100;

  while (true) {
    const url = `${API_BASE}?fields=${fields}&per_page=${perPage}&page=${page}&school.state=${state}&school.operating=1&api_key=${API_KEY}`;

    try {
      const response = await fetch(url);

      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!response.ok) {
        break;
      }

      const data = await response.json();
      const results = data.results as School[];

      if (!results || results.length === 0) break;

      schools.push(...results);
      page++;

      if (results.length < perPage) break;

      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      break;
    }
  }

  return schools;
}

async function main() {
  console.log('Fetching US universities by state...\n');

  const allSchools: School[] = [];
  const results: { state: string; count: number }[] = [];

  // Process states in batches to avoid overwhelming the API
  const batchSize = 3;
  for (let i = 0; i < US_STATES.length; i += batchSize) {
    const batch = US_STATES.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (state) => {
        const schools = await fetchStateSchools(state);
        return { state, schools };
      })
    );

    for (const { state, schools } of batchResults) {
      allSchools.push(...schools);
      results.push({ state, count: schools.length });
      console.log(`  ${state}: ${schools.length} schools (Total: ${allSchools.length})`);
    }

    // Wait between batches
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\nTotal US schools: ${allSchools.length}`);

  // Generate SQL
  const outputPath = path.join(__dirname, 'us-universities.sql');
  let sql = `-- US Universities (${allSchools.length} records)\n-- Generated: ${new Date().toISOString()}\n\n`;

  for (const school of allSchools) {
    sql += generateInsert(school) + '\n';
  }

  fs.writeFileSync(outputPath, sql);
  console.log(`\nSQL saved to: ${outputPath}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);
