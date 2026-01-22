import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getRecommendations, saveRecommendations } from '@/lib/bankRecommendation';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '5');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Calculate recommendations
    const recommendations = await getRecommendations(supabase, userId, limit);

    // Save to DB (async, ignore errors)
    saveRecommendations(supabase, userId, recommendations).catch(console.error);

    return NextResponse.json({
      success: true,
      data: recommendations,
      meta: {
        total: recommendations.length,
        algorithm_version: 'v1',
      },
    });
  } catch (error) {
    console.error('Bank recommendation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, recommendationId, action, data } = body;

    if (!userId || !recommendationId || !action) {
      return NextResponse.json(
        { error: 'userId, recommendationId, and action are required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    switch (action) {
      case 'view':
        await supabase
          .from('recommendations_new')
          .update({ is_viewed: true })
          .eq('id', recommendationId)
          .eq('user_id', userId);
        break;

      case 'save':
        await supabase
          .from('recommendations_new')
          .update({ is_saved: true })
          .eq('id', recommendationId)
          .eq('user_id', userId);
        break;

      case 'dismiss':
        await supabase
          .from('recommendations_new')
          .update({ is_dismissed: true })
          .eq('id', recommendationId)
          .eq('user_id', userId);
        break;

      case 'rate':
        if (!data?.rating) {
          return NextResponse.json(
            { error: 'rating is required for rate action' },
            { status: 400 }
          );
        }
        await supabase
          .from('recommendations_new')
          .update({
            user_rating: data.rating,
            user_feedback: data.feedback || null,
          })
          .eq('id', recommendationId)
          .eq('user_id', userId);
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Recommendation action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
