import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  VISA_TYPES,
  REQUIRED_DOCUMENTS,
  HEALTH_INSURANCE,
  BANKS,
} from '@/lib/countryConfig';

export async function POST(request: NextRequest) {
  try {
    // Check if Supabase is configured
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Supabase is not configured' },
        { status: 500 }
      );
    }

    const supabase = createServerClient();
    const results: Record<string, { inserted: number; errors: string[] }> = {};

    // Seed visa_types
    const visaTypesData = Object.entries(VISA_TYPES).flatMap(([country, types]) =>
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
    );

    const { error: visaError } = await supabase
      .from('visa_types')
      .upsert(visaTypesData, { onConflict: 'id' });

    results.visa_types = {
      inserted: visaTypesData.length,
      errors: visaError ? [visaError.message] : [],
    };

    // Seed required_documents
    const documentsData = Object.entries(REQUIRED_DOCUMENTS).flatMap(([country, docs]) =>
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
    );

    const { error: docsError } = await supabase
      .from('required_documents')
      .upsert(documentsData, { onConflict: 'id' });

    results.required_documents = {
      inserted: documentsData.length,
      errors: docsError ? [docsError.message] : [],
    };

    // Seed health_insurance_options
    const healthData = Object.entries(HEALTH_INSURANCE).flatMap(([country, options]) =>
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
    );

    const { error: healthError } = await supabase
      .from('health_insurance_options')
      .upsert(healthData, { onConflict: 'id' });

    results.health_insurance = {
      inserted: healthData.length,
      errors: healthError ? [healthError.message] : [],
    };

    // Seed banks
    const banksData = Object.entries(BANKS).flatMap(([country, banks]) =>
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
    );

    const { error: banksError } = await supabase
      .from('banks')
      .upsert(banksData, { onConflict: 'id' });

    results.banks = {
      inserted: banksData.length,
      errors: banksError ? [banksError.message] : [],
    };

    // Check if any errors occurred
    const hasErrors = Object.values(results).some(r => r.errors.length > 0);

    return NextResponse.json({
      success: !hasErrors,
      message: hasErrors ? 'Some data failed to seed' : 'All data seeded successfully',
      results,
    });
  } catch (error) {
    console.error('Seed country data error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
