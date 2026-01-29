import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country') || 'US';
    const noSsn = searchParams.get('no_ssn') === 'true';
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const supabase = createServerClient();

    let query = supabase
      .from('banks')
      .select('*')
      .eq('country', country)
      .order('intl_student_friendly', { ascending: false })
      .order('bank_name', { ascending: true })
      .limit(limit);

    if (noSsn) {
      query = query.eq('can_open_without_ssn', true);
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
    console.error('Banks API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
