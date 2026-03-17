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
  'monthly_budget',
  'expected_monthly_spending',
  'university',
].join(', ');

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
    const row = data as unknown as Record<string, unknown>;

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
    if (allowedFields.includes('monthlyIncome') && typeof row.monthly_income === 'number') {
      safe.monthlyIncome = row.monthly_income;
    }
    if (allowedFields.includes('monthlyBudget') && typeof row.monthly_budget === 'number') {
      safe.monthlyBudget = row.monthly_budget;
    }
    if (
      allowedFields.includes('expectedMonthlySpending') &&
      typeof row.expected_monthly_spending === 'number'
    ) {
      safe.expectedMonthlySpending = row.expected_monthly_spending;
    }
    if (
      allowedFields.includes('checkingBalance') &&
      typeof row.monthly_budget === 'number' &&
      typeof row.expected_monthly_spending === 'number'
    ) {
      // Estimated disposable amount from onboarding budget fields (not live bank balance).
      safe.checkingBalance = Number((row.monthly_budget - row.expected_monthly_spending).toFixed(2));
    }
    if (
      allowedFields.includes('upcomingObligationsSummary') &&
      typeof row.monthly_budget === 'number' &&
      typeof row.expected_monthly_spending === 'number'
    ) {
      safe.upcomingObligationsSummary = `Estimated monthly planned spending: $${row.expected_monthly_spending.toFixed(
        2
      )} on a budget of $${row.monthly_budget.toFixed(2)}.`;
    }
    if (allowedFields.includes('spendingCategoryTotals') && typeof row.expected_monthly_spending === 'number') {
      safe.spendingCategoryTotals = `Total planned monthly spending (aggregate): $${row.expected_monthly_spending.toFixed(
        2
      )}.`;
    }
    if (allowedFields.includes('university') && typeof row.university === 'string') {
      safe.university = row.university;
    }

    return safe;
  } catch {
    return {};
  }
}
