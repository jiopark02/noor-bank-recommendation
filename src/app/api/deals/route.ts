import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getMockDeals } from '@/lib/dealsData';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country') || 'US';
    const category = searchParams.get('category');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Try Supabase first
    if (isSupabaseConfigured()) {
      try {
        const supabase = createServerClient();

        let query = supabase
          .from('deals')
          .select('*')
          .eq('country', country)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (category) {
          query = query.eq('category', category);
        }

        const { data, error } = await query;

        if (!error && data && data.length > 0) {
          return NextResponse.json({
            success: true,
            data: data,
            meta: { total: data.length, country },
          });
        }
      } catch (dbError) {
        console.warn('Supabase error, falling back to mock data:', dbError);
      }
    }

    // Fallback to mock deals
    let deals = getMockDeals(country);

    // Filter by category
    if (category) {
      deals = deals.filter(d => d.category === category);
    }

    // Apply limit
    deals = deals.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: deals,
      meta: { total: deals.length, country, source: 'mock' },
    });
  } catch (error) {
    console.error('Deals API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
