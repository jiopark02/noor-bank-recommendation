import { NextRequest, NextResponse } from 'next/server';
import { plaidClient, isPlaidConfigured } from '@/lib/plaid';

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured()) {
      return NextResponse.json(
        { error: 'Plaid is not configured' },
        { status: 503 }
      );
    }

    const { publicToken, userId, institutionId, institutionName } = await request.json();

    if (!publicToken || !userId) {
      return NextResponse.json(
        { error: 'Public token and user ID are required' },
        { status: 400 }
      );
    }

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const { access_token, item_id } = exchangeResponse.data;

    // Store connection in localStorage for demo (in production, save to Supabase)
    // The frontend will handle saving this

    return NextResponse.json({
      success: true,
      itemId: item_id,
      // Don't send access_token to client in production
      // Store it server-side only
      accessToken: access_token, // For demo only
      institutionId,
      institutionName,
    });
  } catch (error: unknown) {
    console.error('Error exchanging token:', error);

    const errorMessage = error instanceof Error ? error.message : 'Failed to exchange token';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
