import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getBankBranchesForUniversity, getUniversityLocation } from '@/lib/locationData';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const university = searchParams.get('university');
    const bankName = searchParams.get('bank');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!university) {
      return NextResponse.json(
        { error: 'university parameter is required' },
        { status: 400 }
      );
    }

    // Try Supabase first for real data
    if (isSupabaseConfigured()) {
      try {
        const supabase = createServerClient();

        let query = supabase
          .from('bank_branches')
          .select('*')
          .eq('university_short_name', university)
          .limit(limit);

        if (bankName) {
          query = query.ilike('bank_name', '%' + bankName + '%');
        }

        const { data, error } = await query;

        if (!error && data && data.length > 0) {
          // Get university center for reference
          const location = getUniversityLocation(university);

          return NextResponse.json({
            success: true,
            data: data.map(branch => ({
              id: branch.id,
              bank: branch.bank_name,
              name: branch.branch_name || branch.bank_name,
              address: branch.address,
              lat: branch.latitude,
              lng: branch.longitude,
              campusSide: branch.campus_side,
              phone: branch.phone,
              hours: branch.hours,
              hasAtm: branch.has_atm,
              hasDriveThru: branch.has_drive_thru,
            })),
            meta: {
              total: data.length,
              university,
              source: 'supabase',
              universityCenter: location?.center || null,
            },
          });
        }
      } catch (dbError) {
        console.log('Supabase unavailable, falling back to local data');
      }
    }

    // Fallback to local data
    let branches = getBankBranchesForUniversity(university);

    if (bankName) {
      branches = branches.filter(b =>
        b.bank.toLowerCase().includes(bankName.toLowerCase())
      );
    }

    branches = branches.slice(0, limit);

    // Get university center
    const location = getUniversityLocation(university);

    return NextResponse.json({
      success: true,
      data: branches,
      meta: {
        total: branches.length,
        university,
        source: 'local',
        universityCenter: location?.center || null,
      },
    });
  } catch (error) {
    console.error('Bank branches API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
