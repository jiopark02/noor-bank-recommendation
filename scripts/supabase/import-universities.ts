/**
 * Import all universities to Supabase
 * Run: npx tsx scripts/supabase/import-universities.ts
 */

import { createClient } from '@supabase/supabase-js';
import { ALL_UNIVERSITIES } from '../../src/lib/universities';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function importUniversities() {
  console.log('Importing ' + ALL_UNIVERSITIES.length + ' universities to Supabase...\n');

  const universities = ALL_UNIVERSITIES.map(uni => ({
    id: uni.id,
    name: uni.name,
    short_name: uni.short_name,
    city: uni.city,
    state: uni.state,
    country: uni.country || 'US',
    latitude: uni.latitude,
    longitude: uni.longitude,
    type: uni.type || null,
    aliases: uni.aliases || [],
  }));

  // Insert in batches of 100
  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < universities.length; i += batchSize) {
    const batch = universities.slice(i, i + batchSize);

    const { error } = await supabase
      .from('universities')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error('Error inserting batch:', error);
    } else {
      inserted += batch.length;
      console.log('Inserted: ' + inserted + '/' + universities.length);
    }
  }

  console.log('\nDone! Imported ' + inserted + ' universities.');
}

importUniversities().catch(console.error);
