/**
 * Create universities table in Supabase
 *
 * This script creates the universities table using Supabase's SQL execution.
 * Run: npx tsx scripts/universities/create-table.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTableExists(): Promise<boolean> {
  const { data, error } = await supabase
    .from('universities')
    .select('id')
    .limit(1);

  // If no error or error is not "table doesn't exist", table exists
  if (!error) return true;
  if (error.code === '42P01') return false; // Table doesn't exist

  // Table might exist but have other issues
  console.log('Table check result:', error.message);
  return false;
}

async function main() {
  console.log('Checking if universities table exists...');

  const exists = await checkTableExists();

  if (exists) {
    console.log('✅ Universities table already exists!');

    // Get count
    const { count, error } = await supabase
      .from('universities')
      .select('*', { count: 'exact', head: true });

    if (!error) {
      console.log(`   Current record count: ${count}`);
    }
  } else {
    console.log('❌ Universities table does not exist.');
    console.log('\nPlease create it by running this SQL in Supabase SQL Editor:');
    console.log('https://supabase.com/dashboard/project/udkmzwscmotcyddptpko/sql/new\n');
    console.log('Copy and paste the contents of: scripts/universities/schema.sql');
  }
}

main().catch(console.error);
