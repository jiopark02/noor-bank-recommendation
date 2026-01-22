import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');
    const f1Only = searchParams.get('f1') === 'true';
    const noSsn = searchParams.get('no_ssn') === 'true';

    const supabase = createServerClient();

    let query = supabase
      .from('credit_cards')
      .select('*')
      .order('f1_friendly', { ascending: false })
      .limit(limit);

    if (f1Only) {
      query = query.eq('f1_friendly', true);
    }

    if (noSsn) {
      query = query.eq('ssn_required', false);
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
    console.error('Credit cards API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
