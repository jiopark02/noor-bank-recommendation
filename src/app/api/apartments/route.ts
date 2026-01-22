import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');
    const gym = searchParams.get('gym') === 'true';
    const furnished = searchParams.get('furnished') === 'true';
    const parking = searchParams.get('parking') === 'true';

    const supabase = createServerClient();

    let query = supabase
      .from('apartments')
      .select('*')
      .order('walking_minutes', { ascending: true })
      .limit(limit);

    if (gym) query = query.eq('gym', true);
    if (furnished) query = query.eq('furnished', true);
    if (parking) query = query.eq('parking', true);

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
    console.error('Apartments API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
