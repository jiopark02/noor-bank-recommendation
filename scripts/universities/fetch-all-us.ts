/**
 * Fetch all US universities from College Scorecard API using DEMO_KEY
 * Then generate SQL inserts
 */

import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'https://api.data.gov/ed/collegescorecard/v1/schools';
const API_KEY = 'DEMO_KEY';

const IVY_LEAGUE_IDS = new Set([166027, 130794, 186131, 190150, 215062, 217156, 182670, 190415]);

interface School {
  id: number;
  'school.name': string;
  'school.alias': string | null;
  'school.city': string;
  'school.state': string;
  'school.zip': string;
  'school.school_url': string | null;
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

async function fetchAllSchools(): Promise<School[]> {
  const fields = [
    'id', 'school.name', 'school.alias', 'school.city', 'school.state',
    'school.zip', 'school.school_url', 'school.main_campus',
    'school.degrees_awarded.predominant', 'school.ownership',
    'location.lat', 'location.lon', 'latest.student.size',
  ].join(',');

  const allSchools: School[] = [];
  let page = 0;
  const perPage = 100;
  let hasMore = true;

  console.log('Fetching US universities from College Scorecard API...');

  while (hasMore) {
    const url = `${API_BASE}?fields=${fields}&per_page=${perPage}&page=${page}&school.operating=1&api_key=${API_KEY}`;

    try {
      const response = await fetch(url);

      if (response.status === 429) {
        console.log('Rate limited, waiting 5 seconds...');
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      if (!response.ok) {
        console.error(`API error: ${response.status}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const data = await response.json();
      const schools = data.results as School[];

      if (!schools || schools.length === 0) {
        hasMore = false;
        continue;
      }

      allSchools.push(...schools);
      page++;

      if (page % 10 === 0) {
        console.log(`  Fetched ${allSchools.length} schools...`);
      }

      // Rate limiting - be nice to the API
      await new Promise(r => setTimeout(r, 100));
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return allSchools;
}

function generateInsertSQL(school: School): string {
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
  if (website && !website.startsWith('http')) {
    website = `https://${website}`;
  }

  return `INSERT INTO universities (id, name, short_name, city, state, country, zip_code, latitude, longitude, type, campus_type, sector, is_public, enrollment, website, aliases, source, source_id) VALUES (
  ${escapeSQL(`us-${state.toLowerCase()}-${id}`)},
  ${escapeSQL(name)},
  ${escapeSQL(shortName.trim() || name.substring(0, 50))},
  ${escapeSQL(school['school.city'])},
  ${escapeSQL(state)},
  'US',
  ${escapeSQL(school['school.zip'])},
  ${school['location.lat'] ?? 'NULL'},
  ${school['location.lon'] ?? 'NULL'},
  ${escapeSQL(type)},
  ${escapeSQL(school['school.main_campus'] === 1 ? 'main' : 'branch')},
  ${escapeSQL(sector)},
  ${ownership === 1},
  ${school['latest.student.size'] ?? 'NULL'},
  ${escapeSQL(website)},
  ${arrayToSQL(aliases)},
  'college_scorecard',
  ${escapeSQL(id.toString())}
) ON CONFLICT (id) DO NOTHING;`;
}

async function main() {
  const schools = await fetchAllSchools();
  console.log(`\nTotal US schools fetched: ${schools.length}`);

  // Generate SQL file
  const outputPath = path.join(__dirname, 'us-universities.sql');

  let sql = `-- US Universities from College Scorecard API (${schools.length} records)\n`;
  sql += `-- Generated: ${new Date().toISOString()}\n\n`;

  for (const school of schools) {
    sql += generateInsertSQL(school) + '\n';
  }

  fs.writeFileSync(outputPath, sql);
  console.log(`\n✅ SQL generated: ${outputPath}`);
  console.log(`File size: ${(sql.length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);
