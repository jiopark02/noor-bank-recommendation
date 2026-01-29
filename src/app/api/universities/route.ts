import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

export interface UniversitySearchResult {
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  country: string;
  type: string;
  is_public: boolean;
  enrollment?: number;
  international_students?: number;
  website?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const country = searchParams.get('country'); // 'US', 'UK', 'CA', or comma-separated
    const type = searchParams.get('type'); // 'university', 'community_college', etc.
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Database not configured', fallback: true },
        { status: 503 }
      );
    }

    const supabase = createServerClient();

    // Build the query
    let dbQuery = supabase
      .from('universities')
      .select('id, name, short_name, city, state, country, type, is_public, enrollment, international_students, website')
      .order('enrollment', { ascending: false, nullsFirst: false });

    // Full-text search if query provided
    if (query && query.length >= 2) {
      // Search in name, short_name, city, and aliases
      dbQuery = dbQuery.or(
        `name.ilike.%${query}%,short_name.ilike.%${query}%,city.ilike.%${query}%`
      );
    }

    // Filter by country
    if (country) {
      const countries = country.split(',').map(c => c.trim().toUpperCase());
      if (countries.length === 1) {
        dbQuery = dbQuery.eq('country', countries[0]);
      } else {
        dbQuery = dbQuery.in('country', countries);
      }
    }

    // Filter by type
    if (type) {
      const types = type.split(',').map(t => t.trim());
      if (types.length === 1) {
        dbQuery = dbQuery.eq('type', types[0]);
      } else {
        dbQuery = dbQuery.in('type', types);
      }
    }

    // Pagination
    dbQuery = dbQuery.range(offset, offset + limit - 1);

    const { data, error, count } = await dbQuery;

    if (error) {
      console.error('Universities search error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      meta: {
        total: count ?? data?.length ?? 0,
        limit,
        offset,
        query,
        country,
        type,
      },
    });
  } catch (error) {
    console.error('Universities API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// Get university by ID
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids)) {
      return NextResponse.json(
        { error: 'ids array is required' },
        { status: 400 }
      );
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Database not configured', fallback: true },
        { status: 503 }
      );
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('universities')
      .select('*')
      .in('id', ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('Universities by ID error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
