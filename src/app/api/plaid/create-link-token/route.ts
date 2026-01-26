import { NextRequest, NextResponse } from 'next/server';
import { plaidClient, PLAID_PRODUCTS, PLAID_COUNTRY_CODES, isPlaidConfigured } from '@/lib/plaid';

export async function POST(request: NextRequest) {
  try {
    // Check if Plaid is configured
    if (!isPlaidConfigured()) {
      return NextResponse.json(
        { error: 'Plaid is not configured. Please add PLAID_CLIENT_ID and PLAID_SECRET to your environment variables.' },
        { status: 503 }
      );
    }

    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Create a link token for the user
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: userId,
      },
      client_name: 'Noor',
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: 'en',
      redirect_uri: process.env.PLAID_REDIRECT_URI,
    });

    return NextResponse.json({
      success: true,
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    });
  } catch (error: unknown) {
    console.error('Error creating link token:', error);

    const errorMessage = error instanceof Error ? error.message : 'Failed to create link token';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
