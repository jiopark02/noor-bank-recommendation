import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country') || 'US';
    const limit = parseInt(searchParams.get('limit') || '20');
    const category = searchParams.get('category');
    const jobType = searchParams.get('type');

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const supabase = createServerClient();

    let query = supabase
      .from('jobs')
      .select('*')
      .eq('country', country)
      .eq('is_active', true)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (category) {
      query = query.eq('category', category);
    }

    if (jobType) {
      query = query.eq('job_type', jobType);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      meta: { total: data?.length || 0, country },
    });
  } catch (error) {
    console.error('Jobs API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
