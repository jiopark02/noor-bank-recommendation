import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import type { AllowedSafeField, SafeUserContext } from './types';

const ALLOWED_SELECT_COLUMNS = [
  'id',
  'country_of_origin',
  'visa_type',
  'has_ssn',
  'has_itin',
  'institution_type',
  'campus_side',
  'monthly_income',
  'university',
].join(', ');

function toIncomeBand(income: number | null | undefined): string | undefined {
  if (income == null || income <= 0) return undefined;
  if (income < 1000) return 'under_1k';
  if (income < 2000) return 'under_2k';
  if (income < 3500) return 'under_3_5k';
  return 'over_3_5k';
}

export async function fetchSafeContext(
  userId: string,
  allowedFields: AllowedSafeField[]
): Promise<SafeUserContext> {
  if (!userId || !isSupabaseConfigured()) {
    return {};
  }

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('users')
      .select(ALLOWED_SELECT_COLUMNS)
      .eq('id', userId)
      .single();

    if (error || !data) {
      return {};
    }

    const safe: SafeUserContext = {};
    const row = data as Record<string, unknown>;

    if (allowedFields.includes('destinationCountry') && typeof row.country_of_origin === 'string') {
      safe.destinationCountry = row.country_of_origin;
    }
    if (allowedFields.includes('visaType') && typeof row.visa_type === 'string') {
      safe.visaType = row.visa_type;
    }
    if (allowedFields.includes('hasSSN') && row.has_ssn !== undefined) {
      safe.hasSSN = Boolean(row.has_ssn);
    }
    if (allowedFields.includes('hasITIN') && row.has_itin !== undefined) {
      safe.hasITIN = Boolean(row.has_itin);
    }
    if (allowedFields.includes('institutionType') && typeof row.institution_type === 'string') {
      safe.institutionType = row.institution_type;
    }
    if (allowedFields.includes('campusSide') && typeof row.campus_side === 'string') {
      safe.campusSide = row.campus_side;
    }
    if (allowedFields.includes('incomeBand')) {
      const band = toIncomeBand(
        typeof row.monthly_income === 'number' ? row.monthly_income : undefined
      );
      if (band) safe.incomeBand = band;
    }
    if (allowedFields.includes('university') && typeof row.university === 'string') {
      safe.university = row.university;
    }

    return safe;
  } catch {
    return {};
  }
}
