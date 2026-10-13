import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  PLAID_PRODUCTS,
  PLAID_COUNTRY_CODES,
  isPlaidConfigured,
} from "@/lib/plaid";
import {
  authenticate,
  countPlaidConnections,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { resolvePlaidWebhookUrl } from "@/lib/plaidWebhookConfig";
import { linkLimitRefusal } from "@/lib/plaidExchange";

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
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { userId } = auth;

    // Refuse before Link opens when the user is already at the connection
    // limit. Fails open on a failed count; exchange-token re-checks and fails
    // closed.
    const refusal = linkLimitRefusal(await countPlaidConnections(userId));
    if (refusal) {
      return NextResponse.json(refusal.body, { status: refusal.status });
    }

    // Registers /api/plaid/webhook on the new Item. Unset -> field omitted.
    const webhook = resolvePlaidWebhookUrl(process.env.PLAID_WEBHOOK_URL);

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
      ...(webhook ? { webhook } : {}),
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
