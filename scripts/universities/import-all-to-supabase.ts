/**
 * Import ALL universities to Supabase from src/lib/universities
 *
 * Run: npx tsx scripts/universities/import-all-to-supabase.ts
 *
 * This imports:
 * - US Top 200+ universities + community colleges
 * - UK Top 50+ universities
 * - Canada Top 50+ universities and colleges
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

// Import comprehensive university data from src/lib/universities
import { ALL_UNIVERSITIES } from '../../src/lib/universities';

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
  system_name?: string | null;
  city: string;
  state: string;
  country: string;
  zip_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  type: string;
  campus_type?: string | null;
  is_public: boolean;
  enrollment?: number | null;
  international_students?: number | null;
  international_percentage?: number | null;
  website?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  aliases?: string[] | null;
  source?: string | null;
  source_id?: string | null;
}

async function clearTable() {
  console.log('Clearing existing data...');
  const { error } = await supabase.from('universities').delete().neq('id', '');
  if (error) {
    console.log('Note: Could not clear table - ', error.message);
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
      console.error(`Error importing batch ${Math.floor(i / batchSize) + 1}:`, error.message);
      // Log first record for debugging
      if (batch[0]) {
        console.error('First record in failed batch:', batch[0].id, batch[0].name);
      }
    } else {
      imported += batch.length;
      process.stdout.write(`\r  Imported ${imported}/${records.length} records...`);
    }
  }

  console.log(''); // New line after progress
  return imported;
}

async function importAllUniversities() {
  console.log('\n=== Importing ALL Universities from src/lib/universities ===\n');

  // Transform to database format
  const records: UniversityRecord[] = ALL_UNIVERSITIES.map(uni => ({
    id: uni.id,
    name: uni.name,
    short_name: uni.short_name,
    system_name: uni.system_name || null,
    city: uni.city,
    state: uni.state,
    country: uni.country || 'US',
    zip_code: uni.zip_code || null,
    latitude: uni.latitude || null,
    longitude: uni.longitude || null,
    type: uni.type,
    campus_type: uni.campus_type || 'main',
    is_public: uni.is_public,
    enrollment: uni.enrollment || null,
    international_students: uni.international_students || null,
    international_percentage: uni.international_percentage || null,
    website: uni.website || null,
    primary_color: uni.primary_color || null,
    secondary_color: uni.secondary_color || null,
    aliases: uni.aliases || null,
    source: 'local_data',
    source_id: uni.id,
  }));

  // Count by country
  const usCount = records.filter(r => r.country === 'US').length;
  const ukCount = records.filter(r => r.country === 'UK').length;
  const caCount = records.filter(r => r.country === 'CA').length;

  console.log(`Total records to import: ${records.length}`);
  console.log(`  - US: ${usCount}`);
  console.log(`  - UK: ${ukCount}`);
  console.log(`  - CA: ${caCount}`);
  console.log('');

  const count = await importBatch(records);
  console.log(`\nImport complete: ${count} records imported successfully`);
  return count;
}

async function getStats() {
  console.log('\n=== Database Statistics ===');

  // Get counts by country
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

  const { count: totalCount } = await supabase
    .from('universities')
    .select('*', { count: 'exact', head: true });

  console.log(`  Total: ${totalCount} institutions`);
  console.log(`  US: ${usCount} institutions`);
  console.log(`  UK: ${ukCount} institutions`);
  console.log(`  CA: ${caCount} institutions`);

  // Get count by type
  const { data: typeData } = await supabase
    .from('universities')
    .select('type')
    .limit(5000);

  if (typeData) {
    const typeCounts = typeData.reduce((acc, row) => {
      acc[row.type] = (acc[row.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\n  By Type:');
    Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`    ${type}: ${count}`);
      });
  }

  // Show sample entries
  console.log('\n  Sample UK entries:');
  const { data: ukSample } = await supabase
    .from('universities')
    .select('id, name, short_name')
    .eq('country', 'UK')
    .limit(5);

  ukSample?.forEach(uni => {
    console.log(`    - ${uni.name} (${uni.short_name})`);
  });

  // Check for Oxford specifically
  const { data: oxford } = await supabase
    .from('universities')
    .select('id, name, short_name')
    .ilike('name', '%oxford%');

  if (oxford && oxford.length > 0) {
    console.log('\n  Oxford-related entries:');
    oxford.forEach(uni => {
      console.log(`    - ${uni.name} (${uni.id})`);
    });
  }
}

async function main() {
  console.log('==============================================');
  console.log('University Database Import - Comprehensive');
  console.log('==============================================');

  try {
    // Test connection
    const { error } = await supabase.from('universities').select('id').limit(1);
    if (error && error.code === '42P01') {
      console.log('Table does not exist. Please create it first.');
      console.log('You may need to run the schema in Supabase SQL Editor.');
      process.exit(1);
    }

    // Clear existing data for fresh import
    await clearTable();

    // Import all universities
    await importAllUniversities();

    // Show final stats
    await getStats();

    console.log('\n=== Import Complete ===');
    console.log('The university dropdown should now show all institutions!');

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

main();
