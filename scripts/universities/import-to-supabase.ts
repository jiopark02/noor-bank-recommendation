/**
 * Import universities to Supabase
 *
 * This script imports all university data to Supabase.
 * Run: npx tsx scripts/universities/import-to-supabase.ts
 *
 * Prerequisites:
 * 1. Run the schema.sql in Supabase SQL Editor first
 * 2. Set SUPABASE_SERVICE_ROLE_KEY in .env.local (for admin access)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

// Import data
import { ALL_UK_UNIVERSITIES } from './uk-universities-data';
import { ALL_CANADIAN_INSTITUTIONS } from './canada-universities-data';

// Supabase connection
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface UniversityRecord {
  id: string;
  name: string;
  short_name: string;
  system_name?: string;
  city: string;
  state: string;
  country: string;
  zip_code?: string;
  latitude?: number;
  longitude?: number;
  type: string;
  campus_type: string;
  sector?: string;
  is_public: boolean;
  enrollment?: number;
  international_students?: number;
  website?: string;
  aliases?: string[];
  source: string;
  source_id: string;
}

async function createTable() {
  console.log('Creating universities table...');

  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS universities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        system_name TEXT,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        country TEXT NOT NULL,
        zip_code TEXT,
        address TEXT,
        latitude DECIMAL(10, 7),
        longitude DECIMAL(10, 7),
        type TEXT NOT NULL,
        campus_type TEXT DEFAULT 'main',
        carnegie_class TEXT,
        sector TEXT,
        is_public BOOLEAN DEFAULT true,
        enrollment INTEGER,
        undergraduate_enrollment INTEGER,
        graduate_enrollment INTEGER,
        international_students INTEGER,
        international_percentage DECIMAL(5, 2),
        acceptance_rate DECIMAL(5, 2),
        sat_avg INTEGER,
        act_avg INTEGER,
        tuition_in_state INTEGER,
        tuition_out_state INTEGER,
        tuition_international INTEGER,
        room_board INTEGER,
        primary_color TEXT,
        secondary_color TEXT,
        logo_url TEXT,
        website TEXT,
        phone TEXT,
        aliases TEXT[],
        keywords TEXT[],
        source TEXT,
        source_id TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_universities_country ON universities(country);
      CREATE INDEX IF NOT EXISTS idx_universities_state ON universities(state);
      CREATE INDEX IF NOT EXISTS idx_universities_type ON universities(type);
      CREATE INDEX IF NOT EXISTS idx_universities_name ON universities(name);
    `
  });

  if (error) {
    console.log('Note: Table may already exist or RPC not available. Continuing...');
  }
}

async function clearTable() {
  console.log('Clearing existing data...');
  const { error } = await supabase.from('universities').delete().neq('id', '');
  if (error) {
    console.log('Note: Could not clear table (may not exist yet)');
  }
}

async function importBatch(records: UniversityRecord[], batchSize: number = 100): Promise<number> {
  let imported = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { error } = await supabase
      .from('universities')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`Error importing batch ${i / batchSize + 1}:`, error.message);
    } else {
      imported += batch.length;
      console.log(`  Imported ${imported}/${records.length} records...`);
    }
  }

  return imported;
}

async function importUKData() {
  console.log('\n=== Importing UK Universities ===');

  const records: UniversityRecord[] = ALL_UK_UNIVERSITIES.map(uni => ({
    id: uni.id,
    name: uni.name,
    short_name: uni.short_name,
    city: uni.city,
    state: uni.state,
    country: uni.country,
    zip_code: uni.zip_code,
    latitude: uni.latitude,
    longitude: uni.longitude,
    type: uni.type,
    campus_type: uni.campus_type,
    sector: uni.sector,
    is_public: uni.is_public,
    enrollment: uni.enrollment,
    international_students: uni.international_students,
    website: uni.website,
    aliases: uni.aliases,
    source: uni.source,
    source_id: uni.source_id,
  }));

  const count = await importBatch(records);
  console.log(`UK import complete: ${count} records`);
  return count;
}

async function importCanadaData() {
  console.log('\n=== Importing Canada Institutions ===');

  const records: UniversityRecord[] = ALL_CANADIAN_INSTITUTIONS.map(uni => ({
    id: uni.id,
    name: uni.name,
    short_name: uni.short_name,
    city: uni.city,
    state: uni.state,
    country: uni.country,
    zip_code: uni.zip_code,
    latitude: uni.latitude,
    longitude: uni.longitude,
    type: uni.type,
    campus_type: uni.campus_type,
    sector: uni.sector,
    is_public: uni.is_public,
    enrollment: uni.enrollment,
    international_students: uni.international_students,
    website: uni.website,
    aliases: uni.aliases,
    source: uni.source,
    source_id: uni.source_id,
  }));

  const count = await importBatch(records);
  console.log(`Canada import complete: ${count} records`);
  return count;
}

async function importUSDataFromAPI() {
  console.log('\n=== Fetching US Data from College Scorecard API ===');
  console.log('This may take a while...');

  const API_BASE = 'https://api.data.gov/ed/collegescorecard/v1/schools';

  const fields = [
    'id',
    'school.name',
    'school.alias',
    'school.city',
    'school.state',
    'school.zip',
    'school.school_url',
    'school.main_campus',
    'school.degrees_awarded.predominant',
    'school.ownership',
    'school.carnegie_basic',
    'location.lat',
    'location.lon',
    'latest.student.size',
    'latest.student.enrollment.undergrad_12_month',
    'latest.student.enrollment.grad_12_month',
    'latest.admissions.admission_rate.overall',
    'latest.cost.tuition.in_state',
    'latest.cost.tuition.out_of_state',
  ].join(',');

  let page = 0;
  let totalImported = 0;
  let hasMore = true;
  const perPage = 100;

  // Ivy League IDs
  const IVY_LEAGUE_IDS = new Set([166027, 130794, 186131, 190150, 215062, 217156, 182670, 190415]);

  while (hasMore) {
    const url = `${API_BASE}?fields=${fields}&per_page=${perPage}&page=${page}&school.operating=1`;

    try {
      console.log(`  Fetching page ${page + 1}...`);
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      const schools = data.results;

      if (!schools || schools.length === 0) {
        hasMore = false;
        continue;
      }

      // Transform to our format
      const records: UniversityRecord[] = schools.map((school: any) => {
        const name = school['school.name'] || '';
        const state = school['school.state'] || '';
        const id = school.id;
        const ownership = school['school.ownership'] || 1;
        const predominant = school['school.degrees_awarded.predominant'] || 0;

        // Determine type
        let type = 'university';
        if (IVY_LEAGUE_IDS.has(id)) {
          type = 'ivy_league';
        } else if (predominant === 2) {
          type = 'community_college';
        } else if (predominant === 1) {
          type = 'technical_college';
        }

        // Generate short name
        let shortName = name
          .replace(/University of California,?\s*/i, 'UC ')
          .replace(/California State University,?\s*/i, 'CSU ')
          .replace(/State University of New York\s*/i, 'SUNY ')
          .replace(/University of Texas at\s*/i, 'UT ')
          .replace(/\s*-\s*Main Campus$/i, '')
          .substring(0, 50);

        return {
          id: `us-${state.toLowerCase()}-${id}`,
          name: name,
          short_name: shortName.trim() || name.substring(0, 50),
          city: school['school.city'] || '',
          state: state,
          country: 'US',
          zip_code: school['school.zip'] || '',
          latitude: school['location.lat'],
          longitude: school['location.lon'],
          type: type,
          campus_type: school['school.main_campus'] === 1 ? 'main' : 'branch',
          sector: ownership === 1 ? 'public' : ownership === 2 ? 'private_nonprofit' : 'private_forprofit',
          is_public: ownership === 1,
          enrollment: school['latest.student.size'],
          aliases: school['school.alias'] ? school['school.alias'].split(',').map((a: string) => a.trim()) : [],
          website: school['school.school_url'] ? (school['school.school_url'].startsWith('http') ? school['school.school_url'] : `https://${school['school.school_url']}`) : null,
          source: 'college_scorecard',
          source_id: id.toString(),
        };
      });

      // Import batch
      const { error } = await supabase
        .from('universities')
        .upsert(records, { onConflict: 'id' });

      if (error) {
        console.error(`  Error importing page ${page + 1}:`, error.message);
      } else {
        totalImported += records.length;
        console.log(`  Total imported: ${totalImported}`);
      }

      page++;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`  Error fetching page ${page + 1}:`, error);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`US import complete: ${totalImported} records`);
  return totalImported;
}

async function getStats() {
  console.log('\n=== Database Statistics ===');

  const { data: countData, error: countError } = await supabase
    .from('universities')
    .select('country', { count: 'exact' });

  if (countError) {
    console.error('Error getting stats:', countError.message);
    return;
  }

  // Get counts by country
  const { data: usCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'US');

  const { data: ukCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'UK');

  const { data: caCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'CA');

  console.log(`  US: ${usCount} institutions`);
  console.log(`  UK: ${ukCount} institutions`);
  console.log(`  CA: ${caCount} institutions`);
}

async function main() {
  console.log('==============================================');
  console.log('University Database Import Script');
  console.log('==============================================');

  try {
    // Test connection
    const { data, error } = await supabase.from('universities').select('id').limit(1);
    if (error && error.code === '42P01') {
      console.log('Table does not exist. Please run schema.sql in Supabase SQL Editor first.');
      console.log('Schema file: scripts/universities/schema.sql');
      process.exit(1);
    }

    // Import UK and Canada data (from local files)
    await importUKData();
    await importCanadaData();

    // Import US data from API
    console.log('\nDo you want to import US data from College Scorecard API?');
    console.log('This will fetch ~7,000 institutions and may take 10-15 minutes.');
    console.log('Run with --include-us flag to import US data.\n');

    if (process.argv.includes('--include-us')) {
      await importUSDataFromAPI();
    }

    // Show final stats
    await getStats();

    console.log('\n=== Import Complete ===');

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

main();
