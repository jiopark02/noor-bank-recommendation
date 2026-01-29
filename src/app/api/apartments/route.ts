import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country') || 'US';
    const city = searchParams.get('city');
    const university = searchParams.get('university');
    const minPrice = searchParams.get('min_price');
    const maxPrice = searchParams.get('max_price');
    const bedrooms = searchParams.get('bedrooms');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const gym = searchParams.get('gym') === 'true';
    const furnished = searchParams.get('furnished') === 'true';
    const parking = searchParams.get('parking') === 'true';

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const supabase = createServerClient();

    let query = supabase
      .from('apartments')
      .select('*', { count: 'exact' })
      .eq('country', country)
      .order('rating', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (city) {
      query = query.ilike('city', `%${city}%`);
    }

    if (university) {
      query = query.ilike('university', `%${university}%`);
    }

    if (minPrice) {
      query = query.gte('price_min', parseInt(minPrice));
    }

    if (maxPrice) {
      query = query.lte('price_max', parseInt(maxPrice));
    }

    if (bedrooms) {
      query = query.ilike('bedrooms', `%${bedrooms}%`);
    }

    if (gym) query = query.eq('gym', true);
    if (furnished) query = query.eq('furnished', true);
    if (parking) query = query.eq('parking', true);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      meta: {
        total: count || data?.length || 0,
        country,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('Apartments API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
