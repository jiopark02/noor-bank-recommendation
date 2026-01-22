import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');
    const f1Only = searchParams.get('f1') === 'true';

    const supabase = createServerClient();

    let query = supabase
      .from('scholarships')
      .select('*')
      .order('amount_max', { ascending: false })
      .limit(limit);

    if (f1Only) {
      query = query.eq('eligibility_f1', true);
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
    console.error('Scholarships API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
