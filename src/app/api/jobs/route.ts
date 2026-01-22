import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');
    const category = searchParams.get('category');
    const jobType = searchParams.get('type') || 'campus';

    const supabase = createServerClient();

    let query = supabase
      .from('jobs')
      .select('*')
      .eq('is_active', true)
      .order('deadline', { ascending: true })
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
      data,
      meta: { total: data?.length || 0 },
    });
  } catch (error) {
    console.error('Jobs API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
