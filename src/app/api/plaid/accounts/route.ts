import { NextRequest, NextResponse } from 'next/server';
import { CountryCode } from 'plaid';
import { plaidClient, isPlaidConfigured, PlaidAccount } from '@/lib/plaid';

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured()) {
      return NextResponse.json(
        { error: 'Plaid is not configured' },
        { status: 503 }
      );
    }

    const { accessToken, userId } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Access token is required' },
        { status: 400 }
      );
    }

    // Get accounts from Plaid
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    // Get institution info
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });

    let institutionName = null;
    if (itemResponse.data.item.institution_id) {
      try {
        const instResponse = await plaidClient.institutionsGetById({
          institution_id: itemResponse.data.item.institution_id,
          country_codes: [CountryCode.Us],
        });
        institutionName = instResponse.data.institution.name;
      } catch {
        // Ignore institution lookup errors
      }
    }

    // Format accounts
    const accounts: PlaidAccount[] = accountsResponse.data.accounts.map((account) => ({
      id: `plaid_${account.account_id}`,
      user_id: userId || 'anonymous',
      account_id: account.account_id,
      item_id: itemResponse.data.item.item_id,
      name: account.name,
      official_name: account.official_name || null,
      type: mapAccountType(account.type),
      subtype: account.subtype || null,
      mask: account.mask || null,
      current_balance: account.balances.current || 0,
      available_balance: account.balances.available || null,
      credit_limit: account.balances.limit || null,
      iso_currency_code: account.balances.iso_currency_code || 'USD',
      institution_id: itemResponse.data.item.institution_id || null,
      institution_name: institutionName,
      last_updated: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }));

    return NextResponse.json({
      success: true,
      accounts,
      item: {
        itemId: itemResponse.data.item.item_id,
        institutionId: itemResponse.data.item.institution_id,
        institutionName,
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching accounts:', error);

    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch accounts';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

function mapAccountType(type: string): PlaidAccount['type'] {
  switch (type) {
    case 'depository':
      return 'checking';
    case 'credit':
      return 'credit';
    case 'loan':
      return 'loan';
    case 'investment':
      return 'investment';
    default:
      return 'other';
  }
}
