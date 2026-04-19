import type { SupabaseClient } from '@supabase/supabase-js';

/** Latest survey row fields merged into `noor_user_profile` after login. */
export async function getSurveyFieldsForUserProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<Partial<{ university: string; institutionId: string }>> {
  const { data, error } = await supabase
    .from('survey_responses')
    .select('university, institution_id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !data?.length) {
    return {};
  }

  const row = data[0] as {
    university: string | null;
    institution_id: string | null;
  };

  const out: Partial<{ university: string; institutionId: string }> = {};
  if (row.university != null && row.university !== '') {
    out.university = row.university;
  }
  if (row.institution_id != null && row.institution_id !== '') {
    out.institutionId = row.institution_id;
  }
  return out;
}
