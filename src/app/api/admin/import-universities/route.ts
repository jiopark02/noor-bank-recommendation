import { NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { ALL_UNIVERSITIES } from '@/lib/universities';

export const maxDuration = 60; // Allow up to 60 seconds for this endpoint

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 503 }
    );
  }

  const supabase = createServerClient();

  try {
    // Transform to database format
    const records = ALL_UNIVERSITIES.map(uni => ({
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

    // Clear existing data
    await supabase.from('universities').delete().neq('id', '');

    // Import in batches of 100
    let imported = 0;
    const batchSize = 100;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      const { error } = await supabase
        .from('universities')
        .upsert(batch, { onConflict: 'id' });

      if (error) {
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        imported += batch.length;
      }
    }

    // Get final stats
    const { count: totalCount } = await supabase
      .from('universities')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      success: true,
      message: 'Import complete',
      stats: {
        totalRecords: records.length,
        imported,
        failed: records.length - imported,
        inDatabase: totalCount,
        breakdown: {
          us: usCount,
          uk: ukCount,
          ca: caCount,
        }
      },
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 503 }
    );
  }

  const supabase = createServerClient();

  try {
    // Get counts
    const { count: totalCount } = await supabase
      .from('universities')
      .select('*', { count: 'exact', head: true });

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

    // Check for specific universities
    const { data: oxfordData } = await supabase
      .from('universities')
      .select('id, name, short_name')
      .ilike('name', '%oxford%');

    const { data: deAnzaData } = await supabase
      .from('universities')
      .select('id, name, short_name')
      .ilike('name', '%de anza%');

    return NextResponse.json({
      stats: {
        total: totalCount,
        us: usCount,
        uk: ukCount,
        ca: caCount,
      },
      samples: {
        oxford: oxfordData,
        deAnza: deAnzaData,
      },
      localDataCount: ALL_UNIVERSITIES.length,
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get stats' },
      { status: 500 }
    );
  }
}
