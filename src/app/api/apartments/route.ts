import { NextRequest, NextResponse } from 'next/server';
import { ALL_APARTMENTS, getUniversityLocation } from '@/lib/locationData';
import { getUniversityPricing, getRealisticApartmentName } from '@/lib/locationData/apartmentPricing';

// Default apartment images (Unsplash)
const DEFAULT_APARTMENT_IMAGES = [
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1560185893-a55cbc8c57e8?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1574362848149-11496d93a7c7?w=800&h=600&fit=crop',
];

// Get a consistent image based on apartment ID
const getDefaultImage = (aptId: string): string[] => {
  const hash = aptId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return [DEFAULT_APARTMENT_IMAGES[hash % DEFAULT_APARTMENT_IMAGES.length]];
};

// Get country from university location
const getCountryFromUniversity = (university: string): string => {
  const location = getUniversityLocation(university);
  return location?.country || 'US';
};

// Determine bedroom type from bedrooms string
const getBedroomType = (bedrooms: string): 'studio' | 'oneBed' | 'twoBed' | 'threeBed' => {
  const lower = bedrooms.toLowerCase();
  if (lower.includes('studio')) return 'studio';
  if (lower.includes('3') || lower.includes('three')) return 'threeBed';
  if (lower.includes('2') || lower.includes('two')) return 'twoBed';
  return 'oneBed';
};

// Convert apartment data with realistic pricing and names
const enrichApartment = (apt: typeof ALL_APARTMENTS[0], index: number) => {
  const country = getCountryFromUniversity(apt.university);
  const pricing = getUniversityPricing(apt.university, country);
  const bedroomType = getBedroomType(apt.bedrooms);
  const priceRange = pricing[bedroomType];

  // Use realistic apartment name if available
  const name = getRealisticApartmentName(apt.university, index);

  return {
    ...apt,
    name: name || apt.name,
    price_min: priceRange[0],
    price_max: priceRange[1],
    // Shared prices are typically 40-60% of full price
    shared_price_min: Math.round(priceRange[0] * 0.4),
    shared_price_max: Math.round(priceRange[1] * 0.6),
    images: apt.images && apt.images.length > 0 ? apt.images : getDefaultImage(apt.id),
    contact_website: apt.contact_website || 'https://www.apartments.com',
  };
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country') || 'US';
    const city = searchParams.get('city');
    const university = searchParams.get('university');
    const minPrice = searchParams.get('min_price');
    const maxPrice = searchParams.get('max_price');
    const bedrooms = searchParams.get('bedrooms');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const gym = searchParams.get('gym') === 'true';
    const furnished = searchParams.get('furnished') === 'true';
    const parking = searchParams.get('parking') === 'true';
    const campusSide = searchParams.get('campus_side');

    // Always use local apartment data (ALL_APARTMENTS) for consistency
    // This ensures correct university-specific data with realistic pricing
    let apartments = ALL_APARTMENTS.map((apt, index) => enrichApartment(apt, index));

    // Filter by university (EXACT match first, then partial)
    if (university) {
      const uniLower = university.toLowerCase().trim();

      // First try exact match
      let filtered = apartments.filter(a =>
        a.university.toLowerCase() === uniLower
      );

      // If no exact match, try partial match
      if (filtered.length === 0) {
        filtered = apartments.filter(a => {
          const aptUni = a.university.toLowerCase();
          return aptUni.includes(uniLower) || uniLower.includes(aptUni);
        });
      }

      apartments = filtered;
    } else {
      // Filter by country if no university specified
      apartments = apartments.filter(a => {
        const aptCountry = getCountryFromUniversity(a.university);
        return aptCountry === country;
      });
    }

    // Apply other filters
    if (city) {
      apartments = apartments.filter(a =>
        a.address.toLowerCase().includes(city.toLowerCase())
      );
    }
    if (minPrice) {
      apartments = apartments.filter(a => a.price_min >= parseInt(minPrice));
    }
    if (maxPrice) {
      apartments = apartments.filter(a => a.price_max <= parseInt(maxPrice));
    }
    if (bedrooms) {
      apartments = apartments.filter(a =>
        a.bedrooms.toLowerCase().includes(bedrooms.toLowerCase())
      );
    }
    if (gym) apartments = apartments.filter(a => a.gym);
    if (furnished) apartments = apartments.filter(a => a.furnished);
    if (parking) apartments = apartments.filter(a => a.parking);
    if (campusSide) apartments = apartments.filter(a => a.campus_side === campusSide);

    // Sort by rating
    apartments.sort((a, b) => b.rating - a.rating);

    // Apply pagination
    const total = apartments.length;
    const paginatedApartments = apartments.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: paginatedApartments,
      meta: {
        total,
        country,
        university: university || null,
        limit,
        offset,
        source: 'local',
        pricing: 'market-adjusted', // Indicates pricing is based on real market data
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
