#!/usr/bin/env npx tsx
/**
 * Complete University Database Setup
 *
 * This script:
 * 1. Creates the universities table in Supabase
 * 2. Imports UK universities (~160)
 * 3. Imports Canada universities (~250)
 * 4. Imports US universities from College Scorecard API (~7,000)
 * 5. Shows final statistics
 *
 * Prerequisites:
 * - Add DATABASE_URL to .env.local (get from Supabase Dashboard → Settings → Database)
 *
 * Run: npx tsx scripts/universities/setup-all.ts
 */

import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

// Import data
import { ALL_UK_UNIVERSITIES } from './uk-universities-data';
import { ALL_CANADIAN_INSTITUTIONS } from './canada-universities-data';

// Configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const databaseUrl = process.env.DATABASE_URL;

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

// ============================================================================
// Step 1: Create Table
// ============================================================================
async function createTable(): Promise<boolean> {
  if (!databaseUrl) {
    console.log('❌ DATABASE_URL not set. Cannot create table.');
    console.log('\nAdd to .env.local:');
    console.log('DATABASE_URL=postgresql://postgres:[PASSWORD]@db.udkmzwscmotcyddptpko.supabase.co:5432/postgres');
    console.log('\nGet the password from: https://supabase.com/dashboard/project/udkmzwscmotcyddptpko/settings/database');
    return false;
  }

  console.log('\n📦 Step 1: Creating universities table...');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const client = await pool.connect();

    // Read schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    await client.query(schema);
    console.log('✅ Table created successfully!');

    client.release();
    await pool.end();
    return true;
  } catch (error: any) {
    console.error('❌ Error creating table:', error.message);
    await pool.end();

    if (error.message.includes('already exists')) {
      console.log('   Table already exists, continuing...');
      return true;
    }
    return false;
  }
}

// ============================================================================
// Step 2 & 3: Import UK and Canada Data
// ============================================================================
async function importLocalData(): Promise<{ uk: number; ca: number }> {
  console.log('\n📦 Step 2: Importing UK universities...');

  const supabase = createClient(supabaseUrl, supabaseKey);
  let ukCount = 0;
  let caCount = 0;

  // Import UK
  const ukRecords: UniversityRecord[] = ALL_UK_UNIVERSITIES.map(uni => ({
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

  for (let i = 0; i < ukRecords.length; i += 100) {
    const batch = ukRecords.slice(i, i + 100);
    const { error } = await supabase.from('universities').upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`   Error importing UK batch: ${error.message}`);
    } else {
      ukCount += batch.length;
    }
  }
  console.log(`✅ UK universities imported: ${ukCount}`);

  // Import Canada
  console.log('\n📦 Step 3: Importing Canada institutions...');

  const caRecords: UniversityRecord[] = ALL_CANADIAN_INSTITUTIONS.map(uni => ({
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

  for (let i = 0; i < caRecords.length; i += 100) {
    const batch = caRecords.slice(i, i + 100);
    const { error } = await supabase.from('universities').upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`   Error importing Canada batch: ${error.message}`);
    } else {
      caCount += batch.length;
    }
  }
  console.log(`✅ Canada institutions imported: ${caCount}`);

  return { uk: ukCount, ca: caCount };
}

// ============================================================================
// Step 4: Import US Data from College Scorecard API
// ============================================================================
async function importUSData(): Promise<number> {
  console.log('\n📦 Step 4: Importing US universities from College Scorecard API...');
  console.log('   This may take 5-10 minutes...');

  const supabase = createClient(supabaseUrl, supabaseKey);
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
    'location.lat',
    'location.lon',
    'latest.student.size',
  ].join(',');

  const IVY_LEAGUE_IDS = new Set([166027, 130794, 186131, 190150, 215062, 217156, 182670, 190415]);

  let page = 0;
  let totalImported = 0;
  let hasMore = true;
  const perPage = 100;

  while (hasMore) {
    const url = `${API_BASE}?fields=${fields}&per_page=${perPage}&page=${page}&school.operating=1`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`   API error: ${response.status}`);
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

        let type = 'university';
        if (IVY_LEAGUE_IDS.has(id)) {
          type = 'ivy_league';
        } else if (predominant === 2) {
          type = 'community_college';
        } else if (predominant === 1) {
          type = 'technical_college';
        }

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
          website: school['school.school_url']
            ? (school['school.school_url'].startsWith('http')
                ? school['school.school_url']
                : `https://${school['school.school_url']}`)
            : undefined,
          source: 'college_scorecard',
          source_id: id.toString(),
        };
      });

      // Import batch
      const { error } = await supabase.from('universities').upsert(records, { onConflict: 'id' });

      if (error) {
        console.error(`   Error importing page ${page + 1}: ${error.message}`);
      } else {
        totalImported += records.length;
        if (page % 10 === 0) {
          console.log(`   Imported ${totalImported} US institutions...`);
        }
      }

      page++;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (error: any) {
      console.error(`   Error fetching page ${page + 1}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`✅ US universities imported: ${totalImported}`);
  return totalImported;
}

// ============================================================================
// Step 5: Show Statistics
// ============================================================================
async function showStatistics() {
  console.log('\n📊 Step 5: Final Statistics');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Total count
  const { count: totalCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true });

  // By country
  const { count: usCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'US');

  const { count: ukCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'UK');

  const { count: caCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'CA');

  // By type
  const { count: univCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'university');

  const { count: ccCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'community_college');

  const { count: ivyCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'ivy_league');

  const { count: russellCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'russell_group');

  console.log(`\n🎓 Total Institutions: ${totalCount?.toLocaleString()}`);
  console.log(`\n📍 By Country:`);
  console.log(`   🇺🇸 US:     ${usCount?.toLocaleString()}`);
  console.log(`   🇬🇧 UK:     ${ukCount?.toLocaleString()}`);
  console.log(`   🇨🇦 Canada: ${caCount?.toLocaleString()}`);
  console.log(`\n📚 By Type:`);
  console.log(`   Universities:        ${univCount?.toLocaleString()}`);
  console.log(`   Community Colleges:  ${ccCount?.toLocaleString()}`);
  console.log(`   Ivy League:          ${ivyCount?.toLocaleString()}`);
  console.log(`   Russell Group:       ${russellCount?.toLocaleString()}`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('    🎓 UNIVERSITY DATABASE SETUP');
  console.log('    Comprehensive database of 7,000+ institutions');
  console.log('═══════════════════════════════════════════════════════════════');

  // Step 1: Create table
  const tableCreated = await createTable();
  if (!tableCreated) {
    process.exit(1);
  }

  // Steps 2-3: Import UK and Canada
  const { uk, ca } = await importLocalData();

  // Step 4: Import US
  const us = await importUSData();

  // Step 5: Statistics
  await showStatistics();

  console.log('\n✅ Setup Complete!');
  console.log(`   Total imported: ${(uk + ca + us).toLocaleString()} institutions`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
