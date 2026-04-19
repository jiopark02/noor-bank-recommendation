import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserIdFromRequest } from '@/lib/apiAuth';
import { createServerClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * PATCH authenticated user's survey_responses row (university + institution).
 */
export async function PATCH(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const university =
      typeof body.university === 'string' ? body.university.trim() : '';
    if (!university) {
      return NextResponse.json(
        { error: 'university is required' },
        { status: 400 }
      );
    }

    const updatePayload: { university: string; institution_id?: string | null } =
      { university };
    if ('institution_id' in body) {
      if (body.institution_id === null) {
        updatePayload.institution_id = null;
      } else if (typeof body.institution_id === 'string') {
        const v = body.institution_id.trim();
        updatePayload.institution_id = v === '' ? null : v;
      }
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('survey_responses')
      .update(updatePayload)
      .eq('user_id', userId)
      .select('id');

    if (error) {
      console.error('survey_responses update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'No survey response found for this account' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, updated: data.length });
  } catch (e) {
    console.error('PATCH survey-response error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
