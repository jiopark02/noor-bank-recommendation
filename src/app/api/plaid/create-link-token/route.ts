import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  PLAID_PRODUCTS,
  PLAID_COUNTRY_CODES,
  isPlaidConfigured,
} from "@/lib/plaid";
import { authenticate, handlePlaidError } from "@/lib/plaidApiUtils";

export async function POST(request: NextRequest) {
  try {
    // Check if Plaid is configured
    if (!isPlaidConfigured()) {
      return NextResponse.json(
        {
          error:
            "Plaid is not configured. Please add PLAID_CLIENT_ID and PLAID_SECRET to your environment variables.",
        },
        { status: 503 }
      );
    }

    // Authenticate user (extract userId from request)
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 401 }
      );
    }

    const { userId } = auth;

    // Create a link token for the user
    // Note: redirect_uri is optional and only needed for OAuth institutions in production
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: userId,
      },
      client_name: "Noor",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
    });

    return NextResponse.json({
      success: true,
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    });
  } catch (error: unknown) {
    console.error("Error creating link token:", error);
    return handlePlaidError(error);
  }
}
