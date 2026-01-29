/**
 * Generate complete SQL for universities table
 * Outputs SQL that can be run directly in Supabase SQL Editor
 */

import * as fs from 'fs';
import * as path from 'path';

import { ALL_UK_UNIVERSITIES } from './uk-universities-data';
import { ALL_CANADIAN_INSTITUTIONS } from './canada-universities-data';

// Import US universities from local data
import { ALL_UNIVERSITIES } from '../../src/lib/universities';

function escapeSQL(str: string | undefined | null): string {
  if (!str) return 'NULL';
  return `'${str.replace(/'/g, "''")}'`;
}

function arrayToSQL(arr: string[] | undefined): string {
  if (!arr || arr.length === 0) return 'NULL';
  const escaped = arr.map(s => s.replace(/'/g, "''")).join("','");
  return `ARRAY['${escaped}']`;
}

function generateInsert(record: any): string {
  return `INSERT INTO universities (id, name, short_name, city, state, country, zip_code, latitude, longitude, type, campus_type, sector, is_public, enrollment, international_students, website, aliases, source, source_id) VALUES (
  ${escapeSQL(record.id)},
  ${escapeSQL(record.name)},
  ${escapeSQL(record.short_name)},
  ${escapeSQL(record.city)},
  ${escapeSQL(record.state)},
  ${escapeSQL(record.country)},
  ${escapeSQL(record.zip_code)},
  ${record.latitude ?? 'NULL'},
  ${record.longitude ?? 'NULL'},
  ${escapeSQL(record.type)},
  ${escapeSQL(record.campus_type || 'main')},
  ${escapeSQL(record.sector)},
  ${record.is_public ?? true},
  ${record.enrollment ?? 'NULL'},
  ${record.international_students ?? 'NULL'},
  ${escapeSQL(record.website)},
  ${arrayToSQL(record.aliases)},
  ${escapeSQL(record.source)},
  ${escapeSQL(record.source_id)}
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  enrollment = EXCLUDED.enrollment,
  website = EXCLUDED.website;`;
}

async function main() {
  console.log('Generating SQL...');

  let sql = `-- ============================================================
-- UNIVERSITIES DATABASE - Complete Setup
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/udkmzwscmotcyddptpko/sql/new
-- ============================================================

-- Step 1: Create Table
CREATE TABLE IF NOT EXISTS universities (
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_universities_country ON universities(country);
CREATE INDEX IF NOT EXISTS idx_universities_state ON universities(state);
CREATE INDEX IF NOT EXISTS idx_universities_type ON universities(type);
CREATE INDEX IF NOT EXISTS idx_universities_name ON universities(name);

-- Step 2: Insert UK Universities (${ALL_UK_UNIVERSITIES.length} records)
`;

  // Add UK universities
  for (const uni of ALL_UK_UNIVERSITIES) {
    sql += generateInsert({
      ...uni,
      zip_code: uni.zip_code,
    }) + '\n';
  }

  sql += `\n-- Step 3: Insert Canada Institutions (${ALL_CANADIAN_INSTITUTIONS.length} records)\n`;

  // Add Canada institutions
  for (const uni of ALL_CANADIAN_INSTITUTIONS) {
    sql += generateInsert({
      ...uni,
      zip_code: uni.zip_code,
    }) + '\n';
  }

  sql += `\n-- Step 4: Insert US Universities (${ALL_UNIVERSITIES.length} records from local data)\n`;

  // Add US universities from local data
  for (const uni of ALL_UNIVERSITIES) {
    sql += generateInsert({
      id: uni.id,
      name: uni.name,
      short_name: uni.short_name,
      city: uni.city,
      state: uni.state,
      country: uni.country || 'US',
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
      source: uni.source || 'manual',
      source_id: uni.source_id || uni.id,
    }) + '\n';
  }

  sql += `
-- Step 5: Verify counts
SELECT country, COUNT(*) as count FROM universities GROUP BY country ORDER BY count DESC;
SELECT type, COUNT(*) as count FROM universities GROUP BY type ORDER BY count DESC;
SELECT 'Total' as label, COUNT(*) as count FROM universities;
`;

  // Write to file
  const outputPath = path.join(__dirname, 'complete-setup.sql');
  fs.writeFileSync(outputPath, sql);

  console.log(`\n✅ SQL generated: ${outputPath}`);
  console.log(`\nTotal records:`);
  console.log(`  UK: ${ALL_UK_UNIVERSITIES.length}`);
  console.log(`  Canada: ${ALL_CANADIAN_INSTITUTIONS.length}`);
  console.log(`  US: ${ALL_UNIVERSITIES.length}`);
  console.log(`  Total: ${ALL_UK_UNIVERSITIES.length + ALL_CANADIAN_INSTITUTIONS.length + ALL_UNIVERSITIES.length}`);
  console.log(`\nFile size: ${(sql.length / 1024).toFixed(1)} KB`);
}

main();
