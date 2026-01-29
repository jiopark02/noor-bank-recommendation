import { NextRequest, NextResponse } from 'next/server';
import {
  Country,
  getVisaTypes,
  getRequiredDocuments,
  getHealthInsurance,
  getBanks,
  getStudentFriendlyBanks,
  getBanksNoIdRequired,
  getCountryDisplay,
  getAllCountries,
  VISA_TYPES,
  REQUIRED_DOCUMENTS,
  HEALTH_INSURANCE,
  BANKS,
  COUNTRY_DISPLAY,
} from '@/lib/countryConfig';

function isValidCountry(country: string): country is Country {
  return ['US', 'UK', 'CA'].includes(country);
}

// GET /api/country-config?country=US
// GET /api/country-config?country=US&section=banks
// GET /api/country-config (returns all countries summary)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country')?.toUpperCase();
    const section = searchParams.get('section'); // 'visa', 'documents', 'health', 'banks', 'all'
    const studentOnly = searchParams.get('student_only') === 'true';
    const noIdRequired = searchParams.get('no_id_required') === 'true';

    // If no country specified, return summary of all countries
    if (!country) {
      const summary = getAllCountries().map(c => ({
        code: c,
        ...getCountryDisplay(c),
        visaTypesCount: getVisaTypes(c).length,
        banksCount: getBanks(c).length,
        documentsCount: getRequiredDocuments(c).length,
      }));

      return NextResponse.json({
        success: true,
        data: {
          countries: summary,
          availableCountries: getAllCountries(),
        },
      });
    }

    // Validate country
    if (!isValidCountry(country)) {
      return NextResponse.json(
        { error: `Invalid country: ${country}. Valid options: US, UK, CA` },
        { status: 400 }
      );
    }

    // Return specific section if requested
    if (section) {
      let data: unknown;

      switch (section) {
        case 'visa':
        case 'visas':
          data = getVisaTypes(country);
          break;
        case 'documents':
          data = getRequiredDocuments(country);
          break;
        case 'health':
        case 'insurance':
          data = getHealthInsurance(country);
          break;
        case 'banks':
          if (noIdRequired) {
            data = getBanksNoIdRequired(country);
          } else if (studentOnly) {
            data = getStudentFriendlyBanks(country);
          } else {
            data = getBanks(country);
          }
          break;
        case 'display':
        case 'info':
          data = getCountryDisplay(country);
          break;
        case 'all':
        default:
          data = {
            info: getCountryDisplay(country),
            visaTypes: getVisaTypes(country),
            documents: getRequiredDocuments(country),
            healthInsurance: getHealthInsurance(country),
            banks: studentOnly ? getStudentFriendlyBanks(country) : getBanks(country),
          };
      }

      return NextResponse.json({
        success: true,
        country,
        section,
        data,
      });
    }

    // Return all data for the country
    return NextResponse.json({
      success: true,
      country,
      data: {
        info: getCountryDisplay(country),
        visaTypes: getVisaTypes(country),
        documents: getRequiredDocuments(country),
        healthInsurance: getHealthInsurance(country),
        banks: getBanks(country),
      },
    });
  } catch (error) {
    console.error('Country config API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/country-config/sync - Sync local config to Supabase
// This is an admin endpoint to seed the database with local config data
export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    if (action !== 'sync') {
      return NextResponse.json(
        { error: 'Invalid action. Use action: "sync" to sync data to database.' },
        { status: 400 }
      );
    }

    // Return the data that should be synced to the database
    // This can be used by an admin to manually sync or by a script
    const syncData = {
      visa_types: Object.entries(VISA_TYPES).flatMap(([country, types]) =>
        types.map((t, i) => ({
          id: t.id,
          country,
          code: t.code,
          name: t.name,
          full_name: t.fullName,
          description: t.description,
          duration: t.duration,
          work_allowed: t.workAllowed,
          work_restrictions: t.workRestrictions || null,
          requirements: t.requirements,
          documents_needed: t.documentsNeeded,
          renewal_info: t.renewalInfo || null,
          application_link: t.applicationLink || null,
          display_order: i,
          is_active: true,
        }))
      ),
      required_documents: Object.entries(REQUIRED_DOCUMENTS).flatMap(([country, docs]) =>
        docs.map((d, i) => ({
          id: d.id,
          country,
          name: d.name,
          short_name: d.shortName,
          description: d.description,
          is_required: d.required,
          how_to_apply: d.howToApply,
          application_link: d.applicationLink || null,
          processing_time: d.processingTime,
          benefits: d.benefits,
          documents_needed: d.documentsNeeded,
          display_order: i,
          is_active: true,
        }))
      ),
      health_insurance: Object.entries(HEALTH_INSURANCE).flatMap(([country, options]) =>
        options.map((h, i) => ({
          id: h.id,
          country,
          name: h.name,
          type: h.type,
          description: h.description,
          coverage: h.coverage,
          monthly_estimate: h.monthlyEstimate,
          is_required: h.required,
          waiting_period: h.waitingPeriod || null,
          link: h.link || null,
          display_order: i,
          is_active: true,
        }))
      ),
      banks: Object.entries(BANKS).flatMap(([country, banks]) =>
        banks.map((b, i) => ({
          id: b.id,
          country,
          name: b.name,
          short_name: b.shortName || null,
          type: b.type,
          logo_url: b.logoUrl || null,
          description: b.description,
          student_friendly: b.studentFriendly,
          no_ssn_required: b.noSsnRequired || false,
          no_sin_required: b.noSinRequired || false,
          international_transfers: b.internationalTransfers,
          monthly_fee: b.monthlyFee,
          minimum_deposit: b.minimumDeposit,
          features: b.features,
          requirements: b.requirements,
          website: b.website,
          student_offers: b.studentOffers || null,
          display_order: i,
          is_active: true,
        }))
      ),
    };

    return NextResponse.json({
      success: true,
      message: 'Sync data prepared. Use this data to insert into Supabase.',
      counts: {
        visa_types: syncData.visa_types.length,
        required_documents: syncData.required_documents.length,
        health_insurance: syncData.health_insurance.length,
        banks: syncData.banks.length,
      },
      data: syncData,
    });
  } catch (error) {
    console.error('Country config sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
