import { NextRequest, NextResponse } from 'next/server';
import { ALL_UNIVERSITIES, searchUniversities, getUniversityById } from '@/lib/universities';

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

// Search universities using local data (comprehensive, fast, no database needed)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const country = searchParams.get('country'); // 'US', 'UK', 'CA', or comma-separated
    const type = searchParams.get('type'); // 'university', 'community_college', etc.
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Start with all universities from comprehensive local data
    let results = [...ALL_UNIVERSITIES];

    // Filter by country
    if (country) {
      const countries = country.split(',').map(c => c.trim().toUpperCase());
      results = results.filter(uni => {
        const uniCountry = uni.country || 'US';
        return countries.includes(uniCountry);
      });
    }

    // Filter by type
    if (type) {
      const types = type.split(',').map(t => t.trim().toLowerCase());
      results = results.filter(uni => {
        // Handle community_college type mapping
        if (types.includes('community_college') && uni.type === 'community_college') return true;
        if (types.includes('university') && (uni.type === 'university' || uni.type === 'ivy_league' || uni.type === 'russell_group')) return true;
        return types.includes(uni.type.toLowerCase());
      });
    }

    // Search by query
    if (query && query.length >= 2) {
      const searchLower = query.toLowerCase();
      results = results.filter(uni => {
        const name = uni.name.toLowerCase();
        const shortName = uni.short_name.toLowerCase();
        const city = uni.city.toLowerCase();
        const state = uni.state.toLowerCase();
        const aliases = (uni.aliases || []).map(a => a.toLowerCase());

        return name.includes(searchLower) ||
               shortName.includes(searchLower) ||
               city.includes(searchLower) ||
               state.includes(searchLower) ||
               aliases.some(a => a.includes(searchLower));
      });

      // Score and sort by relevance
      results = results.map(uni => {
        let score = 0;
        const name = uni.name.toLowerCase();
        const shortName = uni.short_name.toLowerCase();

        // Exact matches
        if (name === searchLower || shortName === searchLower) score += 100;
        // Starts with
        if (name.startsWith(searchLower) || shortName.startsWith(searchLower)) score += 50;
        // Contains
        if (name.includes(searchLower)) score += 20;
        if (shortName.includes(searchLower)) score += 20;
        // Enrollment bonus (popular schools first)
        if (uni.enrollment && uni.enrollment > 10000) score += 10;
        if (uni.international_students && uni.international_students > 1000) score += 5;

        return { ...uni, _score: score };
      }).sort((a, b) => (b._score || 0) - (a._score || 0));
    } else {
      // No search query - sort by enrollment (popular schools first)
      results = results.sort((a, b) => (b.enrollment || 0) - (a.enrollment || 0));
    }

    // Get total before pagination
    const total = results.length;

    // Apply pagination
    results = results.slice(offset, offset + limit);

    // Transform to response format
    const data: UniversitySearchResult[] = results.map(uni => ({
      id: uni.id,
      name: uni.name,
      short_name: uni.short_name,
      city: uni.city,
      state: uni.state,
      country: uni.country || 'US',
      type: uni.type,
      is_public: uni.is_public,
      enrollment: uni.enrollment,
      international_students: uni.international_students,
      website: uni.website,
    }));

    return NextResponse.json({
      success: true,
      data,
      meta: {
        total,
        limit,
        offset,
        query,
        country,
        type,
        source: 'local_data',
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

// Get university by ID using local data
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

    // Find universities by ID from local data
    const data = ids
      .map(id => getUniversityById(id))
      .filter(Boolean)
      .map(uni => ({
        id: uni!.id,
        name: uni!.name,
        short_name: uni!.short_name,
        city: uni!.city,
        state: uni!.state,
        country: uni!.country || 'US',
        type: uni!.type,
        is_public: uni!.is_public,
        enrollment: uni!.enrollment,
        international_students: uni!.international_students,
        website: uni!.website,
      }));

    return NextResponse.json({
      success: true,
      data,
      source: 'local_data',
    });
  } catch (error) {
    console.error('Universities by ID error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
