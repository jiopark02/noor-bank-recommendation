/**
 * Create table via Supabase SQL API
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const createTableSQL = `
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
`;

async function tryCreateTable() {
  console.log('Attempting to create table via Supabase API...');
  console.log('URL:', supabaseUrl);

  // Try different RPC endpoints
  const endpoints = [
    '/rest/v1/rpc/exec_sql',
    '/rest/v1/rpc/execute_sql',
    '/rest/v1/rpc/run_sql',
    '/rest/v1/rpc/sql',
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${supabaseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ sql: createTableSQL }),
      });

      const text = await response.text();
      console.log(`${endpoint}: ${response.status} - ${text.substring(0, 100)}`);

      if (response.ok) {
        console.log('✅ Table created!');
        return true;
      }
    } catch (error: any) {
      console.log(`${endpoint}: Error - ${error.message}`);
    }
  }

  console.log('\n❌ Could not create table via API.');
  console.log('\nPlease run this SQL in Supabase SQL Editor:');
  console.log('https://supabase.com/dashboard/project/udkmzwscmotcyddptpko/sql/new');
  console.log('\n' + createTableSQL);

  return false;
}

tryCreateTable();
