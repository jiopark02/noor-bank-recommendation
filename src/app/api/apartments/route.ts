import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

// Mock apartment data with coordinates
const MOCK_APARTMENTS = [
  {
    id: 'apt-1',
    name: 'Cardinal Apartments',
    address: '123 University Ave, Palo Alto, CA',
    city: 'Palo Alto',
    university: 'Stanford',
    country: 'US',
    price_min: 2200,
    price_max: 3500,
    shared_price_min: 1200,
    shared_price_max: 1800,
    bedrooms: 'Studio - 2BR',
    bathrooms: '1-2',
    sqft_min: 450,
    sqft_max: 900,
    latitude: 37.4419,
    longitude: -122.1430,
    walking_minutes: 15,
    biking_minutes: 5,
    transit_minutes: 10,
    driving_minutes: 3,
    gym: true,
    furnished: false,
    parking: true,
    pet_policy: 'Cats allowed',
    rating: 4.5,
    review_count: 128,
    campus_side: 'north',
    images: ['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800'],
    contact_website: 'https://example.com',
  },
  {
    id: 'apt-2',
    name: 'Oak Creek Apartments',
    address: '456 El Camino Real, Palo Alto, CA',
    city: 'Palo Alto',
    university: 'Stanford',
    country: 'US',
    price_min: 2800,
    price_max: 4200,
    shared_price_min: 1500,
    shared_price_max: 2100,
    bedrooms: '1BR - 3BR',
    bathrooms: '1-2',
    sqft_min: 650,
    sqft_max: 1200,
    latitude: 37.4380,
    longitude: -122.1520,
    walking_minutes: 20,
    biking_minutes: 7,
    transit_minutes: 12,
    driving_minutes: 5,
    gym: true,
    furnished: true,
    parking: true,
    pet_policy: 'Dogs & cats',
    rating: 4.7,
    review_count: 95,
    campus_side: 'west',
    images: ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800'],
    contact_website: 'https://example.com',
  },
  {
    id: 'apt-3',
    name: 'Menlo Park Studios',
    address: '789 Santa Cruz Ave, Menlo Park, CA',
    city: 'Menlo Park',
    university: 'Stanford',
    country: 'US',
    price_min: 1900,
    price_max: 2600,
    shared_price_min: 1000,
    shared_price_max: 1400,
    bedrooms: 'Studio - 1BR',
    bathrooms: '1',
    sqft_min: 400,
    sqft_max: 600,
    latitude: 37.4530,
    longitude: -122.1817,
    walking_minutes: 25,
    biking_minutes: 10,
    transit_minutes: 15,
    driving_minutes: 7,
    gym: false,
    furnished: true,
    parking: false,
    pet_policy: 'No pets',
    rating: 4.2,
    review_count: 67,
    campus_side: 'north',
    images: ['https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800'],
    contact_website: 'https://example.com',
  },
  {
    id: 'apt-4',
    name: 'Page Mill Residences',
    address: '321 Page Mill Rd, Palo Alto, CA',
    city: 'Palo Alto',
    university: 'Stanford',
    country: 'US',
    price_min: 3200,
    price_max: 4800,
    shared_price_min: 1700,
    shared_price_max: 2500,
    bedrooms: '2BR - 3BR',
    bathrooms: '2',
    sqft_min: 900,
    sqft_max: 1400,
    latitude: 37.4220,
    longitude: -122.1410,
    walking_minutes: 18,
    biking_minutes: 6,
    transit_minutes: 14,
    driving_minutes: 4,
    gym: true,
    furnished: false,
    parking: true,
    pet_policy: 'Dogs & cats',
    rating: 4.8,
    review_count: 156,
    campus_side: 'south',
    images: ['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800'],
    contact_website: 'https://example.com',
  },
  {
    id: 'apt-5',
    name: 'Stanford Terrace',
    address: '555 Stanford Ave, Palo Alto, CA',
    city: 'Palo Alto',
    university: 'Stanford',
    country: 'US',
    price_min: 2500,
    price_max: 3800,
    shared_price_min: 1300,
    shared_price_max: 2000,
    bedrooms: '1BR - 2BR',
    bathrooms: '1-2',
    sqft_min: 550,
    sqft_max: 950,
    latitude: 37.4310,
    longitude: -122.1680,
    walking_minutes: 12,
    biking_minutes: 4,
    transit_minutes: 8,
    driving_minutes: 3,
    gym: true,
    furnished: true,
    parking: true,
    pet_policy: 'Cats allowed',
    rating: 4.6,
    review_count: 112,
    campus_side: 'east',
    images: ['https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800'],
    contact_website: 'https://example.com',
  },
  {
    id: 'apt-6',
    name: 'University Gardens',
    address: '888 University Ave, Palo Alto, CA',
    city: 'Palo Alto',
    university: 'Stanford',
    country: 'US',
    price_min: 2100,
    price_max: 3200,
    shared_price_min: 1100,
    shared_price_max: 1700,
    bedrooms: 'Studio - 2BR',
    bathrooms: '1',
    sqft_min: 420,
    sqft_max: 850,
    latitude: 37.4450,
    longitude: -122.1560,
    walking_minutes: 22,
    biking_minutes: 8,
    transit_minutes: 16,
    driving_minutes: 6,
    gym: false,
    furnished: false,
    parking: true,
    pet_policy: 'No pets',
    rating: 4.3,
    review_count: 89,
    campus_side: 'north',
    images: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800'],
    contact_website: 'https://example.com',
  },
];

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
    const campusSide = searchParams.get('campus_side');

    // Try Supabase first
    if (isSupabaseConfigured()) {
      try {
        const supabase = createServerClient();

        let query = supabase
          .from('apartments')
          .select('*', { count: 'exact' })
          .eq('country', country)
          .order('rating', { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1);

        if (city) query = query.ilike('city', `%${city}%`);
        if (university) query = query.ilike('university', `%${university}%`);
        if (minPrice) query = query.gte('price_min', parseInt(minPrice));
        if (maxPrice) query = query.lte('price_max', parseInt(maxPrice));
        if (bedrooms) query = query.ilike('bedrooms', `%${bedrooms}%`);
        if (gym) query = query.eq('gym', true);
        if (furnished) query = query.eq('furnished', true);
        if (parking) query = query.eq('parking', true);
        if (campusSide) query = query.eq('campus_side', campusSide);

        const { data, error, count } = await query;

        if (!error && data && data.length > 0) {
          return NextResponse.json({
            success: true,
            data: data,
            meta: { total: count || data.length, country, limit, offset },
          });
        }
      } catch (dbError) {
        console.warn('Supabase error, using mock data:', dbError);
      }
    }

    // Fallback to mock data
    let apartments = [...MOCK_APARTMENTS];

    // Apply filters
    if (university) {
      apartments = apartments.filter(a => a.university.toLowerCase().includes(university.toLowerCase()));
    }
    if (city) {
      apartments = apartments.filter(a => a.city.toLowerCase().includes(city.toLowerCase()));
    }
    if (minPrice) {
      apartments = apartments.filter(a => a.price_min >= parseInt(minPrice));
    }
    if (maxPrice) {
      apartments = apartments.filter(a => a.price_max <= parseInt(maxPrice));
    }
    if (gym) apartments = apartments.filter(a => a.gym);
    if (furnished) apartments = apartments.filter(a => a.furnished);
    if (parking) apartments = apartments.filter(a => a.parking);
    if (campusSide) apartments = apartments.filter(a => a.campus_side === campusSide);

    // Apply pagination
    const paginatedApartments = apartments.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: paginatedApartments,
      meta: {
        total: apartments.length,
        country,
        limit,
        offset,
        source: 'mock',
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
