/**
 * Direct database setup for universities table
 *
 * Requires DATABASE_URL in .env.local:
 * DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
 *
 * Or SUPABASE_DB_PASSWORD with the project reference auto-detected
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

function getDatabaseUrl(): string | null {
  // Try direct DATABASE_URL first
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Try to construct from components
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (supabaseUrl && dbPassword) {
    const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
    return `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
  }

  return null;
}

async function main() {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    console.log('❌ Database connection not configured.');
    console.log('\nTo set up the database, add one of these to .env.local:\n');
    console.log('Option 1 (recommended):');
    console.log('DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.udkmzwscmotcyddptpko.supabase.co:5432/postgres');
    console.log('\nOption 2:');
    console.log('SUPABASE_DB_PASSWORD=your-database-password');
    console.log('\nYou can find the password in Supabase Dashboard:');
    console.log('Project Settings → Database → Connection string → URI');
    console.log('\nOr run the SQL manually:');
    console.log('https://supabase.com/dashboard/project/udkmzwscmotcyddptpko/sql/new');
    process.exit(1);
  }

  console.log('Connecting to database...');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Test connection
    const client = await pool.connect();
    console.log('✅ Connected to database');

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    console.log('Creating universities table...');
    await client.query(schema);
    console.log('✅ Table created successfully!');

    // Verify
    const result = await client.query(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'universities'"
    );
    console.log('✅ Table verified:', result.rows[0].count === '1' ? 'exists' : 'not found');

    client.release();
  } catch (error: any) {
    console.error('❌ Database error:', error.message);

    if (error.message.includes('password authentication failed')) {
      console.log('\nThe database password is incorrect.');
      console.log('Get the correct password from Supabase Dashboard:');
      console.log('Project Settings → Database → Connection string');
    }
  } finally {
    await pool.end();
  }
}

main();
