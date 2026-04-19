export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country') || 'US';
    const limit = parseInt(searchParams.get('limit') || '20');
    const f1Only = searchParams.get('f1') === 'true';
    const category = searchParams.get('category');

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const supabase = createServerClient();

    let query = supabase
      .from('scholarships')
      .select('*')
      .eq('country', country)
      .order('amount_max', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (f1Only) {
      query = query.eq('eligibility_f1', true);
    }

    if (category) {
      query = query.eq('category', category);
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
    console.error('Scholarships API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
