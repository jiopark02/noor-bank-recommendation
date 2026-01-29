/**
 * Setup universities using Supabase REST API
 * Works without DATABASE_URL - uses Supabase anon key
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

import { ALL_UK_UNIVERSITIES } from './uk-universities-data';
import { ALL_CANADIAN_INSTITUTIONS } from './canada-universities-data';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

interface UniversityRecord {
  id: string;
  name: string;
  short_name: string;
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

// Ivy League IDs
const IVY_LEAGUE_IDS = new Set([166027, 130794, 186131, 190150, 215062, 217156, 182670, 190415]);

async function checkTable(): Promise<boolean> {
  const { error } = await supabase.from('universities').select('id').limit(1);
  return !error || error.code !== '42P01';
}

async function importBatch(records: UniversityRecord[], label: string): Promise<number> {
  let imported = 0;
  const batchSize = 50;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { error } = await supabase.from('universities').upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`  ${label} batch ${Math.floor(i/batchSize)+1} error:`, error.message);
      if (error.code === '42P01') {
        console.error('\n❌ Table does not exist. Please create it first.');
        return imported;
      }
    } else {
      imported += batch.length;
      if (imported % 500 === 0 || imported === records.length) {
        console.log(`  ${label}: ${imported}/${records.length}`);
      }
    }
  }

  return imported;
}

async function importUK(): Promise<number> {
  console.log('\n🇬🇧 Importing UK Universities...');

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

  return importBatch(records, 'UK');
}

async function importCanada(): Promise<number> {
  console.log('\n🇨🇦 Importing Canada Institutions...');

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

  return importBatch(records, 'Canada');
}

async function importUS(): Promise<number> {
  console.log('\n🇺🇸 Importing US Universities from College Scorecard API...');
  console.log('  This will fetch ~7,000 institutions...');

  const API_BASE = 'https://api.data.gov/ed/collegescorecard/v1/schools';
  const fields = [
    'id', 'school.name', 'school.alias', 'school.city', 'school.state',
    'school.zip', 'school.school_url', 'school.main_campus',
    'school.degrees_awarded.predominant', 'school.ownership',
    'location.lat', 'location.lon', 'latest.student.size',
  ].join(',');

  let page = 0;
  let totalImported = 0;
  let hasMore = true;
  const perPage = 100;
  const allRecords: UniversityRecord[] = [];

  // Fetch all data first
  console.log('  Fetching data from API...');
  while (hasMore) {
    const url = `${API_BASE}?fields=${fields}&per_page=${perPage}&page=${page}&school.operating=1`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`  API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      const schools = data.results;

      if (!schools || schools.length === 0) {
        hasMore = false;
        continue;
      }

      for (const school of schools) {
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

        allRecords.push({
          id: `us-${state.toLowerCase()}-${id}`,
          name,
          short_name: shortName.trim() || name.substring(0, 50),
          city: school['school.city'] || '',
          state,
          country: 'US',
          zip_code: school['school.zip'] || '',
          latitude: school['location.lat'],
          longitude: school['location.lon'],
          type,
          campus_type: school['school.main_campus'] === 1 ? 'main' : 'branch',
          sector: ownership === 1 ? 'public' : ownership === 2 ? 'private_nonprofit' : 'private_forprofit',
          is_public: ownership === 1,
          enrollment: school['latest.student.size'],
          aliases: school['school.alias']?.split(',').map((a: string) => a.trim()) || [],
          website: school['school.school_url']
            ? (school['school.school_url'].startsWith('http') ? school['school.school_url'] : `https://${school['school.school_url']}`)
            : undefined,
          source: 'college_scorecard',
          source_id: id.toString(),
        });
      }

      page++;
      if (page % 20 === 0) {
        console.log(`  Fetched ${allRecords.length} records...`);
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (error: any) {
      console.error(`  Fetch error: ${error.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`  Total fetched: ${allRecords.length}`);
  console.log('  Inserting into database...');

  totalImported = await importBatch(allRecords, 'US');
  return totalImported;
}

async function showStats() {
  console.log('\n📊 Database Statistics:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const { count: total } = await supabase.from('universities').select('*', { count: 'exact', head: true });
  const { count: us } = await supabase.from('universities').select('*', { count: 'exact', head: true }).eq('country', 'US');
  const { count: uk } = await supabase.from('universities').select('*', { count: 'exact', head: true }).eq('country', 'UK');
  const { count: ca } = await supabase.from('universities').select('*', { count: 'exact', head: true }).eq('country', 'CA');

  console.log(`  🎓 Total: ${total?.toLocaleString()}`);
  console.log(`  🇺🇸 US: ${us?.toLocaleString()}`);
  console.log(`  🇬🇧 UK: ${uk?.toLocaleString()}`);
  console.log(`  🇨🇦 Canada: ${ca?.toLocaleString()}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🎓 University Database Import');
  console.log('═══════════════════════════════════════════════════════');

  // Check if table exists
  const tableExists = await checkTable();
  if (!tableExists) {
    console.log('\n❌ universities 테이블이 없습니다.');
    console.log('\n다음 SQL을 Supabase SQL Editor에서 실행해주세요:');
    console.log('https://supabase.com/dashboard/project/udkmzwscmotcyddptpko/sql/new\n');
    console.log(`
CREATE TABLE universities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  country TEXT NOT NULL,
  zip_code TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  type TEXT NOT NULL,
  campus_type TEXT DEFAULT 'main',
  sector TEXT,
  is_public BOOLEAN DEFAULT true,
  enrollment INTEGER,
  international_students INTEGER,
  website TEXT,
  aliases TEXT[],
  source TEXT,
  source_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_universities_country ON universities(country);
CREATE INDEX idx_universities_name ON universities(name);
`);
    process.exit(1);
  }

  console.log('✅ Table exists, starting import...');

  const ukCount = await importUK();
  const caCount = await importCanada();
  const usCount = await importUS();

  await showStats();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ✅ Import Complete!`);
  console.log(`  Total imported: ${(ukCount + caCount + usCount).toLocaleString()}`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(console.error);
