import { NextRequest, NextResponse } from "next/server";
import { CountryCode } from "plaid";
import { plaidClient, isPlaidConfigured, PlaidAccount } from "@/lib/plaid";
import {
  authenticate,
  getAllPlaidConnections,
  updatePlaidConnectionStatus,
  handlePlaidError,
  isPlaidLoginRequired,
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

    // Multi-connection safe: read ALL connections (not .single(), which errors
    // when a user has >1 active connection and previously produced a spurious
    // 404). Aggregate accounts across every active connection.
    const allConnections = await getAllPlaidConnections(userId);
    const activeConnections = allConnections.filter(
      (c) => c.status === "active"
    );

    if (activeConnections.length === 0) {
      return NextResponse.json(
        {
          error:
            "No active bank connections found. Please connect a bank first.",
        },
        { status: 404 }
      );
    }

    const accounts: PlaidAccount[] = [];
    const seenAccountIds = new Set<string>();
    let anySuccess = false;
    let anyLoginRequired = false;

    for (const connection of activeConnections) {
      const accessToken = connection.access_token;
      try {
        const accountsResponse = await plaidClient.accountsGet({
          access_token: accessToken,
        });

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

        for (const account of accountsResponse.data.accounts) {
          // Dedup defensively by account_id (distinct Items normally yield
          // distinct account_ids, but never emit the same account twice).
          if (seenAccountIds.has(account.account_id)) continue;
          seenAccountIds.add(account.account_id);

          accounts.push({
            id: `plaid_${account.account_id}`,
            user_id: userId,
            account_id: account.account_id,
            item_id: itemResponse.data.item.item_id,
            name: account.name,
            official_name: account.official_name || null,
            // NOTE: account type mapping and null-balance handling are
            // intentionally unchanged here (separate track).
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
          });
        }

        anySuccess = true;
      } catch (plaidError: unknown) {
        if (isPlaidLoginRequired(plaidError)) {
          // Mark just this connection broken and keep going — one expired bank
          // must not sink the whole response for a multi-bank user.
          await updatePlaidConnectionStatus(
            userId,
            connection.item_id,
            "error"
          );
          anyLoginRequired = true;
          continue;
        }
        // Non-login errors are unexpected; fail the request (outer catch → 500).
        throw plaidError;
      }
    }

    // Every active connection needed re-auth and none returned data: surface the
    // re-link signal the frontend keys on.
    if (!anySuccess && anyLoginRequired) {
      return NextResponse.json(
        {
          error: "Bank connection expired. Please re-link your account.",
          errorType: "ITEM_LOGIN_REQUIRED",
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      accounts,
    });
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
