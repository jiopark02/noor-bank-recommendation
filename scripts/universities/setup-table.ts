/**
 * Setup universities table in Supabase using REST API
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

async function runSQL(sql: string): Promise<any> {
  // Try using the Supabase SQL endpoint
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey!,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ sql }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SQL execution failed: ${response.status} - ${text}`);
  }

  return response.json();
}

async function createTableDirectly() {
  // Read the schema file
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  console.log('Creating universities table...');

  try {
    await runSQL(schema);
    console.log('✅ Table created successfully!');
  } catch (error: any) {
    if (error.message.includes('404') || error.message.includes('exec_sql')) {
      console.log('Note: exec_sql RPC not available. Table may need to be created manually.');
      console.log('\nAlternative: Using Supabase Management API...');

      // Try management API approach
      await createViaManagementAPI(schema);
    } else {
      throw error;
    }
  }
}

async function createViaManagementAPI(sql: string) {
  // This requires service role key
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('\n❌ Cannot auto-create table without SUPABASE_ACCESS_TOKEN');
    console.log('\nOptions:');
    console.log('1. Run schema.sql in Supabase SQL Editor:');
    console.log(`   https://supabase.com/dashboard/project/${projectRef}/sql/new`);
    console.log('\n2. Or add SUPABASE_ACCESS_TOKEN to .env.local');
    console.log('   (Get it from: https://supabase.com/dashboard/account/tokens)');
    return;
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Management API failed: ${response.status} - ${text}`);
  }

  console.log('✅ Table created via Management API!');
}

createTableDirectly().catch(console.error);
