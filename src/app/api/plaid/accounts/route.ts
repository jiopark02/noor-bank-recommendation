import { NextRequest, NextResponse } from "next/server";
import { CountryCode } from "plaid";
import { plaidClient, isPlaidConfigured, PlaidAccount } from "@/lib/plaid";
import {
  authenticate,
  getPlaidConnection,
  updatePlaidConnectionStatus,
  handlePlaidError,
} from "@/lib/plaidApiUtils";

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured()) {
      return NextResponse.json(
        { error: "Plaid is not configured" },
        { status: 503 }
      );
    }

    // Authenticate user
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = auth;

    // Get connection from database
    const connection = await getPlaidConnection(userId);
    if (!connection) {
      return NextResponse.json(
        {
          error:
            "No active bank connections found. Please connect a bank first.",
        },
        { status: 404 }
      );
    }

    const accessToken = connection.access_token;

    try {
      // Get accounts from Plaid
      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken,
      });

      // Get institution info
      const itemResponse = await plaidClient.itemGet({
        access_token: accessToken,
      });

      let institutionName = connection.institution_name;
      if (itemResponse.data.item.institution_id && !institutionName) {
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
      const accounts: PlaidAccount[] = accountsResponse.data.accounts.map(
        (account) => ({
          id: `plaid_${account.account_id}`,
          user_id: userId,
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
          iso_currency_code: account.balances.iso_currency_code || "USD",
          institution_id: itemResponse.data.item.institution_id || null,
          institution_name: institutionName,
          last_updated: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
      );

      return NextResponse.json({
        success: true,
        accounts,
        item: {
          itemId: itemResponse.data.item.item_id,
          institutionId: itemResponse.data.item.institution_id,
          institutionName,
        },
      });
    } catch (plaidError: unknown) {
      // Check if it's a login required error
      const errorMessage =
        plaidError instanceof Error ? plaidError.message : "Unknown error";
      if (
        errorMessage.includes("ITEM_LOGIN_REQUIRED") ||
        errorMessage.includes("invalid access token")
      ) {
        // Mark connection as broken
        await updatePlaidConnectionStatus(userId, connection.item_id, "error");
        return NextResponse.json(
          {
            error: "Bank connection expired. Please re-link your account.",
            errorType: "ITEM_LOGIN_REQUIRED",
          },
          { status: 401 }
        );
      }
      throw plaidError;
    }
  } catch (error: unknown) {
    console.error("Error fetching accounts:", error);
    return handlePlaidError(error);
  }
}

function mapAccountType(type: string): PlaidAccount["type"] {
  switch (type) {
    case "depository":
      return "checking";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
      return "investment";
    default:
      return "other";
  }
}
